const { buildPromptPools } = require("./poolBuilder");
const { pickRandom, shortId } = require("../utils/random");
const { normalizeText, containsBlockedWords } = require("../utils/textFilters");

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

    return pickRandom(candidates);
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
        ? "What is one thing you want to improve this week?"
        : "Do 10 jumping jacks and smile at the finish.";
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
      rating: "PG",
      source,
    };
  }
}

module.exports = {
  PromptEngine,
};