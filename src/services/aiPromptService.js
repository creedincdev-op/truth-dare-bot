const OpenAI = require("openai");
const { containsBlockedWords, sanitizePrompt } = require("../utils/textFilters");
const { GAME_LABELS } = require("../questions/catalog");

class AIPromptService {
  constructor({ apiKey, model = "gpt-4.1-mini" } = {}) {
    this.enabled = Boolean(apiKey);
    this.model = model;
    this.client = this.enabled ? new OpenAI({ apiKey }) : null;
  }

  async generatePrompt({ game, category, rating, recentPrompts = [], maxLength = 170 }) {
    if (!this.enabled || !this.client) {
      return null;
    }

    const recentBlock = recentPrompts.slice(0, 20).map((entry, index) => `${index + 1}. ${entry}`).join("\n");
    const prompt = [
      "Generate exactly one Discord party-game prompt.",
      `Game: ${GAME_LABELS[game] || game}`,
      `Category: ${category}`,
      `Rating: ${rating}`,
      "Keep it playful, relatable, bold, and varied.",
      "Lean mostly relatable/funny/social, with only a light flirty edge when it fits.",
      "Avoid leaning on ex, girlfriend, boyfriend, or crush themes too often.",
      "Avoid profanity, explicit sexual content, hate, harassment, or illegal acts.",
      "Keep it useful for a server game with friends.",
      `Maximum length: ${maxLength} characters.`,
      "Avoid these recent prompts:",
      recentBlock || "(none)",
      "Return only the prompt text.",
    ].join("\n");

    try {
      const response = await this.client.responses.create({
        model: this.model,
        input: prompt,
        temperature: 1,
        max_output_tokens: 120,
      });

      const text = sanitizePrompt(response.output_text || "");
      if (!text || text.length > maxLength || containsBlockedWords(text)) {
        return null;
      }

      return text;
    } catch (error) {
      console.error("AI prompt generation failed:", error.message);
      return null;
    }
  }

  async rewritePrompt({ game, category, rating, sourcePrompt, recentPrompts = [], maxLength = 170 }) {
    if (!this.enabled || !this.client || !sourcePrompt) {
      return null;
    }

    const recentBlock = recentPrompts.slice(0, 15).map((entry, index) => `${index + 1}. ${entry}`).join("\n");
    const prompt = [
      "Rewrite this Discord game prompt into a stronger, cleaner, more original version.",
      `Game: ${GAME_LABELS[game] || game}`,
      `Category: ${category}`,
      `Rating: ${rating}`,
      `Source prompt: ${sourcePrompt}`,
      "Keep the meaning in the same lane, but make it fresher and more playable.",
      "Lean mostly relatable/funny/social, with only a light flirty edge when it fits.",
      "Avoid leaning on ex, girlfriend, boyfriend, or crush themes too often.",
      "Avoid profanity, explicit sexual content, hate, harassment, or illegal acts.",
      `Maximum length: ${maxLength} characters.`,
      "Avoid these recent prompts:",
      recentBlock || "(none)",
      "Return only the rewritten prompt.",
    ].join("\n");

    try {
      const response = await this.client.responses.create({
        model: this.model,
        input: prompt,
        temperature: 0.9,
        max_output_tokens: 120,
      });

      const text = sanitizePrompt(response.output_text || "");
      if (!text || text.length > maxLength || containsBlockedWords(text)) {
        return null;
      }

      return text;
    } catch (error) {
      console.error("AI prompt rewrite failed:", error.message);
      return null;
    }
  }
}

module.exports = {
  AIPromptService,
};
