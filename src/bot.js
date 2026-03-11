const {
  Client,
  GatewayIntentBits,
} = require("discord.js");
const { config, assertConfig } = require("./config");
const { getCommandPayload } = require("./discord/commands");
const { registerCommands } = require("./discord/registerCommands");
const { createPromptEmbed, createPromptButtons } = require("./discord/ui");
const { AIPromptService } = require("./services/aiPromptService");
const { PromptEngine } = require("./questions/promptEngine");

assertConfig();

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const aiPromptService = new AIPromptService({
  apiKey: config.openAIApiKey,
  model: config.openAIModel,
});

const promptEngine = new PromptEngine({
  aiPromptService,
  recentHistoryLimit: 180,
});

let commandsRegistered = false;
let recoveryTimer = null;
const STARTUP_READY_TIMEOUT_MS = 10 * 60 * 1000;
const DISCONNECT_RECOVERY_TIMEOUT_MS = 3 * 60 * 1000;
const LOGIN_429_COOLDOWN_MS = Math.max(60, Number(process.env.BOT_LOGIN_429_COOLDOWN || 900)) * 1000;
const LOGIN_429_COOLDOWN_MAX_MS = Math.max(
  LOGIN_429_COOLDOWN_MS,
  Number(process.env.BOT_LOGIN_429_COOLDOWN_MAX || 3600) * 1000,
);
let login429CooldownMs = LOGIN_429_COOLDOWN_MS;

function sendStatus(update) {
  if (typeof process.send === "function") {
    process.send({ type: "status", ...update });
  }
}

function clearRecoveryTimer() {
  if (recoveryTimer) {
    clearTimeout(recoveryTimer);
    recoveryTimer = null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isDiscordRateLimit(error) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const message = typeof error.message === "string" ? error.message : "";
  return Number(error.status) === 429 || Number(error.code) === 429 || /\b429\b/.test(message);
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

function scheduleExit(reason, delayMs) {
  if (recoveryTimer) {
    return;
  }

  console.error(`${reason}. Exiting child in ${Math.round(delayMs / 1000)}s if Discord does not recover.`);
  recoveryTimer = setTimeout(() => {
    clearRecoveryTimer();

    if (!client.isReady()) {
      console.error(`Child recovery timeout reached: ${reason}. Exiting child process.`);
      process.exit(1);
    }
  }, delayMs);
}

async function handleTruthOrDareCommand(interaction) {
  const mode = interaction.options.getString("mode") || "random";
  const prompt = await promptEngine.getNextPrompt({
    mode,
    channelId: interaction.channelId,
    requesterTag: interaction.user.tag,
  });

  await interaction.reply({
    embeds: [createPromptEmbed(prompt, interaction.user)],
    components: [createPromptButtons()],
  });
}

async function handleStatsCommand(interaction) {
  const counts = promptEngine.getCounts();
  const channelStats = promptEngine.getChannelStats(interaction.channelId);

  const content = [
    `Truth pool: **${counts.truth.toLocaleString()}**`,
    `Dare pool: **${counts.dare.toLocaleString()}**`,
    `Channel recent history: **${channelStats.historySize}**`,
    `Unique truths used in channel: **${channelStats.truthUsed}**`,
    `Unique dares used in channel: **${channelStats.dareUsed}**`,
    `AI fallback: **${aiPromptService.enabled ? "ON" : "OFF"}**`,
  ].join("\n");

  await interaction.reply({
    content,
    ephemeral: true,
  });
}

async function handleButton(interaction) {
  const [, mode] = interaction.customId.split(":");
  const prompt = await promptEngine.getNextPrompt({
    mode,
    channelId: interaction.channelId,
    requesterTag: interaction.user.tag,
  });

  await interaction.deferUpdate();

  if (interaction.message && interaction.message.editable) {
    await interaction.message.edit({ components: [] });
  }

  await interaction.followUp({
    embeds: [createPromptEmbed(prompt, interaction.user)],
    components: [createPromptButtons()],
  });
}

client.on("ready", async () => {
  clearRecoveryTimer();
  login429CooldownMs = LOGIN_429_COOLDOWN_MS;
  sendStatus({
    phase: "discord_ready",
    discordReady: true,
    botUser: client.user ? client.user.tag : null,
    lastError: null,
  });

  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Prompt pool loaded: ${promptEngine.getCounts().truth} truths, ${promptEngine.getCounts().dare} dares.`);

  if (commandsRegistered) {
    return;
  }

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
    discordReady: false,
    botUser: client.user ? client.user.tag : null,
    lastError: error.message,
  });
  scheduleExit(`Discord shard error: ${error.message}`, DISCONNECT_RECOVERY_TIMEOUT_MS);
});

client.on("shardDisconnect", (event, shardId) => {
  console.error(`Discord shard ${shardId} disconnected with code ${event.code}.`);
  sendStatus({
    phase: "discord_disconnected",
    discordReady: false,
    botUser: client.user ? client.user.tag : null,
    lastError: `Shard ${shardId} disconnected with code ${event.code}`,
  });
  scheduleExit(`Shard ${shardId} disconnected with code ${event.code}`, DISCONNECT_RECOVERY_TIMEOUT_MS);
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
  clearRecoveryTimer();
  login429CooldownMs = LOGIN_429_COOLDOWN_MS;
  sendStatus({
    phase: "discord_ready",
    discordReady: true,
    botUser: client.user ? client.user.tag : null,
    lastError: null,
  });
});

client.on("invalidated", () => {
  console.error("Discord session invalidated.");
  clearRecoveryTimer();
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
        await handleTruthOrDareCommand(interaction);
        return;
      }

      if (interaction.commandName === "todstats") {
        await handleStatsCommand(interaction);
      }

      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("tod:")) {
      await handleButton(interaction);
    }
  } catch (error) {
    console.error("Interaction error:", error);

    if (interaction.isRepliable()) {
      const message = "Something broke while generating the prompt. Try again.";
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: message, ephemeral: true });
      } else {
        await interaction.reply({ content: message, ephemeral: true });
      }
    }
  }
});

process.on("SIGTERM", () => {
  client.destroy();
  process.exit(0);
});

process.on("SIGINT", () => {
  client.destroy();
  process.exit(0);
});

async function start() {
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
    scheduleExit("Discord gateway connection timed out before ready", STARTUP_READY_TIMEOUT_MS);

    try {
      await client.login(config.discordToken);
      return;
    } catch (error) {
      clearRecoveryTimer();
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

start();
