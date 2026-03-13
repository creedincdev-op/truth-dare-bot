const { DateTime } = require("luxon");
const {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
} = require("discord.js");
const { config, assertConfig } = require("./config");
const { getCommandPayload } = require("./discord/commands");
const { registerCommands } = require("./discord/registerCommands");
const {
  createPromptEmbed,
  createPromptButtons,
  createSessionButtons,
  createSessionEmbed,
} = require("./discord/ui");
const {
  CATEGORY_LABELS,
  DEFAULT_GUILD_CONFIG,
  GAME_LABELS,
} = require("./questions/catalog");
const { PromptEngine } = require("./questions/promptEngine");
const { AIPromptService } = require("./services/aiPromptService");
const { SchedulerService } = require("./services/schedulerService");
const { SessionService } = require("./services/sessionService");
const { BotStore } = require("./services/store");

assertConfig();

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

let store;
let promptEngine;
let sessionService;
let schedulerService;
let commandsRegistered = false;
const componentExpiryTimers = new Map();

const LOGIN_429_COOLDOWN_MS = Math.max(60, Number(process.env.BOT_LOGIN_429_COOLDOWN || 1800)) * 1000;
const LOGIN_429_COOLDOWN_MAX_MS = Math.max(
  LOGIN_429_COOLDOWN_MS,
  Number(process.env.BOT_LOGIN_429_COOLDOWN_MAX || 7200) * 1000,
);
const GATEWAY_READY_TIMEOUT_MS = Math.max(60, Number(process.env.BOT_GATEWAY_READY_TIMEOUT_SECONDS || 300)) * 1000;

let login429CooldownMs = LOGIN_429_COOLDOWN_MS;
let startupTimeout = null;

const PLAY_COMMAND_DEFAULTS = {
  truth: { game: "truth", mode: "classic" },
  dare: { game: "dare", mode: "classic" },
  wyr: { game: "would_you_rather", mode: "classic" },
  wouldyourather: { game: "would_you_rather", mode: "classic" },
  nhie: { game: "never_have_i_ever", mode: "classic" },
  neverhaveiever: { game: "never_have_i_ever", mode: "classic" },
  paranoia: { game: "paranoia", mode: "classic" },
  icebreaker: { game: "icebreaker", mode: "classic" },
  challenge: { game: "challenge", mode: "classic" },
  hottake: { game: "hot_take", mode: "classic" },
  todbattle: { game: "truth_or_dare", mode: "battle" },
  todstreak: { game: "truth_or_dare", mode: "streak" },
  todtimer: { game: "truth_or_dare", mode: "timer" },
};

function sendStatus(update) {
  if (typeof process.send === "function") {
    process.send({ type: "status", ...update });
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function clearStartupTimeout() {
  if (startupTimeout) {
    clearTimeout(startupTimeout);
    startupTimeout = null;
  }
}

function armStartupTimeout() {
  clearStartupTimeout();
  startupTimeout = setTimeout(() => {
    if (!client.isReady()) {
      console.error(`Discord gateway did not reach ready within ${Math.round(GATEWAY_READY_TIMEOUT_MS / 1000)}s. Exiting child process.`);
      sendStatus({
        phase: "gateway_ready_timeout",
        discordReady: false,
        botUser: null,
        lastError: `Discord gateway did not reach ready within ${Math.round(GATEWAY_READY_TIMEOUT_MS / 1000)}s`,
      });
      process.exit(1);
    }
  }, GATEWAY_READY_TIMEOUT_MS);
}

function isDiscordRateLimit(error) {
  if (!error || typeof error !== "object") {
    return false;
  }

  if (Number(error.status) === 429 || Number(error.code) === 429) {
    return true;
  }

  return typeof error.message === "string" && /\b429\b/.test(error.message);
}

function extractRetryAfterMs(error, fallbackMs) {
  const candidates = [
    error && error.retry_after,
    error && error.retryAfter,
    error && error.rawError && error.rawError.retry_after,
    error && error.data && error.data.retry_after,
  ];

  for (const value of candidates) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.ceil(seconds * 1000);
    }
  }

  return fallbackMs;
}

function ensureGuildInteraction(interaction) {
  if (!interaction.guildId) {
    throw new Error("This command only works in servers.");
  }
}

function formatList(items, mapper = (value) => value) {
  if (!items || items.length === 0) {
    return "None";
  }
  return items.map(mapper).join(", ");
}

function canControlSession(interaction, session) {
  return interaction.user.id === session.createdBy || Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
}

function armComponentExpiry(message, guildId) {
  const guildConfig = guildId ? store.getGuildConfig(guildId) : DEFAULT_GUILD_CONFIG;
  const timeoutSeconds = guildConfig.buttonTimeoutSeconds || DEFAULT_GUILD_CONFIG.buttonTimeoutSeconds;

  if (!timeoutSeconds || timeoutSeconds <= 0) {
    return;
  }

  const timerKey = message.id;
  if (componentExpiryTimers.has(timerKey)) {
    clearTimeout(componentExpiryTimers.get(timerKey));
  }

  const timer = setTimeout(async () => {
    componentExpiryTimers.delete(timerKey);
    try {
      if (message.editable) {
        await message.edit({ components: [] });
      }
    } catch (error) {
      console.error("Failed to expire message components:", error.message);
    }
  }, timeoutSeconds * 1000);

  componentExpiryTimers.set(timerKey, timer);
}

async function sendPromptMessage({ channel, prompt, requester, requesterId, guildId, channelId }) {
  const sentMessage = await channel.send({
    embeds: [createPromptEmbed(prompt, requester)],
    components: [createPromptButtons(prompt)],
  });

  store.recordPromptEmission(prompt, {
    guildId,
    channelId,
    requesterId,
  });

  armComponentExpiry(sentMessage, guildId);
  return sentMessage;
}

async function replyWithPrompt(interaction, prompt) {
  await interaction.editReply({
    embeds: [createPromptEmbed(prompt, interaction.user)],
    components: [createPromptButtons(prompt)],
  });

  const replyMessage = await interaction.fetchReply();
  store.recordPromptEmission(prompt, {
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    requesterId: interaction.user.id,
  });
  armComponentExpiry(replyMessage, interaction.guildId);
}

async function resolvePromptFromInteraction({ guildId, channelId, userTag, game, category, rating }) {
  return promptEngine.getNextPrompt({
    guildId,
    channelId,
    game,
    category,
    requestedRating: rating,
    requesterTag: userTag,
  });
}

async function handlePlayCommand(interaction, defaults = {}) {
  ensureGuildInteraction(interaction);
  await interaction.deferReply();

  const game = interaction.options.getString("game") || defaults.game || "random";
  const category = interaction.options.getString("category") || "any";
  const rating = interaction.options.getString("rating") || null;
  const mode = interaction.options.getString("mode") || defaults.mode || "classic";

  if (mode === "classic") {
    const prompt = await resolvePromptFromInteraction({
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userTag: interaction.user.tag,
      game,
      category,
      rating,
    });
    await replyWithPrompt(interaction, prompt);
    return;
  }

  const prompt = await resolvePromptFromInteraction({
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    userTag: interaction.user.tag,
    game,
    category,
    rating,
  });

  const session = sessionService.startSession({
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    mode,
    game,
    category: prompt.category,
    rating: prompt.rating,
    rounds: interaction.options.getInteger("rounds"),
    durationMinutes: interaction.options.getInteger("duration_minutes"),
    createdBy: interaction.user.id,
    prompt,
  });

  await interaction.editReply({
    embeds: [createSessionEmbed(sessionService, session)],
    components: [createSessionButtons(session)],
  });

  store.recordPromptEmission(prompt, {
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    requesterId: interaction.user.id,
  });
}

async function handleCategoryCommand(interaction) {
  ensureGuildInteraction(interaction);
  await interaction.deferReply({ ephemeral: true });

  const game = interaction.options.getString("game") || "random";
  const rating = interaction.options.getString("rating") || null;
  const counts = promptEngine.getCategoryCounts({
    game,
    rating,
    guildId: interaction.guildId,
  });
  const configForGuild = store.getGuildConfig(interaction.guildId);
  const lines = Object.entries(counts)
    .sort((left, right) => right[1] - left[1])
    .map(([categoryKey, count]) => `${CATEGORY_LABELS[categoryKey] || categoryKey}: **${count}**`);

  await interaction.editReply({
    content: [
      `Game: **${GAME_LABELS[game] || "Random Mix"}**`,
      `Rating: **${rating || configForGuild.defaultRating}**`,
      `Disabled categories: **${formatList(configForGuild.disabledCategories, (value) => CATEGORY_LABELS[value] || value)}**`,
      "",
      lines.length > 0 ? lines.join("\n") : "No categories available with current filters.",
    ].join("\n"),
  });
}

async function handleConfigCommand(interaction) {
  ensureGuildInteraction(interaction);
  await interaction.deferReply({ ephemeral: true });

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "view") {
    const guildConfig = store.getGuildConfig(interaction.guildId);
    await interaction.editReply({
      content: [
        `Default rating: **${guildConfig.defaultRating}**`,
        `Max prompt length: **${guildConfig.maxPromptLength}**`,
        `Button timeout: **${guildConfig.buttonTimeoutSeconds}s**`,
        `Disabled categories: **${formatList(guildConfig.disabledCategories, (value) => CATEGORY_LABELS[value] || value)}**`,
        `Disabled games: **${formatList(guildConfig.disabledGames, (value) => GAME_LABELS[value] || value)}**`,
      ].join("\n"),
    });
    return;
  }

  if (subcommand === "set") {
    const updates = {};
    const defaultRating = interaction.options.getString("default_rating");
    const maxPromptLength = interaction.options.getInteger("max_prompt_length");
    const buttonTimeout = interaction.options.getInteger("button_timeout");

    if (defaultRating) {
      updates.defaultRating = defaultRating;
    }
    if (maxPromptLength) {
      updates.maxPromptLength = maxPromptLength;
    }
    if (buttonTimeout) {
      updates.buttonTimeoutSeconds = buttonTimeout;
    }

    const next = store.upsertGuildConfig(interaction.guildId, updates);
    await interaction.editReply({
      content: `Updated config. Rating: **${next.defaultRating}**, max length: **${next.maxPromptLength}**, timeout: **${next.buttonTimeoutSeconds}s**.`,
    });
    return;
  }

  if (subcommand === "disable_category" || subcommand === "enable_category") {
    const category = interaction.options.getString("category", true);
    const disabled = subcommand === "disable_category";
    store.toggleDisabledCategory(interaction.guildId, category, disabled);
    await interaction.editReply({
      content: `${disabled ? "Disabled" : "Enabled"} category **${CATEGORY_LABELS[category] || category}**.`,
    });
    return;
  }

  if (subcommand === "disable_game" || subcommand === "enable_game") {
    const game = interaction.options.getString("game", true);
    const disabled = subcommand === "disable_game";
    store.toggleDisabledGame(interaction.guildId, game, disabled);
    await interaction.editReply({
      content: `${disabled ? "Disabled" : "Enabled"} game **${GAME_LABELS[game] || game}**.`,
    });
  }
}

function isValidTime(value) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

async function handleAutopostCommand(interaction) {
  ensureGuildInteraction(interaction);
  await interaction.deferReply({ ephemeral: true });

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "list") {
    const schedules = store.listSchedules(interaction.guildId);
    await interaction.editReply({
      content: schedules.length > 0
        ? schedules.map((schedule) => {
          return `#${schedule.id} <#${schedule.channelId}> | ${schedule.time} ${schedule.timezone} | ${GAME_LABELS[schedule.game] || schedule.game} | ${schedule.rating} | ${schedule.category === "any" ? "Any" : (CATEGORY_LABELS[schedule.category] || schedule.category)}`;
        }).join("\n")
        : "No autopost schedules set.",
    });
    return;
  }

  if (subcommand === "delete") {
    const id = interaction.options.getInteger("id", true);
    store.deleteSchedule(interaction.guildId, id);
    await interaction.editReply({ content: `Deleted schedule **#${id}**.` });
    return;
  }

  const channel = interaction.options.getChannel("channel", true);
  const time = interaction.options.getString("time", true);
  const timezone = interaction.options.getString("timezone", true);
  const game = interaction.options.getString("game") || "truth_or_dare";
  const category = interaction.options.getString("category") || "any";
  const rating = interaction.options.getString("rating") || store.getGuildConfig(interaction.guildId).defaultRating;

  if (!isValidTime(time)) {
    await interaction.editReply({ content: "Time must be in 24h format like `09:30` or `21:45`." });
    return;
  }

  const zoneCheck = DateTime.now().setZone(timezone);
  if (!zoneCheck.isValid) {
    await interaction.editReply({ content: "Timezone is invalid. Use an IANA zone like `Asia/Calcutta` or `Europe/London`." });
    return;
  }

  store.saveSchedule({
    guildId: interaction.guildId,
    channelId: channel.id,
    game,
    category,
    rating,
    time,
    timezone,
    enabled: true,
    createdBy: interaction.user.id,
  });

  await interaction.editReply({
    content: `Saved daily autopost for <#${channel.id}> at **${time} ${timezone}** using **${GAME_LABELS[game] || game}**.`,
  });
}

async function handleStatsCommand(interaction) {
  ensureGuildInteraction(interaction);
  await interaction.deferReply({ ephemeral: true });

  const counts = promptEngine.getCounts();
  const promptStats = store.getPromptStats(interaction.guildId, interaction.channelId);
  const schedules = store.listSchedules(interaction.guildId);
  const guildConfig = store.getGuildConfig(interaction.guildId);

  await interaction.editReply({
    content: [
      `Catalog totals: ${Object.entries(counts).map(([game, count]) => `${GAME_LABELS[game] || game} ${count}`).join(" | ")}`,
      `Emitted in this channel: **${promptStats.emitted}**`,
      `Reports in this server: **${promptStats.reports}**`,
      `Blacklisted prompts: **${promptStats.blacklisted}**`,
      `Daily schedules: **${schedules.length}**`,
      `Default rating: **${guildConfig.defaultRating}** | Timeout: **${guildConfig.buttonTimeoutSeconds}s**`,
    ].join("\n"),
  });
}

async function handlePromptButton(interaction) {
  await interaction.deferUpdate();

  const [, game, rating, category] = interaction.customId.split("|");
  const prompt = await resolvePromptFromInteraction({
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    userTag: interaction.user.tag,
    game,
    category,
    rating,
  });

  if (interaction.message && interaction.message.editable) {
    await interaction.message.edit({ components: [] });
  }

  await sendPromptMessage({
    channel: interaction.channel,
    prompt,
    requester: interaction.user,
    requesterId: interaction.user.id,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
  });
}

async function handleReportButton(interaction) {
  await interaction.deferUpdate();

  const [, promptId] = interaction.customId.split("|");
  const result = store.reportPrompt(promptId, interaction.user.id, "Reported from prompt button");

  if (interaction.message && interaction.message.editable) {
    await interaction.message.edit({ components: [] });
  }

  const content = !result
    ? "That prompt could not be found anymore."
    : result.duplicate
      ? "You already reported that prompt."
      : "Prompt reported and blacklisted.";

  await interaction.followUp({
    content,
    ephemeral: true,
  });
}

async function refreshSessionMessage(interaction, session) {
  await interaction.update({
    embeds: [createSessionEmbed(sessionService, session)],
    components: session.status === "active" ? [createSessionButtons(session)] : [],
  });
}

async function handleSessionButton(interaction) {
  const [, action, sessionId] = interaction.customId.split("|");
  const session = store.getSession(sessionId);

  if (!session) {
    await interaction.reply({ content: "That session no longer exists.", ephemeral: true });
    return;
  }

  if (sessionService.isExpired(session)) {
    const ended = sessionService.endSession(sessionId);
    await interaction.update({
      embeds: [createSessionEmbed(sessionService, ended)],
      components: [],
    });
    return;
  }

  if (action === "join") {
    const updated = sessionService.joinSession(sessionId, interaction.user);
    await refreshSessionMessage(interaction, updated);
    return;
  }

  if (action === "complete") {
    const updated = sessionService.recordComplete(sessionId, interaction.user);
    await refreshSessionMessage(interaction, updated);
    return;
  }

  if (action === "miss") {
    const updated = sessionService.recordMiss(sessionId, interaction.user);
    await refreshSessionMessage(interaction, updated);
    return;
  }

  if (action === "next") {
    if (!canControlSession(interaction, session)) {
      await interaction.reply({ content: "Only the session host or a server manager can advance the session.", ephemeral: true });
      return;
    }

    const nextPrompt = await resolvePromptFromInteraction({
      guildId: session.guildId,
      channelId: session.channelId,
      userTag: interaction.user.tag,
      game: session.game,
      category: session.category,
      rating: session.rating,
    });

    store.recordPromptEmission(nextPrompt, {
      guildId: session.guildId,
      channelId: session.channelId,
      requesterId: interaction.user.id,
    });

    const updated = sessionService.updatePrompt(sessionId, nextPrompt);
    if (sessionService.isExpired(updated)) {
      const ended = sessionService.endSession(sessionId);
      await interaction.update({
        embeds: [createSessionEmbed(sessionService, ended)],
        components: [],
      });
      return;
    }

    await refreshSessionMessage(interaction, updated);
    return;
  }

  if (action === "end") {
    if (!canControlSession(interaction, session)) {
      await interaction.reply({ content: "Only the session host or a server manager can end the session.", ephemeral: true });
      return;
    }

    const ended = sessionService.endSession(sessionId);
    await interaction.update({
      embeds: [createSessionEmbed(sessionService, ended)],
      components: [],
    });
  }
}

client.on("ready", async () => {
  clearStartupTimeout();
  login429CooldownMs = LOGIN_429_COOLDOWN_MS;

  sendStatus({
    phase: "discord_ready",
    discordReady: true,
    botUser: client.user ? client.user.tag : null,
    lastError: null,
  });

  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Catalog loaded with ${Object.values(promptEngine.getCounts()).reduce((sum, count) => sum + count, 0)} prompts.`);

  if (!commandsRegistered) {
    try {
      const commands = getCommandPayload();
      const scope = await registerCommands({
        token: config.discordToken,
        clientId: config.discordClientId,
        guildId: config.discordGuildId,
        commands,
      });

      commandsRegistered = true;
      console.log(`Slash commands registered (${scope}).`);
    } catch (error) {
      console.error("Slash command registration failed:", error);
      sendStatus({
        phase: "command_registration_failed",
        discordReady: true,
        botUser: client.user ? client.user.tag : null,
        lastError: error.message,
      });
    }
  }

  if (!schedulerService) {
    schedulerService = new SchedulerService({
      client,
      store,
      promptEngine,
      sendPromptMessage,
      intervalMs: Math.max(15, config.schedulerIntervalSeconds) * 1000,
    });
  }

  schedulerService.start();
});

client.on("error", (error) => {
  console.error("Discord client error:", error);
  sendStatus({
    phase: "discord_client_error",
    discordReady: client.isReady(),
    botUser: client.user ? client.user.tag : null,
    lastError: error.message,
  });
});

client.on("shardError", (error) => {
  console.error("Discord shard error:", error);
  sendStatus({
    phase: "discord_shard_error",
    discordReady: client.isReady(),
    botUser: client.user ? client.user.tag : null,
    lastError: error.message,
  });
});

client.on("shardDisconnect", (event, shardId) => {
  console.error(`Discord shard ${shardId} disconnected with code ${event.code}.`);
  sendStatus({
    phase: "discord_disconnected",
    discordReady: false,
    botUser: client.user ? client.user.tag : null,
    lastError: `Shard ${shardId} disconnected with code ${event.code}`,
  });
});

client.on("shardReconnecting", (shardId) => {
  console.log(`Discord shard ${shardId} reconnecting...`);
  sendStatus({
    phase: "discord_reconnecting",
    discordReady: false,
    botUser: client.user ? client.user.tag : null,
    lastError: `Shard ${shardId} reconnecting`,
  });
});

client.on("shardResume", (replayedEvents, shardId) => {
  console.log(`Discord shard ${shardId} resumed with ${replayedEvents} replayed events.`);
  sendStatus({
    phase: "discord_ready",
    discordReady: true,
    botUser: client.user ? client.user.tag : null,
    lastError: null,
  });
});

client.on("invalidated", () => {
  console.error("Discord session invalidated.");
  clearStartupTimeout();
  sendStatus({
    phase: "discord_invalidated",
    discordReady: false,
    botUser: client.user ? client.user.tag : null,
    lastError: "Session invalidated by Discord",
  });
  process.exit(1);
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "truthordare") {
        await handlePlayCommand(interaction);
        return;
      }

      if (Object.prototype.hasOwnProperty.call(PLAY_COMMAND_DEFAULTS, interaction.commandName)) {
        await handlePlayCommand(interaction, PLAY_COMMAND_DEFAULTS[interaction.commandName]);
        return;
      }

      if (interaction.commandName === "todcategory") {
        await handleCategoryCommand(interaction);
        return;
      }

      if (interaction.commandName === "todconfig") {
        await handleConfigCommand(interaction);
        return;
      }

      if (interaction.commandName === "todautopost") {
        await handleAutopostCommand(interaction);
        return;
      }

      if (interaction.commandName === "todstats") {
        await handleStatsCommand(interaction);
      }

      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId.startsWith("prompt|")) {
        await handlePromptButton(interaction);
        return;
      }

      if (interaction.customId.startsWith("report|")) {
        await handleReportButton(interaction);
        return;
      }

      if (interaction.customId.startsWith("session|")) {
        await handleSessionButton(interaction);
      }
    }
  } catch (error) {
    console.error("Interaction error:", error);

    if (interaction.isRepliable()) {
      const message = error.message || "Something broke while processing that action.";
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: message, ephemeral: true });
      } else {
        await interaction.reply({ content: message, ephemeral: true });
      }
    }
  }
});

function cleanupAndExit() {
  clearStartupTimeout();
  if (schedulerService) {
    schedulerService.stop();
  }
  for (const timer of componentExpiryTimers.values()) {
    clearTimeout(timer);
  }
  componentExpiryTimers.clear();
  client.destroy();
  process.exit(0);
}

process.on("SIGTERM", cleanupAndExit);
process.on("SIGINT", cleanupAndExit);

async function initializeServices() {
  store = await BotStore.create(config.databaseFile);
  const aiPromptService = new AIPromptService({
    apiKey: config.openAIApiKey,
    model: config.openAIModel,
  });

  promptEngine = new PromptEngine({
    aiPromptService,
    store,
    recentHistoryLimit: 220,
  });
  sessionService = new SessionService(store);
}

async function start() {
  await initializeServices();

  while (true) {
    const loginStartedAt = new Date().toISOString();

    sendStatus({
      phase: "connecting_gateway",
      discordReady: false,
      botUser: null,
      lastError: null,
      loginStartedAt,
    });

    console.log("Connecting to Discord gateway...");
    armStartupTimeout();

    try {
      await client.login(config.discordToken);
      return;
    } catch (error) {
      clearStartupTimeout();
      console.error("Discord login failed:", error);

      if (!isDiscordRateLimit(error)) {
        sendStatus({
          phase: "discord_start_failed",
          discordReady: false,
          botUser: null,
          lastError: error.message,
          loginStartedAt,
        });
        process.exit(1);
      }

      const retryAfterMs = Math.min(
        Math.max(extractRetryAfterMs(error, login429CooldownMs), LOGIN_429_COOLDOWN_MS),
        LOGIN_429_COOLDOWN_MAX_MS,
      );
      const retryMessage = `Discord login rate limited. Retrying in ${Math.round(retryAfterMs / 1000)}s.`;

      sendStatus({
        phase: "discord_login_rate_limited",
        discordReady: false,
        botUser: null,
        lastError: retryMessage,
        loginStartedAt,
      });

      console.error(retryMessage);
      client.destroy();
      await sleep(retryAfterMs);
      login429CooldownMs = Math.min(login429CooldownMs * 2, LOGIN_429_COOLDOWN_MAX_MS);
    }
  }
}

start().catch((error) => {
  console.error("Fatal bot startup error:", error);
  process.exit(1);
});
