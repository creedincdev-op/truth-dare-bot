const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");

const TYPE_STYLES = {
  truth: {
    label: "Truth",
    color: 0x2ecc71,
    buttonStyle: ButtonStyle.Success,
  },
  dare: {
    label: "Dare",
    color: 0xe74c3c,
    buttonStyle: ButtonStyle.Danger,
  },
};

function createPromptEmbed(prompt, requesterUser) {
  const style = TYPE_STYLES[prompt.type] || TYPE_STYLES.truth;
  const requesterName = requesterUser?.globalName || requesterUser?.username || prompt.requesterTag;
  const avatarUrl = requesterUser?.displayAvatarURL?.({ size: 64 }) || null;

  const embed = new EmbedBuilder()
    .setColor(style.color)
    // Put the question in title for the largest embed text size Discord supports.
    .setTitle(prompt.text)
    .setFooter({
      text: `Type: ${style.label.toUpperCase()} | Rating: ${prompt.rating} | ID: ${prompt.id}`,
    });

  if (requesterName) {
    embed.setAuthor({
      name: `Requested by ${requesterName}`,
      iconURL: avatarUrl || undefined,
    });
  }

  return embed;
}

function createPromptButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("tod:truth")
      .setLabel("Truth")
      .setStyle(TYPE_STYLES.truth.buttonStyle),
    new ButtonBuilder()
      .setCustomId("tod:dare")
      .setLabel("Dare")
      .setStyle(TYPE_STYLES.dare.buttonStyle),
    new ButtonBuilder()
      .setCustomId("tod:random")
      .setLabel("Random")
      .setStyle(ButtonStyle.Primary)
  );
}

module.exports = {
  createPromptEmbed,
  createPromptButtons,
};
