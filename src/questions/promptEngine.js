const { pickRandom, pickWeightedRandom, shortId } = require("../utils/random");
const { normalizeText, sanitizePrompt } = require("../utils/textFilters");
const {
  CATEGORY_LABELS,
  DEFAULT_GUILD_CONFIG,
  GAME_LABELS,
  RATINGS,
  buildPromptCatalog,
  isInternalPlayableGame,
} = require("./catalog");

const SIGNATURE_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "at",
  "be",
  "for",
  "from",
  "have",
  "how",
  "if",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "what",
  "who",
  "would",
  "you",
  "your",
]);

function buildPromptSignature(text) {
  return new Set(
    normalizeText(text)
      .split(" ")
      .filter((token) => token && token.length > 2 && !SIGNATURE_STOP_WORDS.has(token)),
  );
}

function scoreSignatureOverlap(signatureA, signatureB) {
  if (signatureA.size === 0 || signatureB.size === 0) {
    return 0;
  }

  let shared = 0;
  for (const token of signatureA) {
    if (signatureB.has(token)) {
      shared += 1;
    }
  }

  return shared / Math.min(signatureA.size, signatureB.size);
}

function buildUsageMap(rows) {
  const usage = new Map();

  for (const row of rows) {
    usage.set(row.key, {
      count: Number(row.count) || 0,
      lastUsedAt: Number(row.lastUsedAt) || 0,
    });
  }

  return usage;
}

function freshnessPenalty(lastUsedAt, ceilingMinutes, maxPenalty) {
  if (!lastUsedAt) {
    return 0;
  }

  const minutesAgo = Math.floor((Date.now() - lastUsedAt) / 60000);
  if (minutesAgo >= ceilingMinutes) {
    return 0;
  }

  return (1 - (minutesAgo / ceilingMinutes)) * maxPenalty;
}

class PromptEngine {
  constructor({ aiPromptService = null, store, recentHistoryLimit = 120 } = {}) {
    this.aiPromptService = aiPromptService;
    this.store = store;
    this.recentHistoryLimit = recentHistoryLimit;
    this.catalog = buildPromptCatalog();
  }

  resolveRating(requestedRating, guildConfig) {
    if (RATINGS.includes(requestedRating)) {
      return requestedRating;
    }
    return guildConfig.defaultRating || DEFAULT_GUILD_CONFIG.defaultRating;
  }

  getCounts() {
    const counts = {};

    for (const prompt of this.catalog) {
      counts[prompt.game] = (counts[prompt.game] || 0) + 1;
    }

    return counts;
  }

  getCategoryCounts({ game, rating, guildId }) {
    const guildConfig = guildId ? this.store.getGuildConfig(guildId) : DEFAULT_GUILD_CONFIG;
    const effectiveRating = this.resolveRating(rating, guildConfig);
    const resolvedGames = this.resolveGameKeys(game, guildConfig);
    const activeGames = new Set(resolvedGames);
    const disabledCategories = new Set(guildConfig.disabledCategories || []);
    const counts = {};

    for (const prompt of this.catalog) {
      if (!activeGames.has(prompt.game)) {
        continue;
      }
      if (prompt.rating !== effectiveRating) {
        continue;
      }
      if (disabledCategories.has(prompt.category)) {
        continue;
      }

      counts[prompt.category] = (counts[prompt.category] || 0) + 1;
    }

    return counts;
  }

  resolveGameKeys(requestedGame, guildConfig) {
    const disabledGames = new Set(guildConfig.disabledGames || []);
    const internalGames = ["truth", "dare", "never_have_i_ever", "paranoia"]
      .filter((game) => !disabledGames.has(game));

    if (requestedGame === "random" || !requestedGame) {
      return internalGames;
    }

    if (requestedGame === "truth_or_dare") {
      return internalGames.filter((game) => game === "truth" || game === "dare");
    }

    if (isInternalPlayableGame(requestedGame) && !disabledGames.has(requestedGame)) {
      return [requestedGame];
    }

    return internalGames;
  }

  async maybeRewritePrompt({ prompt, recentTexts, maxPromptLength }) {
    const cleanedText = sanitizePrompt(prompt.text);
    const needsRewrite = cleanedText.length < 32;

    if (!needsRewrite || !this.aiPromptService || !this.aiPromptService.enabled) {
      return prompt;
    }

    const rewritten = await this.aiPromptService.rewritePrompt({
      game: prompt.game,
      category: prompt.category,
      rating: prompt.rating,
      sourcePrompt: prompt.text,
      recentPrompts: recentTexts,
      maxLength: maxPromptLength,
    });

    if (!rewritten) {
      return prompt;
    }

    return {
      ...prompt,
      text: rewritten,
      key: normalizeText(`${prompt.game}|${prompt.category}|${prompt.rating}|${rewritten}`),
      source: "ai-rewrite",
    };
  }

  scoreCandidates(candidates, recentEntries, requestedCategory, usageStats) {
    const recentSignatures = recentEntries
      .slice(0, 18)
      .map((entry) => buildPromptSignature(entry.text))
      .filter((signature) => signature.size > 0);
    const recentCategories = recentEntries.slice(0, 8).map((entry) => entry.category);
    const recentGames = recentEntries.slice(0, 8).map((entry) => entry.game);
    const recentTones = recentEntries.slice(0, 8).map((entry) => entry.category);

    return candidates
      .map((prompt) => {
        const signature = buildPromptSignature(prompt.text);
        const channelUsage = usageStats.channel.get(prompt.key) || { count: 0, lastUsedAt: 0 };
        const guildUsage = usageStats.guild.get(prompt.key) || { count: 0, lastUsedAt: 0 };
        const overlap = recentSignatures.reduce((maxOverlap, recentSignature) => {
          return Math.max(maxOverlap, scoreSignatureOverlap(signature, recentSignature));
        }, 0);
        const categoryPenalty = requestedCategory === "any" && recentCategories.includes(prompt.category) ? 0.14 : 0;
        const gamePenalty = recentGames.includes(prompt.game) ? 0.05 : 0;
        const tonePenalty = requestedCategory === "any" && recentTones.includes(prompt.tone || prompt.category) ? 0.05 : 0;
        const spicyPenalty = requestedCategory === "any" && prompt.category === "flirty" ? 0.07 : 0;
        const usagePenalty = (channelUsage.count * 0.09) + (guildUsage.count * 0.03);
        const freshness = freshnessPenalty(channelUsage.lastUsedAt, 180, 0.22)
          + freshnessPenalty(guildUsage.lastUsedAt, 90, 0.08);
        const weightBonus = Math.min(0.3, (prompt.weight || 1) * 0.08);

        return {
          prompt,
          score: overlap + categoryPenalty + gamePenalty + tonePenalty + spicyPenalty + usagePenalty + freshness - weightBonus,
        };
      })
      .sort((left, right) => left.score - right.score);
  }

  async getNextPrompt({
    guildId,
    channelId,
    game = "random",
    category = "any",
    requestedRating,
    requesterTag = "Unknown",
  }) {
    const guildConfig = guildId ? this.store.getGuildConfig(guildId) : DEFAULT_GUILD_CONFIG;
    const rating = this.resolveRating(requestedRating, guildConfig);
    const gameKeys = this.resolveGameKeys(game, guildConfig);

    if (gameKeys.length === 0) {
      throw new Error("All selected games are disabled for this server.");
    }

    const disabledCategories = new Set(guildConfig.disabledCategories || []);
    const blacklistedKeys = this.store.getBlacklistedKeys();
    const recentChannelEntries = this.store.getRecentPromptEntries({
      guildId,
      channelId,
      games: gameKeys,
      limit: Math.min(40, this.recentHistoryLimit),
      scope: "channel",
    });
    const recentGuildEntries = this.store.getRecentPromptEntries({
      guildId,
      games: gameKeys,
      limit: Math.min(120, this.recentHistoryLimit + 40),
      scope: "guild",
    });
    const recentChannelKeys = new Set(
      this.store.getRecentPromptKeys({
        guildId,
        channelId,
        games: gameKeys,
        limit: this.recentHistoryLimit,
        scope: "channel",
      }),
    );
    const recentGuildKeys = new Set(
      this.store.getRecentPromptKeys({
        guildId,
        games: gameKeys,
        limit: this.recentHistoryLimit + 60,
        scope: "guild",
      }),
    );
    const usedChannelKeys = new Set(
      this.store.getUsedPromptKeys({
        guildId,
        channelId,
        games: gameKeys,
        scope: "channel",
      }),
    );
    const usedGuildKeys = new Set(
      this.store.getUsedPromptKeys({
        guildId,
        games: gameKeys,
        scope: "guild",
      }),
    );
    const usageStats = {
      channel: buildUsageMap(this.store.getPromptUsageStats({
        guildId,
        channelId,
        games: gameKeys,
        scope: "channel",
      })),
      guild: buildUsageMap(this.store.getPromptUsageStats({
        guildId,
        games: gameKeys,
        scope: "guild",
      })),
    };
    const recentEntries = [
      ...recentChannelEntries,
      ...recentGuildEntries.filter((entry) => !recentChannelKeys.has(entry.key)),
    ].slice(0, 80);
    const recentTexts = recentEntries.map((entry) => entry.text);

    const matching = this.catalog.filter((prompt) => {
      if (!gameKeys.includes(prompt.game)) {
        return false;
      }
      if (prompt.rating !== rating) {
        return false;
      }
      if (category !== "any" && prompt.category !== category) {
        return false;
      }
      if (disabledCategories.has(prompt.category)) {
        return false;
      }
      if (blacklistedKeys.has(prompt.key)) {
        return false;
      }
      if (prompt.text.length > guildConfig.maxPromptLength) {
        return false;
      }

      return true;
    });

    const unseenChannelCandidates = matching.filter((prompt) => !usedChannelKeys.has(prompt.key));
    const unseenGuildCandidates = matching.filter((prompt) => !usedGuildKeys.has(prompt.key));
    const unseenAnywhereCandidates = unseenChannelCandidates.filter((prompt) => !usedGuildKeys.has(prompt.key));
    const notRecentChannelCandidates = matching.filter((prompt) => !recentChannelKeys.has(prompt.key));
    const notRecentGuildCandidates = matching.filter((prompt) => !recentGuildKeys.has(prompt.key));
    const notRecentAnywhereCandidates = matching.filter((prompt) => {
      return !recentChannelKeys.has(prompt.key) && !recentGuildKeys.has(prompt.key);
    });
    const candidatePool = unseenAnywhereCandidates.length > 0
      ? unseenAnywhereCandidates
      : unseenChannelCandidates.length > 0
        ? unseenChannelCandidates
        : unseenGuildCandidates.length > 0
          ? unseenGuildCandidates
          : notRecentAnywhereCandidates.length > 0
            ? notRecentAnywhereCandidates
            : notRecentChannelCandidates.length > 0
              ? notRecentChannelCandidates
              : notRecentGuildCandidates.length > 0
                ? notRecentGuildCandidates
                : matching;
    const scoredCandidates = this.scoreCandidates(candidatePool, recentEntries, category, usageStats);
    const preferredCandidates = scoredCandidates.filter((entry) => entry.score < 0.62);
    const selectionPool = (preferredCandidates.length > 0 ? preferredCandidates : scoredCandidates)
      .slice(0, 64);

    const selectedEntry = pickWeightedRandom(selectionPool, (entry) => {
      const quality = Math.max(0.1, entry.prompt.weight || 1);
      const freshness = 1 / (1 + Math.max(0, entry.score * 2.5));
      return quality * freshness;
    });

    let selected = selectedEntry ? selectedEntry.prompt : null;
    let source = "catalog";

    if (!selected && this.aiPromptService && this.aiPromptService.enabled) {
      const aiGame = pickRandom(gameKeys);
      const aiCategory = category === "any"
        ? pickRandom(Object.keys(CATEGORY_LABELS))
        : category;
      const aiPrompt = await this.aiPromptService.generatePrompt({
        game: aiGame,
        category: aiCategory,
        rating,
        recentPrompts: recentTexts,
        maxLength: guildConfig.maxPromptLength,
      });

      if (aiPrompt) {
        selected = {
          game: aiGame,
          category: aiCategory,
          rating,
          text: aiPrompt,
          key: normalizeText(`${aiGame}|${aiCategory}|${rating}|${aiPrompt}`),
        };
        source = "ai";
      }
    }

    if (!selected) {
      const fallbackGame = gameKeys[0];
      selected = {
        game: fallbackGame,
        category: category === "any" ? "relatable" : category,
        rating,
        text: fallbackGame === "dare"
          ? "Give a dramatic 20-second speech about your day."
          : fallbackGame === "never_have_i_ever"
            ? "Never have I ever sent a message and instantly wished I could take it back."
            : fallbackGame === "paranoia"
              ? "Who here would panic first if plans changed at the last second?"
              : "What is one thing you would improve this week?",
        key: normalizeText(`${fallbackGame}|${category}|${rating}|fallback`),
      };
      source = "fallback";
    }

    const finalPrompt = await this.maybeRewritePrompt({
      prompt: { ...selected, source },
      recentTexts,
      maxPromptLength: guildConfig.maxPromptLength,
    });

    return {
      id: shortId(finalPrompt.game),
      game: finalPrompt.game,
      gameLabel: GAME_LABELS[finalPrompt.game] || finalPrompt.game,
      category: finalPrompt.category,
      categoryLabel: CATEGORY_LABELS[finalPrompt.category] || finalPrompt.category,
      rating: finalPrompt.rating,
      text: finalPrompt.text,
      key: finalPrompt.key,
      requesterTag,
      source: finalPrompt.source || source,
    };
  }
}

module.exports = {
  PromptEngine,
};
