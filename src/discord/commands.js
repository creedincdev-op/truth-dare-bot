const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const {
  BUTTON_MODE_CHOICES,
  CATEGORY_CHOICES,
  GAME_CHOICES,
  RATING_CHOICES,
} = require("../questions/catalog");

function addChoices(option, choices) {
  for (const choice of choices) {
    option.addChoices(choice);
  }
  return option;
}

function addSharedPromptOptions(builder) {
  builder.addStringOption((option) =>
    addChoices(
      option
        .setName("category")
        .setDescription("Focus on one category or mix them.")
        .setRequired(false),
      CATEGORY_CHOICES,
    ),
  );

  builder.addStringOption((option) =>
    addChoices(
      option
        .setName("rating")
        .setDescription("Choose the prompt rating.")
        .setRequired(false),
      RATING_CHOICES,
    ),
  );

  return builder;
}

function buildSingleGameCommand({ name, description }) {
  return addSharedPromptOptions(
    new SlashCommandBuilder()
      .setName(name)
      .setDescription(description),
  );
}

function buildSessionCommand({ name, description, fixedMode }) {
  const builder = addSharedPromptOptions(
    new SlashCommandBuilder()
      .setName(name)
      .setDescription(description),
  );

  builder.addStringOption((option) =>
    addChoices(
      option
        .setName("game")
        .setDescription("Choose a game for this session.")
        .setRequired(false),
      GAME_CHOICES,
    ),
  );

  if (fixedMode === "timer") {
    builder.addIntegerOption((option) =>
      option
        .setName("duration_minutes")
        .setDescription("Timer duration in minutes.")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(120),
    );
  } else {
    builder.addIntegerOption((option) =>
      option
        .setName("rounds")
        .setDescription("How many rounds to play.")
        .setRequired(false)
        .setMinValue(3)
        .setMaxValue(50),
    );
  }

  return builder;
}

const truthOrDareCommand = new SlashCommandBuilder()
  .setName("truthordare")
  .setDescription("Play Truth or Dare, Never Have I Ever, Would You Rather, and more.")
  .addStringOption((option) =>
    addChoices(
      option
        .setName("game")
        .setDescription("Pick a game or leave random.")
        .setRequired(false),
      GAME_CHOICES,
    ),
  )
  .addStringOption((option) =>
    addChoices(
      option
        .setName("category")
        .setDescription("Focus on one category or mix them.")
        .setRequired(false),
      CATEGORY_CHOICES,
    ),
  )
  .addStringOption((option) =>
    addChoices(
      option
        .setName("rating")
        .setDescription("Choose the prompt rating.")
        .setRequired(false),
      RATING_CHOICES,
    ),
  )
  .addStringOption((option) =>
    addChoices(
      option
        .setName("mode")
        .setDescription("Classic prompt or a tracked session mode.")
        .setRequired(false),
      BUTTON_MODE_CHOICES,
    ),
  )
  .addIntegerOption((option) =>
    option
      .setName("rounds")
      .setDescription("Rounds for battle or streak mode.")
      .setRequired(false)
      .setMinValue(3)
      .setMaxValue(50),
  )
  .addIntegerOption((option) =>
    option
      .setName("duration_minutes")
      .setDescription("Timer mode duration in minutes.")
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(120),
  );

const truthCommand = buildSingleGameCommand({
  name: "truth",
  description: "Get a Truth prompt.",
});

const dareCommand = buildSingleGameCommand({
  name: "dare",
  description: "Get a Dare prompt.",
});

const wouldYouRatherCommand = buildSingleGameCommand({
  name: "wouldyourather",
  description: "Get a Would You Rather prompt.",
});

const neverHaveIEverCommand = buildSingleGameCommand({
  name: "neverhaveiever",
  description: "Get a Never Have I Ever prompt.",
});

const paranoiaCommand = buildSingleGameCommand({
  name: "paranoia",
  description: "Get a Paranoia prompt.",
});

const icebreakerCommand = buildSingleGameCommand({
  name: "icebreaker",
  description: "Get an Icebreaker prompt.",
});

const challengeCommand = buildSingleGameCommand({
  name: "challenge",
  description: "Get a Challenge prompt.",
});

const hotTakeCommand = buildSingleGameCommand({
  name: "hottake",
  description: "Get a Hot Take prompt.",
});

const battleCommand = buildSessionCommand({
  name: "todbattle",
  description: "Start a battle session with points.",
  fixedMode: "battle",
});

const streakCommand = buildSessionCommand({
  name: "todstreak",
  description: "Start a streak session.",
  fixedMode: "streak",
});

const timerCommand = buildSessionCommand({
  name: "todtimer",
  description: "Start a timer-based session.",
  fixedMode: "timer",
});

const categoryCommand = new SlashCommandBuilder()
  .setName("todcategory")
  .setDescription("List available categories and counts for a game/rating.")
  .addStringOption((option) =>
    addChoices(
      option
        .setName("game")
        .setDescription("Filter by one game.")
        .setRequired(false),
      GAME_CHOICES,
    ),
  )
  .addStringOption((option) =>
    addChoices(
      option
        .setName("rating")
        .setDescription("Filter by rating.")
        .setRequired(false),
      RATING_CHOICES,
    ),
  );

const configCommand = new SlashCommandBuilder()
  .setName("todconfig")
  .setDescription("Configure ratings, button timeout, and disabled categories/games.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("view")
      .setDescription("View current server config."),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("set")
      .setDescription("Set defaults for this server.")
      .addStringOption((option) =>
        addChoices(
          option
            .setName("default_rating")
            .setDescription("Default prompt rating for this server.")
            .setRequired(false),
          RATING_CHOICES,
        ),
      )
      .addIntegerOption((option) =>
        option
          .setName("max_prompt_length")
          .setDescription("Maximum prompt length in characters.")
          .setRequired(false)
          .setMinValue(60)
          .setMaxValue(240),
      )
      .addIntegerOption((option) =>
        option
          .setName("button_timeout")
          .setDescription("Seconds before prompt buttons expire.")
          .setRequired(false)
          .setMinValue(30)
          .setMaxValue(1800),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("disable_category")
      .setDescription("Disable one category for this server.")
      .addStringOption((option) =>
        addChoices(
          option
            .setName("category")
            .setDescription("Category to disable.")
            .setRequired(true),
          CATEGORY_CHOICES.filter((choice) => choice.value !== "any"),
        ),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("enable_category")
      .setDescription("Enable one category for this server.")
      .addStringOption((option) =>
        addChoices(
          option
            .setName("category")
            .setDescription("Category to enable.")
            .setRequired(true),
          CATEGORY_CHOICES.filter((choice) => choice.value !== "any"),
        ),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("disable_game")
      .setDescription("Disable one game for this server.")
      .addStringOption((option) =>
        addChoices(
          option
            .setName("game")
            .setDescription("Game to disable.")
            .setRequired(true),
          GAME_CHOICES.filter((choice) => !["random", "truth_or_dare"].includes(choice.value)),
        ),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("enable_game")
      .setDescription("Enable one game for this server.")
      .addStringOption((option) =>
        addChoices(
          option
            .setName("game")
            .setDescription("Game to enable.")
            .setRequired(true),
          GAME_CHOICES.filter((choice) => !["random", "truth_or_dare"].includes(choice.value)),
        ),
      ),
  );

const autopostCommand = new SlashCommandBuilder()
  .setName("todautopost")
  .setDescription("Manage daily autopost drops.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("set")
      .setDescription("Create a daily autopost schedule.")
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("Channel to post into.")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("time")
          .setDescription("24h time like 09:30 or 21:45.")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("timezone")
          .setDescription("IANA timezone like Asia/Calcutta.")
          .setRequired(true),
      )
      .addStringOption((option) =>
        addChoices(
          option
            .setName("game")
            .setDescription("Game to post.")
            .setRequired(false),
          GAME_CHOICES,
        ),
      )
      .addStringOption((option) =>
        addChoices(
          option
            .setName("category")
            .setDescription("Category to post.")
            .setRequired(false),
          CATEGORY_CHOICES,
        ),
      )
      .addStringOption((option) =>
        addChoices(
          option
            .setName("rating")
            .setDescription("Rating to post.")
            .setRequired(false),
          RATING_CHOICES,
        ),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("list")
      .setDescription("List all autopost schedules for this server."),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("delete")
      .setDescription("Delete a schedule by its ID.")
      .addIntegerOption((option) =>
        option
          .setName("id")
          .setDescription("Schedule ID to delete.")
          .setRequired(true)
          .setMinValue(1),
      ),
  );

const statsCommand = new SlashCommandBuilder()
  .setName("todstats")
  .setDescription("Show pool sizes, blacklist totals, and usage stats.");

function getCommandPayload() {
  return [
    truthOrDareCommand.toJSON(),
    truthCommand.toJSON(),
    dareCommand.toJSON(),
    wouldYouRatherCommand.toJSON(),
    neverHaveIEverCommand.toJSON(),
    paranoiaCommand.toJSON(),
    icebreakerCommand.toJSON(),
    challengeCommand.toJSON(),
    hotTakeCommand.toJSON(),
    battleCommand.toJSON(),
    streakCommand.toJSON(),
    timerCommand.toJSON(),
    categoryCommand.toJSON(),
    configCommand.toJSON(),
    autopostCommand.toJSON(),
    statsCommand.toJSON(),
  ];
}

module.exports = {
  getCommandPayload,
};
