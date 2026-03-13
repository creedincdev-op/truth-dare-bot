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

function pickWeightedRandom(items, getWeight) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  const weighted = items.map((item) => ({
    item,
    weight: Math.max(0, Number(getWeight(item)) || 0),
  })).filter((entry) => entry.weight > 0);

  if (weighted.length === 0) {
    return pickRandom(items);
  }

  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = Math.random() * totalWeight;

  for (const entry of weighted) {
    cursor -= entry.weight;
    if (cursor <= 0) {
      return entry.item;
    }
  }

  return weighted[weighted.length - 1].item;
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
  pickWeightedRandom,
  shuffle,
  shortId,
};
