const {
  Client,
  GatewayIntentBits,
} = require("discord.js");
const { once } = require("events");
const http = require("http");
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

const port = Number(process.env.PORT || 10000);
const runtimeState = {
  phase: "booting",
  lastError: null,
  loginStartedAt: null,
  reconnectAt: null,
  startAttempts: 0,
};
let recoveryTimer = null;
let hasEverBeenReady = false;
let loginInFlight = false;
let commandsRegistered = false;
const STARTUP_READY_TIMEOUT_MS = 10 * 60 * 1000;
const DISCONNECT_RECOVERY_TIMEOUT_MS = 3 * 60 * 1000;
const RETRY_DELAY_MS = 60 * 1000;

function clearRecoveryTimer() {
  if (recoveryTimer) {
    clearTimeout(recoveryTimer);
    recoveryTimer = null;
  }

  runtimeState.reconnectAt = null;
}

function scheduleRecovery(reason, delayMs) {
  runtimeState.lastError = reason;
  runtimeState.reconnectAt = new Date(Date.now() + delayMs).toISOString();

  if (recoveryTimer) {
    return;
  }

  console.error(`${reason}. Retrying Discord connection in ${Math.round(delayMs / 1000)}s if Discord does not recover.`);
  recoveryTimer = setTimeout(() => {
    clearRecoveryTimer();

    if (!client.isReady()) {
      console.error(`Recovery timeout reached: ${reason}. Reconnecting Discord client.`);
      client.destroy();
      void start();
    }
  }, delayMs);
}

http.createServer((req, res) => {
  const discordReady = client.isReady();
  const payload = {
    discordReady,
    botUser: client.user ? client.user.tag : null,
    phase: runtimeState.phase,
    lastError: runtimeState.lastError,
    loginStartedAt: runtimeState.loginStartedAt,
    reconnectAt: runtimeState.reconnectAt,
    startAttempts: runtimeState.startAttempts,
    uptimeSeconds: Math.floor(process.uptime()),
  };

  if (req.url === "/ping" || req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, uptimeSeconds: payload.uptimeSeconds }));
    return;
  }

  if (req.url === "/health" || req.url === "/readyz") {
    res.writeHead(discordReady ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
    return;
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}).listen(port, "0.0.0.0", () => {
  console.log(`Health server listening on ${port}`);
});

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
  hasEverBeenReady = true;
  runtimeState.phase = "discord_ready";
  runtimeState.lastError = null;
  clearRecoveryTimer();
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
  }
});

client.on("error", (error) => {
  runtimeState.phase = "discord_client_error";
  runtimeState.lastError = error.message;
  console.error("Discord client error:", error);
});

client.on("shardError", (error) => {
  runtimeState.phase = "discord_shard_error";
  runtimeState.lastError = error.message;
  console.error("Discord shard error:", error);
  if (hasEverBeenReady) {
    scheduleRecovery(`Discord shard error: ${error.message}`, DISCONNECT_RECOVERY_TIMEOUT_MS);
  }
});

client.on("shardDisconnect", (event, shardId) => {
  runtimeState.phase = "discord_disconnected";
  runtimeState.lastError = `Shard ${shardId} disconnected with code ${event.code}`;
  console.error(`Discord shard ${shardId} disconnected with code ${event.code}.`);
  if (hasEverBeenReady) {
    scheduleRecovery(runtimeState.lastError, DISCONNECT_RECOVERY_TIMEOUT_MS);
  }
});

client.on("shardReconnecting", (shardId) => {
  runtimeState.phase = "discord_reconnecting";
  runtimeState.lastError = `Shard ${shardId} reconnecting`;
  console.log(`Discord shard ${shardId} reconnecting...`);
});

client.on("shardResume", (replayedEvents, shardId) => {
  runtimeState.phase = "discord_ready";
  runtimeState.lastError = null;
  clearRecoveryTimer();
  console.log(`Discord shard ${shardId} resumed with ${replayedEvents} replayed events.`);
});

client.on("invalidated", () => {
  runtimeState.phase = "discord_invalidated";
  runtimeState.lastError = "Session invalidated by Discord";
  console.error("Discord session invalidated.");
  client.destroy();
  scheduleRecovery(runtimeState.lastError, RETRY_DELAY_MS);
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

async function start() {
  if (loginInFlight || client.isReady()) {
    return;
  }

  loginInFlight = true;

  try {
    runtimeState.phase = "connecting_gateway";
    runtimeState.loginStartedAt = new Date().toISOString();
    runtimeState.reconnectAt = null;
    runtimeState.startAttempts += 1;
    runtimeState.lastError = null;
    console.log("Connecting to Discord gateway...");
    const readyPromise = once(client, "ready");

    await client.login(config.discordToken);
    await Promise.race([
      readyPromise,
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error("Discord gateway connection timed out before ready"));
        }, STARTUP_READY_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    runtimeState.phase = "discord_reconnect_wait";
    runtimeState.lastError = error.message;
    console.error("Discord login failed:", error);
    client.destroy();
    scheduleRecovery(`Discord login failed: ${error.message}`, RETRY_DELAY_MS);
  } finally {
    loginInFlight = false;
  }
}

start();
