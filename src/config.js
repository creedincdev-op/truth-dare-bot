const dotenv = require("dotenv");

dotenv.config();

const config = {
  discordToken: process.env.DISCORD_TOKEN || "",
  discordClientId: process.env.DISCORD_CLIENT_ID || "",
  discordGuildId: process.env.DISCORD_GUILD_ID || "",
  openAIApiKey: process.env.OPENAI_API_KEY || "",
  openAIModel: process.env.OPENAI_MODEL || "gpt-4.1-mini",
};

function assertConfig() {
  const missing = [];

  if (!config.discordToken) {
    missing.push("DISCORD_TOKEN");
  }
  if (!config.discordClientId) {
    missing.push("DISCORD_CLIENT_ID");
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

module.exports = {
  config,
  assertConfig,
};