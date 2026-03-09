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

http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("alive");
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
  const commands = getCommandPayload();
  const scope = await registerCommands({
    token: config.discordToken,
    clientId: config.discordClientId,
    guildId: config.discordGuildId,
    commands,
  });

  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Prompt pool loaded: ${promptEngine.getCounts().truth} truths, ${promptEngine.getCounts().dare} dares.`);
  console.log(`Slash commands registered (${scope}).`);
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

client.login(config.discordToken);
