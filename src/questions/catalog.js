const { normalizeText, sanitizePrompt } = require("../utils/textFilters");

const RATINGS = ["PG", "PG13", "R"];
const RATING_CHOICES = RATINGS.map((value) => ({ name: value, value }));

const GAME_LABELS = {
  random: "Random Mix",
  truth_or_dare: "Truth or Dare",
  truth: "Truth",
  dare: "Dare",
  would_you_rather: "Would You Rather",
  never_have_i_ever: "Never Have I Ever",
  paranoia: "Paranoia",
  icebreaker: "Icebreaker",
  challenge: "Challenge",
  hot_take: "Hot Take",
};

const GAME_CHOICES = [
  { name: "Random Mix", value: "random" },
  { name: "Truth or Dare", value: "truth_or_dare" },
  { name: "Truth Only", value: "truth" },
  { name: "Dare Only", value: "dare" },
  { name: "Would You Rather", value: "would_you_rather" },
  { name: "Never Have I Ever", value: "never_have_i_ever" },
  { name: "Paranoia", value: "paranoia" },
  { name: "Icebreaker", value: "icebreaker" },
  { name: "Challenge", value: "challenge" },
  { name: "Hot Take", value: "hot_take" },
];

const CATEGORY_LABELS = {
  funny: "Funny",
  chaos: "Chaos",
  social: "Social",
  skill: "Skill",
  team: "Team",
  voice: "Voice",
  imagination: "Imagination",
  wholesome: "Wholesome",
  school: "School",
  gamer: "Gamer",
  creator: "Creator",
  hotseat: "Hot Seat",
};

const CATEGORY_CHOICES = [
  { name: "Any Category", value: "any" },
  ...Object.entries(CATEGORY_LABELS).map(([value, name]) => ({ name, value })),
];

const BUTTON_MODE_CHOICES = [
  { name: "Classic", value: "classic" },
  { name: "Battle", value: "battle" },
  { name: "Streak", value: "streak" },
  { name: "Timer", value: "timer" },
];

const DEFAULT_GUILD_CONFIG = {
  defaultRating: "PG",
  maxPromptLength: 170,
  buttonTimeoutSeconds: 240,
  disabledCategories: [],
  disabledGames: [],
};

const GAME_COLORS = {
  truth: 0x2ecc71,
  dare: 0xe74c3c,
  would_you_rather: 0x5865f2,
  never_have_i_ever: 0x9b59b6,
  paranoia: 0xb8892d,
  icebreaker: 0x1abc9c,
  challenge: 0xe67e22,
  hot_take: 0xd354a3,
};

const RATING_TONES = {
  PG: ["smart", "playful", "lighthearted", "friendly", "creative", "surprising"],
  PG13: ["bold", "chaotic", "spicy", "dramatic", "unfiltered", "cheeky"],
  R: ["wild", "unfiltered", "chaotic", "audacious", "late-night", "reckless"],
};

const DURATIONS = ["15 seconds", "20 seconds", "30 seconds", "45 seconds", "1 minute"];
const PRESENTATION_STYLES = ["news host", "game show host", "sports commentator", "movie trailer", "podcast host", "dramatic narrator"];
const AUDIENCES = ["new teammate", "alien visitor", "curious class", "future you", "busy friend", "new player"];

const CATEGORY_PROFILES = {
  funny: {
    topics: ["inside jokes", "meme taste", "awkward laughs", "camera roll energy", "bad timing", "random habits"],
    scenarios: ["a quiet classroom", "a late-night group chat", "a bad camera angle", "a family function", "a voice crack moment", "a roast session"],
    actions: [
      "save the weirdest meme first",
      "turn a small mistake into a comedy bit",
      "laugh at the wrong time",
      "take a joke too seriously for ten seconds",
      "make a boring story sound legendary",
      "invent a nickname on the spot",
    ],
    choices: [
      ["lose Wi-Fi for a day", "send a typo to the whole server"],
      ["trip on stage", "laugh in the middle of a serious talk"],
      ["have a weird ringtone", "have a cursed wallpaper"],
      ["tell a bad joke", "sing one line off-key"],
      ["accidentally unmute", "accidentally react with the wrong emoji"],
      ["be known for bad puns", "be known for dramatic exits"],
    ],
  },
  chaos: {
    topics: ["last-minute plans", "random impulses", "late-night ideas", "group chat chaos", "unexpected messages", "plot twists"],
    scenarios: ["an all-nighter", "a deadline week", "a sudden power cut", "a missed bus", "a broken plan", "an accidental reply"],
    actions: [
      "say yes before thinking",
      "change the plan with full confidence",
      "cause harmless chaos by improvising",
      "make a tiny moment way too dramatic",
      "start a fake emergency countdown",
      "turn a routine day into a story arc",
    ],
    choices: [
      ["miss the first clue", "miss the last train of thought"],
      ["make a random plan", "follow a random dare"],
      ["start a chaotic poll", "drop a cryptic message"],
      ["wing a presentation", "wing a game strategy"],
      ["be too early for no reason", "be late with a dramatic excuse"],
      ["accidentally lead the plan", "accidentally become the villain"],
    ],
  },
  social: {
    topics: ["first impressions", "reply style", "party energy", "friend circles", "public speaking", "texting habits"],
    scenarios: ["meeting new people", "joining a voice call", "walking into a room late", "replying after hours", "hosting a hangout", "breaking awkward silence"],
    actions: [
      "carry a conversation when nobody helps",
      "reply with too much confidence",
      "act chill while overthinking",
      "introduce two strangers smoothly",
      "save an awkward pause",
      "overanalyze a simple message",
    ],
    choices: [
      ["text first", "call first"],
      ["host the plan", "join the chaos"],
      ["meet one person deeply", "talk to the whole room"],
      ["speak on stage", "break the ice in a circle"],
      ["reply instantly", "craft the perfect response"],
      ["go to a loud party", "go to a small hangout"],
    ],
  },
  skill: {
    topics: ["study systems", "time management", "problem solving", "editing workflow", "focus habits", "learning speed"],
    scenarios: ["a tough exam week", "a big client task", "a ranked match", "a long coding session", "a creative block", "a packed day"],
    actions: [
      "solve a messy problem calmly",
      "learn a tool faster than expected",
      "make a plan under pressure",
      "debug with stubborn patience",
      "fix your setup on the fly",
      "teach a trick in a simple way",
    ],
    choices: [
      ["have more time", "have more focus"],
      ["master design", "master coding"],
      ["get faster", "get more accurate"],
      ["study early", "study late"],
      ["plan everything", "improvise well"],
      ["work solo", "work with a sharp team"],
    ],
  },
  team: {
    topics: ["group projects", "collab style", "leadership moments", "server events", "shared wins", "brainstorm sessions"],
    scenarios: ["a team deadline", "a planning meeting", "a friendly tournament", "a collab sprint", "a messy handoff", "a sudden role switch"],
    actions: [
      "take the lead without saying much",
      "rescue a project from confusion",
      "spot the missing detail first",
      "keep the team calm",
      "turn scattered ideas into a plan",
      "motivate people when energy drops",
    ],
    choices: [
      ["lead the team", "support the lead"],
      ["present the final result", "organize the whole project"],
      ["brainstorm first", "build first"],
      ["win quietly", "win loudly"],
      ["work with close friends", "work with smart strangers"],
      ["handle conflict", "handle deadlines"],
    ],
  },
  voice: {
    topics: ["storytelling", "impressions", "announcer voice", "singing habits", "dramatic reading", "podcast energy"],
    scenarios: ["reading a boring text", "joining voice chat", "narrating a game", "hyping a friend", "announcing fake news", "doing a dramatic intro"],
    actions: [
      "switch voices mid-sentence",
      "narrate normal life like cinema",
      "copy an announcer tone",
      "hype a boring object",
      "speak like a host for no reason",
      "turn one line into a monologue",
    ],
    choices: [
      ["have a radio voice", "have a perfect announcer voice"],
      ["sing one line on cue", "do an impression on cue"],
      ["host a live show", "narrate a movie trailer"],
      ["speak dramatically", "whisper dramatically"],
      ["read poetry aloud", "read patch notes aloud"],
      ["voice act a villain", "voice act a hero"],
    ],
  },
  imagination: {
    topics: ["alternate universes", "time travel", "secret missions", "dream inventions", "superpower choices", "movie plots"],
    scenarios: ["waking up in another timeline", "being cast in a sci-fi film", "running a secret base", "joining a fantasy quest", "landing on a new planet", "rewriting a boring day"],
    actions: [
      "invent a ridiculous gadget",
      "rewrite reality for one scene",
      "assign superpowers to friends",
      "turn a small problem into an epic quest",
      "create a fake prophecy",
      "pitch a sequel nobody asked for",
    ],
    choices: [
      ["time travel once", "see one day from the future"],
      ["have invisibility", "have teleportation"],
      ["live in a game world", "live in a movie world"],
      ["erase one awkward moment", "replay one perfect moment"],
      ["build a robot friend", "build a flying scooter"],
      ["star in fantasy", "star in sci-fi"],
    ],
  },
  wholesome: {
    topics: ["small wins", "kindness", "gratitude", "support habits", "comfort routines", "good memories"],
    scenarios: ["a stressful week", "a hard morning", "a friend needing help", "a quiet evening", "a long trip", "a comeback moment"],
    actions: [
      "notice a small win quickly",
      "encourage someone at the right time",
      "remember the exact helpful detail",
      "make people feel included",
      "calm a tense moment",
      "celebrate progress without being loud",
    ],
    choices: [
      ["get one perfect compliment", "give one perfect compliment"],
      ["have more calm", "have more confidence"],
      ["start the day slowly", "end the day peacefully"],
      ["help quietly", "hype loudly"],
      ["remember every good moment", "forget every bad one"],
      ["have one extra free hour", "have one extra calm hour"],
    ],
  },
  school: {
    topics: ["exam prep", "teacher moments", "canteen picks", "classroom energy", "assignment strategy", "school trips"],
    scenarios: ["a surprise test", "presentation day", "the last bench", "the school bus", "group assignment chaos", "results day"],
    actions: [
      "finish an assignment at the last second",
      "act calm before a test",
      "carry the whole group project",
      "pick the best seat fast",
      "make revision notes too late",
      "turn a school story into a legend",
    ],
    choices: [
      ["have open-book exams", "have no homework"],
      ["present first", "present last"],
      ["skip a boring lecture", "repeat a boring lecture"],
      ["sit front row", "sit last bench"],
      ["ace math", "ace public speaking"],
      ["redo one exam", "redo one school trip"],
    ],
  },
  gamer: {
    topics: ["boss fights", "ranked matches", "loadouts", "co-op style", "rage moments", "speedrun habits"],
    scenarios: ["a clutch round", "a lag spike", "a final boss", "voice comm chaos", "a comeback match", "teaching a new player"],
    actions: [
      "blame the lag with a straight face",
      "pull off a lucky clutch",
      "overexplain a simple strategy",
      "carry the team quietly",
      "celebrate too early",
      "retry until it finally clicks",
    ],
    choices: [
      ["have perfect aim", "have perfect game sense"],
      ["win a 1v4", "win a tournament finals"],
      ["play co-op forever", "play ranked forever"],
      ["be known for clutches", "be known for strategy"],
      ["get better mechanics", "get better patience"],
      ["speedrun one game", "master one game completely"],
    ],
  },
  creator: {
    topics: ["design choices", "editing tricks", "creative blocks", "camera angles", "brand vibes", "content ideas"],
    scenarios: ["a client revision", "a blank canvas", "a late-night edit", "a rushed upload", "a feedback round", "building a new concept"],
    actions: [
      "scrap an idea and rebuild it fast",
      "spot the tiny detail everyone missed",
      "fix a design at the last minute",
      "turn feedback into a better version",
      "rename files in chaos",
      "sell a rough idea with confidence",
    ],
    choices: [
      ["get endless ideas", "get endless focus"],
      ["edit video faster", "design faster"],
      ["have perfect lighting", "have perfect audio"],
      ["ship often", "perfect every detail"],
      ["work from a studio", "work from anywhere"],
      ["go viral once", "build a loyal audience"],
    ],
  },
  hotseat: {
    topics: ["unpopular opinions", "instant judgments", "pet peeves", "controversial preferences", "bold takes", "questionable habits"],
    scenarios: ["a comment section war", "a friend debate", "a late-night rant", "a tier list argument", "a server poll", "a heated watch party"],
    actions: [
      "defend a bad take with confidence",
      "judge a situation in three seconds",
      "switch sides for the chaos",
      "rank things too seriously",
      "drop one line that starts debate",
      "stand by a take even when roasted",
    ],
    choices: [
      ["be too honest", "be too diplomatic"],
      ["drop a hot take", "drop a cold fact"],
      ["defend a bad movie", "defend a bad song"],
      ["rank everything", "rate nothing"],
      ["say the quiet part", "keep the suspense"],
      ["be chaotic honest", "be strategic mysterious"],
    ],
  },
};

function pushUnique(buffer, seen, prompt) {
  const clean = sanitizePrompt(prompt);
  if (!clean) {
    return;
  }

  const key = normalizeText(clean);
  if (!key || seen.has(key)) {
    return;
  }

  seen.add(key);
  buffer.push(clean);
}

function buildTruthPrompts(categoryKey, profile, rating) {
  const tones = RATING_TONES[rating];
  const prompts = [];
  const seen = new Set();

  for (const topic of profile.topics) {
    for (const scenario of profile.scenarios) {
      pushUnique(prompts, seen, `What is one ${tones[0]} thing you learned about ${topic} during ${scenario}?`);
      pushUnique(prompts, seen, `What is your ${tones[1]} opinion about ${topic} after ${scenario}?`);
      pushUnique(prompts, seen, `What is one truth about ${topic} you usually keep to yourself after ${scenario}?`);
      pushUnique(prompts, seen, `What is the ${tones[2]} side of your personality when it comes to ${topic}?`);
      pushUnique(prompts, seen, `Which part of ${scenario} brings out your ${tones[3]} side most?`);
      pushUnique(prompts, seen, `What would surprise people most about how you handle ${topic} during ${scenario}?`);
      pushUnique(prompts, seen, `What is your most ${tones[4]} habit when ${scenario} happens?`);
    }
  }

  for (const action of profile.actions) {
    pushUnique(prompts, seen, `Have you ever ${action}?`);
    pushUnique(prompts, seen, `When was the last time you ${action}?`);
    pushUnique(prompts, seen, `What made you ${action}?`);
    pushUnique(prompts, seen, `What is the funniest reason you ever ${action}?`);
    pushUnique(prompts, seen, `How likely are you to ${action} again if the moment feels right?`);
  }

  return prompts.map((text) => ({
    game: "truth",
    category: categoryKey,
    rating,
    text,
  }));
}

function buildDarePrompts(categoryKey, profile, rating) {
  const tones = RATING_TONES[rating];
  const prompts = [];
  const seen = new Set();

  for (const topic of profile.topics) {
    for (const style of PRESENTATION_STYLES) {
      pushUnique(prompts, seen, `Explain ${topic} like a ${style} for ${DURATIONS[1]}.`);
      pushUnique(prompts, seen, `Give a ${tones[1]} one-line ad for ${topic}.`);
      pushUnique(prompts, seen, `Sell ${topic} like it costs a fortune in ${DURATIONS[0]}.`);
      pushUnique(prompts, seen, `Teach ${topic} to a ${AUDIENCES[1]} in ${DURATIONS[1]}.`);
    }
  }

  for (const scenario of profile.scenarios) {
    pushUnique(prompts, seen, `Act out ${scenario} with full commitment for ${DURATIONS[2]}.`);
    pushUnique(prompts, seen, `Narrate ${scenario} like it is the final scene of a movie.`);
    pushUnique(prompts, seen, `Turn ${scenario} into breaking news for ${DURATIONS[0]}.`);
  }

  for (const action of profile.actions) {
    pushUnique(prompts, seen, `Pretend you must ${action} and give the speech you would use.`);
    pushUnique(prompts, seen, `Describe how you would ${action} in exactly 10 words.`);
    pushUnique(prompts, seen, `Act like your next mission is to ${action} for ${DURATIONS[1]}.`);
  }

  return prompts.map((text) => ({
    game: "dare",
    category: categoryKey,
    rating,
    text,
  }));
}

function buildWouldYouRatherPrompts(categoryKey, profile, rating) {
  const tones = RATING_TONES[rating];
  const prompts = [];
  const seen = new Set();

  for (const [left, right] of profile.choices) {
    pushUnique(prompts, seen, `Would you rather ${left} or ${right}?`);
    pushUnique(prompts, seen, `Would you rather ${left} and explain why, or ${right} and defend it?`);
    pushUnique(prompts, seen, `What sounds more ${tones[0]} to you right now: ${left} or ${right}?`);
    pushUnique(prompts, seen, `Which would make the better story: ${left} or ${right}?`);
    pushUnique(prompts, seen, `Which one would suit your energy more this week: ${left} or ${right}?`);
  }

  return prompts.map((text) => ({
    game: "would_you_rather",
    category: categoryKey,
    rating,
    text,
  }));
}

function buildNeverHaveIEverPrompts(categoryKey, profile, rating) {
  const tones = RATING_TONES[rating];
  const prompts = [];
  const seen = new Set();

  for (const action of profile.actions) {
    pushUnique(prompts, seen, `Never have I ever ${action}.`);
    pushUnique(prompts, seen, `Never have I ever wanted to ${action} just to see what would happen.`);
    pushUnique(prompts, seen, `Never have I ever secretly planned to ${action}.`);
  }

  for (const scenario of profile.scenarios) {
    pushUnique(prompts, seen, `Never have I ever completely changed my mood because of ${scenario}.`);
    pushUnique(prompts, seen, `Never have I ever turned ${scenario} into a ${tones[1]} memory.`);
    pushUnique(prompts, seen, `Never have I ever acted cooler than I felt during ${scenario}.`);
  }

  return prompts.map((text) => ({
    game: "never_have_i_ever",
    category: categoryKey,
    rating,
    text,
  }));
}

function buildParanoiaPrompts(categoryKey, profile, rating) {
  const tones = RATING_TONES[rating];
  const prompts = [];
  const seen = new Set();

  for (const action of profile.actions) {
    pushUnique(prompts, seen, `Who here is most likely to ${action}?`);
    pushUnique(prompts, seen, `Who here would ${action} first and then deny it?`);
    pushUnique(prompts, seen, `Who here could ${action} and still look innocent?`);
  }

  for (const scenario of profile.scenarios) {
    pushUnique(prompts, seen, `Who here would handle ${scenario} the best?`);
    pushUnique(prompts, seen, `Who here would turn ${scenario} into a ${tones[2]} story?`);
    pushUnique(prompts, seen, `Who here would accidentally become the main character during ${scenario}?`);
  }

  return prompts.map((text) => ({
    game: "paranoia",
    category: categoryKey,
    rating,
    text,
  }));
}

function buildIcebreakerPrompts(categoryKey, profile, rating) {
  const tones = RATING_TONES[rating];
  const prompts = [];
  const seen = new Set();

  for (const topic of profile.topics) {
    pushUnique(prompts, seen, `What is your favorite part about ${topic}?`);
    pushUnique(prompts, seen, `What is one ${tones[0]} story you have about ${topic}?`);
    pushUnique(prompts, seen, `What would make ${topic} even better for you?`);
    pushUnique(prompts, seen, `What is one thing about ${topic} that people guess wrong about you?`);
  }

  for (const [left, right] of profile.choices) {
    pushUnique(prompts, seen, `Which one says more about you: ${left} or ${right}?`);
    pushUnique(prompts, seen, `Which choice feels more natural to you lately: ${left} or ${right}?`);
  }

  return prompts.map((text) => ({
    game: "icebreaker",
    category: categoryKey,
    rating,
    text,
  }));
}

function buildChallengePrompts(categoryKey, profile, rating) {
  const tones = RATING_TONES[rating];
  const prompts = [];
  const seen = new Set();

  for (const topic of profile.topics) {
    pushUnique(prompts, seen, `Name 5 things about ${topic} in ${DURATIONS[0]}.`);
    pushUnique(prompts, seen, `Pitch ${topic} to a ${AUDIENCES[0]} in ${DURATIONS[1]}.`);
    pushUnique(prompts, seen, `Describe ${topic} using only 8 words.`);
  }

  for (const scenario of profile.scenarios) {
    pushUnique(prompts, seen, `Give a ${tones[1]} reaction to ${scenario} in ${DURATIONS[1]}.`);
    pushUnique(prompts, seen, `React to ${scenario} like a game host for ${DURATIONS[0]}.`);
  }

  for (const action of profile.actions) {
    pushUnique(prompts, seen, `Act like you need to ${action} right now for ${DURATIONS[2]}.`);
    pushUnique(prompts, seen, `Explain why you must ${action} in one dramatic sentence.`);
  }

  return prompts.map((text) => ({
    game: "challenge",
    category: categoryKey,
    rating,
    text,
  }));
}

function buildHotTakePrompts(categoryKey, profile, rating) {
  const tones = RATING_TONES[rating];
  const prompts = [];
  const seen = new Set();

  for (const topic of profile.topics) {
    pushUnique(prompts, seen, `What is your hot take on ${topic}?`);
    pushUnique(prompts, seen, `What is your most ${tones[1]} opinion about ${topic}?`);
    pushUnique(prompts, seen, `What is one opinion about ${topic} you would defend way longer than necessary?`);
  }

  for (const [left, right] of profile.choices) {
    pushUnique(prompts, seen, `Which side would you defend harder in a debate: ${left} or ${right}?`);
    pushUnique(prompts, seen, `Which one deserves more support in your opinion: ${left} or ${right}?`);
  }

  return prompts.map((text) => ({
    game: "hot_take",
    category: categoryKey,
    rating,
    text,
  }));
}

function addPromptMetadata(prompt) {
  const normalizedKey = normalizeText(`${prompt.game}|${prompt.category}|${prompt.rating}|${prompt.text}`);
  return {
    ...prompt,
    key: normalizedKey,
  };
}

function buildPromptCatalog() {
  const prompts = [];

  for (const [categoryKey, profile] of Object.entries(CATEGORY_PROFILES)) {
    for (const rating of RATINGS) {
      prompts.push(...buildTruthPrompts(categoryKey, profile, rating));
      prompts.push(...buildDarePrompts(categoryKey, profile, rating));
      prompts.push(...buildWouldYouRatherPrompts(categoryKey, profile, rating));
      prompts.push(...buildNeverHaveIEverPrompts(categoryKey, profile, rating));
      prompts.push(...buildParanoiaPrompts(categoryKey, profile, rating));
      prompts.push(...buildIcebreakerPrompts(categoryKey, profile, rating));
      prompts.push(...buildChallengePrompts(categoryKey, profile, rating));
      prompts.push(...buildHotTakePrompts(categoryKey, profile, rating));
    }
  }

  const seen = new Set();
  const deduped = [];

  for (const prompt of prompts.map(addPromptMetadata)) {
    if (seen.has(prompt.key)) {
      continue;
    }

    seen.add(prompt.key);
    deduped.push(prompt);
  }

  return deduped;
}

function isInternalPlayableGame(game) {
  return [
    "truth",
    "dare",
    "would_you_rather",
    "never_have_i_ever",
    "paranoia",
    "icebreaker",
    "challenge",
    "hot_take",
  ].includes(game);
}

module.exports = {
  BUTTON_MODE_CHOICES,
  CATEGORY_CHOICES,
  CATEGORY_LABELS,
  DEFAULT_GUILD_CONFIG,
  GAME_CHOICES,
  GAME_COLORS,
  GAME_LABELS,
  RATINGS,
  RATING_CHOICES,
  buildPromptCatalog,
  isInternalPlayableGame,
};
