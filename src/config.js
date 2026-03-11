const dotenv = require("dotenv");

dotenv.config();

function readEnv(name, fallback = "") {
  const value = process.env[name];

  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().replace(/^['"]+|['"]+$/g, "");
  return normalized || fallback;
}

const config = {
  discordToken: readEnv("DISCORD_TOKEN"),
  discordClientId: readEnv("DISCORD_CLIENT_ID"),
  discordGuildId: readEnv("DISCORD_GUILD_ID"),
  openAIApiKey: readEnv("OPENAI_API_KEY"),
  openAIModel: readEnv("OPENAI_MODEL", "gpt-4.1-mini"),
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
