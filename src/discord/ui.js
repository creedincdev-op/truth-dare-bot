const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
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

function buildAuthorLabel(prompt, requesterMeta) {
  const requesterLabel = requesterMeta && requesterMeta.label ? requesterMeta.label : "Unknown";
  const gameLabel = GAME_LABELS[prompt.game] || prompt.game;
  return `${gameLabel} | Requested by ${requesterLabel}`;
}

function createPromptEmbed(prompt, requester) {
  const requesterMeta = formatRequester(requester);
  const footerParts = [];
  const color = GAME_COLORS[prompt.game] || 0x5865f2;
  const categoryLabel = CATEGORY_LABELS[prompt.category] || prompt.category;

  if (prompt.game === "truth" || prompt.game === "dare") {
    footerParts.push(`Type: ${prompt.game.toUpperCase()}`);
    footerParts.push(`Category: ${categoryLabel.toUpperCase()}`);
  } else {
    footerParts.push(`Category: ${categoryLabel.toUpperCase()}`);
  }

  footerParts.push(`Rating: ${prompt.rating}`);
  footerParts.push(`ID: ${prompt.id}`);

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(prompt.text)
    .setFooter({ text: footerParts.join(" | ") });

  if (requesterMeta) {
    embed.setAuthor({
      name: buildAuthorLabel(prompt, requesterMeta),
      iconURL: requesterMeta.avatarUrl || undefined,
    });
  }

  if (prompt.game === "never_have_i_ever") {
    embed.setDescription("**Never Have I Ever**");
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

  if (prompt.game === "never_have_i_ever") {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`prompt|never_have_i_ever|${prompt.rating}|${prompt.category}`)
        .setLabel("Next Never Have I Ever")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`prompt|never_have_i_ever|${prompt.rating}|any`)
        .setLabel("Any Category")
        .setStyle(ButtonStyle.Success),
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

function createParanoiaDmEmbed(round, requester) {
  const requesterMeta = formatRequester(requester);
  const embed = new EmbedBuilder()
    .setColor(GAME_COLORS.paranoia)
    .setTitle(round.prompt.text)
    .setDescription([
      "**Paranoia**",
      "Reply honestly.",
      "Your answer will be revealed back in the server without naming you.",
    ].join("\n"))
    .setFooter({ text: `Rating: ${round.prompt.rating} | ID: ${round.prompt.id}` });

  if (requesterMeta) {
    embed.setAuthor({
      name: `Private round from ${requesterMeta.label}`,
      iconURL: requesterMeta.avatarUrl || undefined,
    });
  }

  return embed;
}

function createParanoiaAnswerButtons(roundId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`paranoia-answer|${roundId}`)
      .setLabel("Answer")
      .setStyle(ButtonStyle.Primary),
  );
}

function createParanoiaAnswerModal(roundId) {
  const input = new TextInputBuilder()
    .setCustomId("answer")
    .setLabel("Your answer")
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(2)
    .setMaxLength(220)
    .setPlaceholder("Type your answer. It will be revealed anonymously.")
    .setRequired(true);

  return new ModalBuilder()
    .setCustomId(`paranoia-modal|${roundId}`)
    .setTitle("Paranoia Answer")
    .addComponents(new ActionRowBuilder().addComponents(input));
}

function createParanoiaRevealEmbed(round, answerText) {
  const embed = new EmbedBuilder()
    .setColor(GAME_COLORS.paranoia)
    .setTitle("Paranoia Answer")
    .setDescription([
      `**Question**`,
      round.prompt.text,
      "",
      `**Anonymous answer**`,
      answerText,
    ].join("\n"))
    .setFooter({ text: `Type: PARANOIA | Rating: ${round.prompt.rating} | ID: ${round.prompt.id}` });

  return embed;
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
  createParanoiaAnswerButtons,
  createParanoiaAnswerModal,
  createParanoiaDmEmbed,
  createParanoiaRevealEmbed,
  createPromptButtons,
  createPromptEmbed,
  createSessionButtons,
  createSessionEmbed,
};
