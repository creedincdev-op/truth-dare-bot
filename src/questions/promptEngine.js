const { buildPromptPools } = require("./poolBuilder");
const { pickRandom, shortId } = require("../utils/random");
const { normalizeText, containsBlockedWords } = require("../utils/textFilters");

const SIGNATURE_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "at",
  "be",
  "do",
  "did",
  "for",
  "from",
  "have",
  "how",
  "if",
  "in",
  "is",
  "it",
  "kind",
  "like",
  "most",
  "of",
  "on",
  "one",
  "or",
  "really",
  "right",
  "someone",
  "something",
  "that",
  "the",
  "thing",
  "this",
  "to",
  "what",
  "when",
  "which",
  "who",
  "would",
  "you",
  "your",
]);

const SIGNATURE_SHORT_ALLOWLIST = new Set(["dm", "ex", "ig"]);

function buildPromptSignature(text) {
  const tokens = normalizeText(text)
    .split(" ")
    .filter((token) => token && !SIGNATURE_STOP_WORDS.has(token))
    .filter((token) => token.length > 2 || SIGNATURE_SHORT_ALLOWLIST.has(token));

  return new Set(tokens);
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

class PromptEngine {
  constructor({ aiPromptService = null, recentHistoryLimit = 160 } = {}) {
    this.aiPromptService = aiPromptService;
    this.recentHistoryLimit = recentHistoryLimit;
    this.stateByChannel = new Map();

    const { truthPool, darePool } = buildPromptPools();
    this.truthPool = truthPool;
    this.darePool = darePool;
  }

  getPool(type) {
    return type === "dare" ? this.darePool : this.truthPool;
  }

  getCounts() {
    return {
      truth: this.truthPool.length,
      dare: this.darePool.length,
    };
  }

  resolveType(mode) {
    if (mode === "truth" || mode === "dare") {
      return mode;
    }
    return Math.random() < 0.5 ? "truth" : "dare";
  }

  getChannelState(channelId) {
    if (!this.stateByChannel.has(channelId)) {
      this.stateByChannel.set(channelId, {
        history: [],
        usedTruth: new Set(),
        usedDare: new Set(),
      });
    }
    return this.stateByChannel.get(channelId);
  }

  getChannelStats(channelId) {
    const state = this.getChannelState(channelId);
    return {
      historySize: state.history.length,
      truthUsed: state.usedTruth.size,
      dareUsed: state.usedDare.size,
    };
  }

  pushHistory(channelState, key) {
    channelState.history.unshift(key);
    if (channelState.history.length > this.recentHistoryLimit) {
      channelState.history.pop();
    }
  }

  selectPromptFromPool(pool, usedSet, recentHistory) {
    const recentSet = new Set(recentHistory.slice(0, 80));
    const recentSignatures = recentHistory
      .slice(0, 18)
      .map((entry) => buildPromptSignature(entry))
      .filter((signature) => signature.size > 0);

    let candidates = pool.filter((prompt) => {
      const key = normalizeText(prompt);
      return !usedSet.has(key) && !recentSet.has(key);
    });

    if (candidates.length === 0) {
      usedSet.clear();
      candidates = pool.filter((prompt) => !recentSet.has(normalizeText(prompt)));
    }

    if (candidates.length === 0) {
      candidates = pool;
    }

    const scoredCandidates = candidates
      .map((prompt) => {
        const signature = buildPromptSignature(prompt);
        const overlap = recentSignatures.reduce((maxOverlap, recentSignature) => {
          return Math.max(maxOverlap, scoreSignatureOverlap(signature, recentSignature));
        }, 0);

        return {
          prompt,
          overlap,
        };
      })
      .sort((left, right) => left.overlap - right.overlap);

    const preferredCandidates = scoredCandidates.filter((entry) => entry.overlap < 0.45);
    const selectionPool = (preferredCandidates.length > 0 ? preferredCandidates : scoredCandidates)
      .slice(0, 60)
      .map((entry) => entry.prompt);

    return pickRandom(selectionPool);
  }

  async getNextPrompt({ mode = "random", channelId, requesterTag = "Unknown" }) {
    const type = this.resolveType(mode);
    const channelState = this.getChannelState(channelId);

    const usedSet = type === "truth" ? channelState.usedTruth : channelState.usedDare;
    const pool = this.getPool(type);

    let text = this.selectPromptFromPool(pool, usedSet, channelState.history);
    let source = "local";

    if (!text && this.aiPromptService) {
      const recent = channelState.history
        .slice(0, 25)
        .map((key) => pool.find((prompt) => normalizeText(prompt) === key))
        .filter(Boolean);

      const aiPrompt = await this.aiPromptService.generatePrompt({
        type,
        recentPrompts: recent,
      });

      if (aiPrompt && !containsBlockedWords(aiPrompt)) {
        text = aiPrompt;
        source = "ai";
      }
    }

    if (!text) {
      text = type === "truth"
        ? "What is the most simp thing you have done but still deny?"
        : "Draft a clean flirty IG reply in one line.";
      source = "fallback";
    }

    const textKey = normalizeText(text);
    if (type === "truth") {
      channelState.usedTruth.add(textKey);
    } else {
      channelState.usedDare.add(textKey);
    }
    this.pushHistory(channelState, textKey);

    return {
      id: shortId(type),
      type,
      text,
      requesterTag,
      rating: "PG-13",
      source,
    };
  }
}

module.exports = {
  PromptEngine,
};
