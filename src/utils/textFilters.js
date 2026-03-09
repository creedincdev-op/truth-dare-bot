const BLOCKED_WORDS = [
  "gf",
  "boyfriend",
  "girlfriend",
  "ex",
  "kiss",
  "sexy",
  "nsfw",
  "hookup",
  "crush",
  "romantic",
  "romance",
  "date",
  "make out",
  "drunk",
  "weed",
  "drug",
  "alcohol",
  "vape",
  "cigarette",
  "damn",
  "shit",
  "fuck",
  "bitch",
  "asshole",
  "nude",
  "bedroom",
  "body count"
];

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsBlockedWords(text) {
  const normalized = normalizeText(text);
  return BLOCKED_WORDS.some((word) => normalized.includes(word));
}

function sanitizePrompt(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean;
}

module.exports = {
  BLOCKED_WORDS,
  normalizeText,
  containsBlockedWords,
  sanitizePrompt,
};