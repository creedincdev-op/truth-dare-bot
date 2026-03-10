const {
  Client,
  GatewayIntentBits,
} = require("discord.js");
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
  restStatus: null,
  gatewayStatus: null,
  clientIdMatches: null,
  botId: null,
};

async function readJson(response) {
  const text = await response.text();

  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

async function validateDiscordApi() {
  runtimeState.phase = "validating_discord_api";
  runtimeState.lastError = null;
  console.log("Validating Discord REST API access...");

  const headers = {
    Authorization: `Bot ${config.discordToken}`,
  };

  const meResponse = await fetch("https://discord.com/api/v10/users/@me", {
    headers,
  });
  const meBody = await readJson(meResponse);
  runtimeState.restStatus = meResponse.status;

  if (!meResponse.ok) {
    throw new Error(`Discord REST validation failed with status ${meResponse.status}`);
  }

  runtimeState.botId = meBody.id || null;
  runtimeState.clientIdMatches = Boolean(meBody.id && meBody.id === config.discordClientId);
  console.log(`Discord REST token validated for bot ${meBody.username} (${meBody.id}).`);

  if (!runtimeState.clientIdMatches) {
    throw new Error("DISCORD_CLIENT_ID does not match the bot user id for DISCORD_TOKEN");
  }

  const gatewayResponse = await fetch("https://discord.com/api/v10/gateway/bot", {
    headers,
  });
  runtimeState.gatewayStatus = gatewayResponse.status;

  if (!gatewayResponse.ok) {
    throw new Error(`Discord gateway probe failed with status ${gatewayResponse.status}`);
  }

  console.log("Discord gateway endpoint reachable.");
}

http.createServer((req, res) => {
  const discordReady = client.isReady();
  const payload = {
    discordReady,
    botUser: client.user ? client.user.tag : null,
    phase: runtimeState.phase,
    lastError: runtimeState.lastError,
    restStatus: runtimeState.restStatus,
    gatewayStatus: runtimeState.gatewayStatus,
    clientIdMatches: runtimeState.clientIdMatches,
    botId: runtimeState.botId,
    uptimeSeconds: Math.floor(process.uptime()),
  };

  if (req.url === "/ping") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, uptimeSeconds: payload.uptimeSeconds }));
    return;
  }

  if (req.url === "/health") {
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

client.once("ready", async () => {
  runtimeState.phase = "discord_ready";
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Prompt pool loaded: ${promptEngine.getCounts().truth} truths, ${promptEngine.getCounts().dare} dares.`);

  try {
    const commands = getCommandPayload();
    const scope = await registerCommands({
      token: config.discordToken,
      clientId: config.discordClientId,
      guildId: config.discordGuildId,
      commands,
    });

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
  try {
    await validateDiscordApi();
    runtimeState.phase = "connecting_gateway";
    console.log("Connecting to Discord gateway...");
    await client.login(config.discordToken);
  } catch (error) {
    runtimeState.phase = "discord_start_failed";
    runtimeState.lastError = error.message;
    console.error("Discord login failed:", error);
  }
}

start();
