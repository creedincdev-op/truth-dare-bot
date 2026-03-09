const {
  truthBasePrompts,
  dareBasePrompts,
  truthTemplates,
  dareTemplates,
  truthMatrix,
  dareMatrix,
} = require("./basePrompts");
const { containsBlockedWords, normalizeText, sanitizePrompt } = require("../utils/textFilters");
const { shuffle } = require("../utils/random");

function uniqueByNormalized(items) {
  const seen = new Set();
  const output = [];

  for (const rawItem of items) {
    const item = sanitizePrompt(rawItem);
    if (!item) {
      continue;
    }

    const key = normalizeText(item);
    if (!key || seen.has(key) || containsBlockedWords(item)) {
      continue;
    }

    seen.add(key);
    output.push(item);
  }

  return output;
}

function extractPlaceholders(pattern) {
  const matches = [...pattern.matchAll(/\{([a-zA-Z0-9_]+)\}/g)];
  return [...new Set(matches.map((match) => match[1]))];
}

function expandTemplate(pattern, tokens, cap = 450) {
  const keys = extractPlaceholders(pattern);
  if (keys.length === 0) {
    return [sanitizePrompt(pattern)];
  }

  const results = [];
  const stack = [{ idx: 0, values: {} }];

  while (stack.length > 0 && results.length < cap) {
    const current = stack.pop();

    if (current.idx >= keys.length) {
      const finalPrompt = pattern.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => current.values[key] || "");
      results.push(sanitizePrompt(finalPrompt));
      continue;
    }

    const key = keys[current.idx];
    const options = tokens[key] || [];

    for (let i = options.length - 1; i >= 0; i -= 1) {
      stack.push({
        idx: current.idx + 1,
        values: {
          ...current.values,
          [key]: options[i],
        },
      });
    }
  }

  return results;
}

function buildTemplatePool(templates, capPerTemplate = 500) {
  const generated = [];

  for (const template of templates) {
    generated.push(...expandTemplate(template.pattern, template.tokens, capPerTemplate));
  }

  return generated;
}

function buildTruthMatrixPool(maxCount = 9000) {
  const results = [];
  const { openers, subjects, angles, timeframes, contexts } = truthMatrix;

  for (const opener of openers) {
    for (const subject of subjects) {
      for (const angle of angles) {
        results.push(`${opener} ${subject} ${angle}?`);

        if (results.length >= maxCount) {
          return results;
        }
      }
    }
  }

  for (const subject of subjects) {
    for (const timeframe of timeframes) {
      results.push(`What is one ${subject} you want to improve in ${timeframe}?`);

      if (results.length >= maxCount) {
        return results;
      }
    }

    for (const context of contexts) {
      results.push(`What is one ${subject} in ${context} you want to improve?`);

      if (results.length >= maxCount) {
        return results;
      }
    }
  }

  return results;
}

function buildDareMatrixPool(maxCount = 9000) {
  const results = [];
  const { actions, activities, formats, durations, addons } = dareMatrix;

  for (const action of actions) {
    for (const activity of activities) {
      for (const format of formats) {
        for (const duration of durations) {
          for (const addon of addons) {
            results.push(`${action} ${activity} ${format} ${duration}, ${addon}.`);

            if (results.length >= maxCount) {
              return results;
            }
          }
        }
      }
    }
  }

  return results;
}

function buildPromptPools() {
  const truthPoolRaw = [
    ...truthBasePrompts,
    ...buildTemplatePool(truthTemplates, 500),
    ...buildTruthMatrixPool(12000),
  ];

  const darePoolRaw = [
    ...dareBasePrompts,
    ...buildTemplatePool(dareTemplates, 500),
    ...buildDareMatrixPool(12000),
  ];

  const truthPool = shuffle(uniqueByNormalized(truthPoolRaw));
  const darePool = shuffle(uniqueByNormalized(darePoolRaw));

  return {
    truthPool,
    darePool,
  };
}

module.exports = {
  buildPromptPools,
};
