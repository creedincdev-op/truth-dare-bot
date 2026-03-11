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

function readFirstEnv(names, fallback = "") {
  for (const name of names) {
    const value = readEnv(name);
    if (value) {
      return value;
    }
  }

  return fallback;
}

const config = {
  discordToken: readFirstEnv(["DISCORD_TOKEN", "BOT_TOKEN"]),
  discordClientId: readFirstEnv(["DISCORD_CLIENT_ID", "CLIENT_ID"]),
  discordGuildId: readFirstEnv(["DISCORD_GUILD_ID", "GUILD_ID"]),
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
