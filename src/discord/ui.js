const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");
const { CATEGORY_LABELS, GAME_COLORS, GAME_LABELS } = require("../questions/catalog");

function formatRequester(requester) {
  if (!requester) {
    return null;
  }

  if (typeof requester === "string") {
    return { label: requester, avatarUrl: null };
  }

  if (requester.label) {
    return requester;
  }

  return {
    label: requester.globalName || requester.username || "Unknown",
    avatarUrl: requester.displayAvatarURL ? requester.displayAvatarURL({ size: 64 }) : null,
  };
}

function createPromptEmbed(prompt, requester) {
  const requesterMeta = formatRequester(requester);
  const color = GAME_COLORS[prompt.game] || 0x5865f2;
  const footerParts = [];
  const gameLabel = GAME_LABELS[prompt.game] || prompt.game;
  const categoryLabel = CATEGORY_LABELS[prompt.category] || prompt.category;

  if (prompt.game === "truth" || prompt.game === "dare") {
    footerParts.push(`Type: ${prompt.game.toUpperCase()}`);
  } else {
    footerParts.push(`Category: ${categoryLabel.toUpperCase()}`);
  }

  if (prompt.game === "truth" || prompt.game === "dare") {
    footerParts.push(`Category: ${categoryLabel.toUpperCase()}`);
  }
  footerParts.push(`Rating: ${prompt.rating}`);
  footerParts.push(`ID: ${prompt.id}`);

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(prompt.text)
    .setFooter({ text: footerParts.join(" | ") });

  if (requesterMeta && requesterMeta.label) {
    embed.setAuthor({
      name: (prompt.game === "truth" || prompt.game === "dare")
        ? `Requested by ${requesterMeta.label}`
        : `${gameLabel} • Requested by ${requesterMeta.label}`,
      iconURL: requesterMeta.avatarUrl || undefined,
    });
  }

  return embed;
}

function createPromptButtons(prompt) {
  if (prompt.game === "truth" || prompt.game === "dare") {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`prompt|truth|${prompt.rating}|${prompt.category}`)
        .setLabel("Truth")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`prompt|dare|${prompt.rating}|${prompt.category}`)
        .setLabel("Dare")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`prompt|truth_or_dare|${prompt.rating}|${prompt.category}`)
        .setLabel("Random")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`report|${prompt.id}`)
        .setLabel("Report")
        .setStyle(ButtonStyle.Secondary),
    );
  }

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`prompt|${prompt.game}|${prompt.rating}|${prompt.category}`)
      .setLabel("Another")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`prompt|${prompt.game}|${prompt.rating}|any`)
      .setLabel("Any Category")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`report|${prompt.id}`)
      .setLabel("Report")
      .setStyle(ButtonStyle.Secondary),
  );
}

function createSessionEmbed(sessionService, session) {
  const summary = sessionService.buildSessionSummary(session);
  const prompt = session.state.prompt;
  const gameLabel = GAME_LABELS[session.game] || session.game;
  const categoryLabel = CATEGORY_LABELS[prompt.category] || prompt.category;

  return new EmbedBuilder()
    .setColor(GAME_COLORS[prompt.game] || 0x5865f2)
    .setTitle(summary.title)
    .setDescription([
      `**Current prompt**`,
      prompt.text,
      "",
      `Game: **${gameLabel}** | Category: **${categoryLabel}** | Rating: **${session.rating}**`,
      summary.roundLabel,
      "",
      `**Leaderboard**`,
      summary.leaderboard,
    ].join("\n"));
}

function createSessionButtons(session) {
  const buttons = [
    new ButtonBuilder()
      .setCustomId(`session|join|${session.sessionId}`)
      .setLabel("Join")
      .setStyle(ButtonStyle.Secondary),
  ];

  if (session.mode === "streak") {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`session|complete|${session.sessionId}`)
        .setLabel("Complete")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`session|miss|${session.sessionId}`)
        .setLabel("Miss")
        .setStyle(ButtonStyle.Danger),
    );
  } else {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`session|complete|${session.sessionId}`)
        .setLabel("Complete +1")
        .setStyle(ButtonStyle.Success),
    );
  }

  buttons.push(
    new ButtonBuilder()
      .setCustomId(`session|next|${session.sessionId}`)
      .setLabel("Next")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`session|end|${session.sessionId}`)
      .setLabel("End")
      .setStyle(ButtonStyle.Secondary),
  );

  return new ActionRowBuilder().addComponents(buttons);
}

module.exports = {
  createPromptButtons,
  createPromptEmbed,
  createSessionButtons,
  createSessionEmbed,
};
