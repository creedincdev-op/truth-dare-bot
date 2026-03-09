const crypto = require("node:crypto");

function randomInt(max) {
  return Math.floor(Math.random() * max);
}

function pickRandom(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }
  return items[randomInt(items.length)];
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function shortId(prefix = "tod") {
  return `${prefix}_${crypto.randomBytes(4).toString("base64url")}`;
}

module.exports = {
  pickRandom,
  shuffle,
  shortId,
};