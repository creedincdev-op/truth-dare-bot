const { REST, Routes } = require("discord.js");

async function registerCommands({ token, clientId, guildId, commands }) {
  const rest = new REST({ version: "10" }).setToken(token);

  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commands,
    });
    return "guild";
  }

  await rest.put(Routes.applicationCommands(clientId), {
    body: commands,
  });
  return "global";
}

module.exports = {
  registerCommands,
};