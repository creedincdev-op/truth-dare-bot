const OpenAI = require("openai");
const { containsBlockedWords, sanitizePrompt } = require("../utils/textFilters");

class AIPromptService {
  constructor({ apiKey, model = "gpt-4.1-mini" } = {}) {
    this.enabled = Boolean(apiKey);
    this.model = model;
    this.client = this.enabled ? new OpenAI({ apiKey }) : null;
  }

  async generatePrompt({ type, recentPrompts = [] }) {
    if (!this.enabled || !this.client) {
      return null;
    }

    const mode = type === "truth" ? "TRUTH" : "DARE";
    const recentBlock = recentPrompts
      .slice(0, 20)
      .map((entry, idx) => `${idx + 1}. ${entry}`)
      .join("\n");

    const instruction = [
      "Generate exactly ONE concise Discord game prompt.",
      `Mode: ${mode}`,
      "Style: friendly, creative, PG, non-romantic, non-sexual, no relationship/ex references, no profanity.",
      "Keep it under 130 characters.",
      "Avoid duplicates and avoid these recent prompts:",
      recentBlock || "(none)",
      "Return only the prompt text. No numbering, no quotes, no labels.",
    ].join("\n");

    try {
      const response = await this.client.responses.create({
        model: this.model,
        input: instruction,
        temperature: 0.9,
        max_output_tokens: 80,
      });

      const raw = response.output_text || "";
      const prompt = sanitizePrompt(raw);

      if (!prompt || containsBlockedWords(prompt)) {
        return null;
      }

      return prompt;
    } catch (error) {
      return null;
    }
  }
}

module.exports = {
  AIPromptService,
};