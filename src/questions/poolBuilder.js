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

function pushWithCap(results, value, maxCount) {
  results.push(value);
  return results.length >= maxCount;
}

function buildTruthMatrixPool(maxCount = 9000) {
  const results = [];
  const {
    crushCategories,
    crushAngles,
    attentionHooks,
    attentionContexts,
    scenarios,
    comparisons,
    opinionTopics,
    opinionContexts,
    behaviors,
    popCultureTopics,
  } = truthMatrix;

  for (const category of crushCategories) {
    for (const angle of crushAngles) {
      if (pushWithCap(results, `Who is your ${category} ${angle}?`, maxCount)) {
        return results;
      }
    }
  }

  for (const category of crushCategories) {
    if (pushWithCap(results, `Which ${category} answer of yours would start a roast session in your group chat?`, maxCount)) {
      return results;
    }
  }

  for (const hook of attentionHooks) {
    for (const context of attentionContexts) {
      if (pushWithCap(results, `What kind of ${hook} gets your attention ${context}?`, maxCount)) {
        return results;
      }
      if (pushWithCap(results, `Would ${hook} make you lose your fake nonchalance ${context}?`, maxCount)) {
        return results;
      }
    }
  }

  for (const scenario of scenarios) {
    if (pushWithCap(results, `Be honest, what would you do if ${scenario}?`, maxCount)) {
      return results;
    }
    if (pushWithCap(results, `Could you still act cool if ${scenario}?`, maxCount)) {
      return results;
    }
  }

  for (const { left, right } of comparisons) {
    if (pushWithCap(results, `Which gets you faster: ${left} or ${right}?`, maxCount)) {
      return results;
    }
    if (pushWithCap(results, `Which is worse for your self-control: ${left} or ${right}?`, maxCount)) {
      return results;
    }
  }

  for (const topic of opinionTopics) {
    for (const context of opinionContexts) {
      if (pushWithCap(results, `What is your take on ${topic} ${context}?`, maxCount)) {
        return results;
      }
      if (pushWithCap(results, `What is your savage take on ${topic} ${context}?`, maxCount)) {
        return results;
      }
    }
  }

  for (const behavior of behaviors) {
    if (pushWithCap(results, `Have you ever ${behavior}?`, maxCount)) {
      return results;
    }
    if (pushWithCap(results, `When was the last time you ${behavior}?`, maxCount)) {
      return results;
    }
  }

  for (const topic of popCultureTopics) {
    if (pushWithCap(results, `Which ${topic} take do you defend the hardest?`, maxCount)) {
      return results;
    }
    if (pushWithCap(results, `What is your messiest opinion about ${topic}?`, maxCount)) {
      return results;
    }
  }

  return results;
}

function buildDareMatrixPool(maxCount = 9000) {
  const results = [];
  const {
    revealTopics,
    reactionScenarios,
    platforms,
    tones,
    personas,
    choices,
    generalActs,
    durations,
  } = dareMatrix;

  for (const topic of revealTopics) {
    if (pushWithCap(results, `Reveal your ${topic} in one line.`, maxCount)) {
      return results;
    }
    if (pushWithCap(results, `Announce your ${topic} like the whole chat was waiting for it.`, maxCount)) {
      return results;
    }
  }

  for (const scenario of reactionScenarios) {
    for (const duration of durations) {
      if (pushWithCap(results, `Act like ${scenario} for ${duration}.`, maxCount)) {
        return results;
      }
    }
  }

  for (const tone of tones) {
    for (const platform of platforms) {
      if (pushWithCap(results, `Give a ${tone} line you would use in a ${platform}.`, maxCount)) {
        return results;
      }
    }
  }

  for (const { left, right } of choices) {
    if (pushWithCap(results, `Pick ${left} or ${right}, then defend it like your group chat is roasting you.`, maxCount)) {
      return results;
    }
    if (pushWithCap(results, `Settle ${left} versus ${right} in one savage sentence.`, maxCount)) {
      return results;
    }
  }

  for (const persona of personas) {
    for (const topic of revealTopics.slice(0, 5)) {
      if (pushWithCap(results, `Introduce your ${topic} like a ${persona}.`, maxCount)) {
        return results;
      }
    }
  }

  for (const act of generalActs) {
    for (const duration of durations) {
      if (pushWithCap(results, `Do ${act} for ${duration}.`, maxCount)) {
        return results;
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
