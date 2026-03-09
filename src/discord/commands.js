const { SlashCommandBuilder } = require("discord.js");

const truthOrDareCommand = new SlashCommandBuilder()
  .setName("truthordare")
  .setDescription("Get a Truth, Dare, or Random challenge panel.")
  .addStringOption((option) =>
    option
      .setName("mode")
      .setDescription("Choose what prompt type you want")
      .setRequired(false)
      .addChoices(
        { name: "Random", value: "random" },
        { name: "Truth", value: "truth" },
        { name: "Dare", value: "dare" }
      )
  );

const statsCommand = new SlashCommandBuilder()
  .setName("todstats")
  .setDescription("Show prompt pool size and anti-repeat status.");

function getCommandPayload() {
  return [truthOrDareCommand.toJSON(), statsCommand.toJSON()];
}

module.exports = {
  getCommandPayload,
};