import json
import os
import random
import re
import secrets
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import discord
from discord import app_commands
from discord.ext import commands

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover
    load_dotenv = None


ROOT_DIR = Path(__file__).resolve().parent
DATA_DIR = ROOT_DIR / "data"
CORE_PROMPT_FILE = DATA_DIR / "core_prompt_catalog.json"
PROMPT_POOL_FILE = DATA_DIR / "prompt_pools.json"
STATUS_FILE = DATA_DIR / "runtime_status.json"

RATINGS = ["PG", "PG13", "R"]
GAME_LABELS = {
    "truth_or_dare": "Truth or Dare",
    "truth": "Truth",
    "dare": "Dare",
    "never_have_i_ever": "Never Have I Ever",
    "paranoia": "Paranoia",
}
GAME_COLORS = {
    "truth": 0x25C76A,
    "dare": 0xFF5A66,
    "never_have_i_ever": 0x5A70FF,
    "paranoia": 0xE7A63F,
}
TYPE_CHOICES = [
    app_commands.Choice(name="Random", value="truth_or_dare"),
    app_commands.Choice(name="Truth", value="truth"),
    app_commands.Choice(name="Dare", value="dare"),
]
RATING_CHOICES = [app_commands.Choice(name=value, value=value) for value in RATINGS]
LOGIN_429_COOLDOWN_SECONDS = max(60, int(os.getenv("BOT_LOGIN_429_COOLDOWN", "1800")))
LOGIN_429_COOLDOWN_MAX_SECONDS = max(
    LOGIN_429_COOLDOWN_SECONDS,
    int(os.getenv("BOT_LOGIN_429_COOLDOWN_MAX", "7200")),
)


@dataclass(slots=True)
class PromptEntry:
    game: str
    category: str
    rating: str
    text: str
    tone: str
    weight: float
    key: str


@dataclass(slots=True)
class PromptResult:
    id: str
    game: str
    category: str
    rating: str
    text: str
    key: str
    requester_tag: str
    tone: str
    source: str = "catalog"


@dataclass(slots=True)
class HistoryEntry:
    key: str
    game: str
    category: str
    tone: str
    text: str


@dataclass(slots=True)
class ChannelState:
    history: list[HistoryEntry] = field(default_factory=list)
    used_by_game: dict[str, set[str]] = field(default_factory=dict)
    usage_counts: dict[str, int] = field(default_factory=dict)


@dataclass(slots=True)
class ParanoiaRound:
    round_id: str
    guild_id: int
    channel_id: int
    requester_id: int
    requester_name: str
    target_user_id: int
    prompt: PromptResult
    status: str = "awaiting_answer"
    ack_message_id: int | None = None
    dm_channel_id: int | None = None
    dm_message_id: int | None = None
    answer_text: str | None = None


paranoia_rounds: dict[str, ParanoiaRound] = {}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_storage() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def read_env(*names: str, fallback: str = "") -> str:
    for name in names:
        value = os.getenv(name, "")
        if not isinstance(value, str):
            continue
        normalized = value.strip().strip("\"'")
        if normalized:
            return normalized
    return fallback


def read_env_int(*names: str) -> int | None:
    raw = read_env(*names)
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def normalize_text(value: str | None) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9\s]", " ", str(value or "").lower())).strip()


def sanitize_prompt(text: str | None) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def titleize_category(category: str) -> str:
    return category.replace("_", " ").title()


def build_prompt_key(game: str, category: str, rating: str, text: str) -> str:
    return normalize_text(f"{game}|{category}|{rating}|{text}")


def short_id(prefix: str = "tod") -> str:
    return f"{prefix}_{secrets.token_urlsafe(6)}"


def build_prompt_signature(text: str) -> set[str]:
    stop_words = {
        "a", "an", "and", "are", "at", "be", "for", "from", "have", "how", "if", "in", "is",
        "it", "of", "on", "or", "the", "to", "what", "who", "would", "you", "your",
    }
    return {
        token
        for token in normalize_text(text).split(" ")
        if token and len(token) > 2 and token not in stop_words
    }


def score_signature_overlap(signature_a: set[str], signature_b: set[str]) -> float:
    if not signature_a or not signature_b:
        return 0.0
    shared = sum(1 for token in signature_a if token in signature_b)
    return shared / min(len(signature_a), len(signature_b))


def weighted_choice(items: list[tuple[PromptEntry, float]]) -> PromptEntry | None:
    if not items:
        return None
    prompts = [item[0] for item in items]
    weights = [max(0.05, item[1]) for item in items]
    return random.choices(prompts, weights=weights, k=1)[0]


def load_prompt_catalog() -> list[PromptEntry]:
    if CORE_PROMPT_FILE.exists():
        payload = json.loads(CORE_PROMPT_FILE.read_text(encoding="utf-8"))
        prompts = []
        for item in payload.get("prompts", []):
            text = sanitize_prompt(item.get("text"))
            game = sanitize_prompt(item.get("game"))
            category = sanitize_prompt(item.get("category")) or "relatable"
            rating = sanitize_prompt(item.get("rating")) or "PG"
            if not text or game not in GAME_LABELS or rating not in RATINGS:
                continue
            prompts.append(
                PromptEntry(
                    game=game,
                    category=category,
                    rating=rating,
                    text=text,
                    tone=sanitize_prompt(item.get("tone")) or category,
                    weight=float(item.get("weight") or 1.0),
                    key=sanitize_prompt(item.get("key")) or build_prompt_key(game, category, rating, text),
                )
            )
        if prompts:
            return prompts

    if not PROMPT_POOL_FILE.exists():
        raise RuntimeError("No prompt catalog file found.")

    payload = json.loads(PROMPT_POOL_FILE.read_text(encoding="utf-8"))
    prompts: list[PromptEntry] = []
    for text in payload.get("truthPool", []):
        clean = sanitize_prompt(text)
        if clean:
            prompts.append(PromptEntry("truth", "relatable", "PG13", clean, "relatable", 1.0, build_prompt_key("truth", "relatable", "PG13", clean)))
    for text in payload.get("darePool", []):
        clean = sanitize_prompt(text)
        if clean:
            prompts.append(PromptEntry("dare", "social", "PG13", clean, "social", 1.0, build_prompt_key("dare", "social", "PG13", clean)))
    return prompts

class PromptEngine:
    def __init__(self, prompts: list[PromptEntry], recent_history_limit: int = 220) -> None:
        self.prompts = prompts
        self.recent_history_limit = recent_history_limit
        self.state_by_channel: dict[int, ChannelState] = {}

    def get_channel_state(self, channel_id: int) -> ChannelState:
        if channel_id not in self.state_by_channel:
            self.state_by_channel[channel_id] = ChannelState()
        return self.state_by_channel[channel_id]

    def get_counts(self) -> dict[str, int]:
        counts = {game: 0 for game in GAME_LABELS if game != "truth_or_dare"}
        for prompt in self.prompts:
            counts[prompt.game] = counts.get(prompt.game, 0) + 1
        return counts

    def get_channel_stats(self, channel_id: int) -> dict[str, int]:
        state = self.get_channel_state(channel_id)
        return {
            "historySize": len(state.history),
            "truthUsed": len(state.used_by_game.get("truth", set())),
            "dareUsed": len(state.used_by_game.get("dare", set())),
            "neverUsed": len(state.used_by_game.get("never_have_i_ever", set())),
            "paranoiaUsed": len(state.used_by_game.get("paranoia", set())),
        }

    def resolve_game(self, requested_game: str) -> str:
        if requested_game == "truth_or_dare":
            return random.choice(["truth", "dare"])
        return requested_game

    def record_prompt(self, channel_id: int, prompt: PromptEntry) -> None:
        state = self.get_channel_state(channel_id)
        state.used_by_game.setdefault(prompt.game, set()).add(prompt.key)
        state.usage_counts[prompt.key] = state.usage_counts.get(prompt.key, 0) + 1
        state.history.insert(0, HistoryEntry(prompt.key, prompt.game, prompt.category, prompt.tone, prompt.text))
        if len(state.history) > self.recent_history_limit:
            state.history.pop()

    def score_candidates(self, candidates: list[PromptEntry], state: ChannelState) -> list[tuple[PromptEntry, float]]:
        recent_entries = state.history[:80]
        recent_signatures = [build_prompt_signature(entry.text) for entry in recent_entries[:18] if build_prompt_signature(entry.text)]
        recent_categories = [entry.category for entry in recent_entries[:8]]
        recent_games = [entry.game for entry in recent_entries[:8]]
        recent_tones = [entry.tone for entry in recent_entries[:8]]
        scored: list[tuple[PromptEntry, float]] = []

        for prompt in candidates:
            signature = build_prompt_signature(prompt.text)
            overlap = 0.0
            for recent_signature in recent_signatures:
                overlap = max(overlap, score_signature_overlap(signature, recent_signature))
            category_penalty = 0.14 if prompt.category in recent_categories else 0.0
            game_penalty = 0.05 if prompt.game in recent_games else 0.0
            tone_penalty = 0.05 if prompt.tone in recent_tones else 0.0
            flirty_penalty = 0.07 if prompt.category == "flirty" else 0.0
            usage_penalty = state.usage_counts.get(prompt.key, 0) * 0.06
            score = overlap + category_penalty + game_penalty + tone_penalty + flirty_penalty + usage_penalty
            weight = max(0.1, prompt.weight) * (1 / (1 + max(0.0, score * 2.5)))
            scored.append((prompt, weight))

        scored.sort(key=lambda item: item[1], reverse=True)
        return scored[:64]

    async def get_next_prompt(
        self,
        *,
        requested_game: str,
        channel_id: int,
        requester_tag: str,
        rating: str | None = None,
    ) -> PromptResult:
        game = self.resolve_game(requested_game)
        effective_rating = rating if rating in RATINGS else "PG"
        state = self.get_channel_state(channel_id)
        matching = [prompt for prompt in self.prompts if prompt.game == game and prompt.rating == effective_rating]

        if not matching and rating is not None:
            matching = [prompt for prompt in self.prompts if prompt.game == game]
        if not matching:
            raise RuntimeError(f"No prompts are available for {GAME_LABELS.get(game, game)}.")

        used_keys = state.used_by_game.get(game, set())
        recent_keys = {entry.key for entry in state.history[: self.recent_history_limit]}
        unseen = [prompt for prompt in matching if prompt.key not in used_keys and prompt.key not in recent_keys]

        if not unseen:
            state.used_by_game[game] = set()
            unseen = [prompt for prompt in matching if prompt.key not in recent_keys]

        candidate_pool = unseen if unseen else [prompt for prompt in matching if prompt.key not in recent_keys]
        if not candidate_pool:
            candidate_pool = matching

        selected = weighted_choice(self.score_candidates(candidate_pool, state)) or random.choice(candidate_pool)
        self.record_prompt(channel_id, selected)
        return PromptResult(
            id=short_id(game),
            game=selected.game,
            category=selected.category,
            rating=selected.rating,
            text=selected.text,
            key=selected.key,
            requester_tag=requester_tag,
            tone=selected.tone,
        )


def write_status(
    *,
    phase: str,
    discord_ready: bool,
    bot_user: str | None,
    last_error: str | None = None,
    login_started_at: str | None = None,
) -> None:
    ensure_storage()
    STATUS_FILE.write_text(
        json.dumps(
            {
                "phase": phase,
                "discordReady": discord_ready,
                "botUser": bot_user,
                "lastError": last_error,
                "loginStartedAt": login_started_at,
                "updatedAt": utc_now_iso(),
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def build_prompt_embed(prompt: PromptResult, requester_user: discord.abc.User | None) -> discord.Embed:
    requester_name = None
    requester_avatar = None
    if requester_user is not None:
        requester_name = getattr(requester_user, "global_name", None) or requester_user.name
        requester_avatar = requester_user.display_avatar.url if requester_user.display_avatar else None

    footer_parts: list[str] = []
    if prompt.game in {"truth", "dare"}:
        footer_parts.append(f"Type: {GAME_LABELS[prompt.game].upper()}")
    footer_parts.append(f"Category: {titleize_category(prompt.category).upper()}")
    footer_parts.append(f"Rating: {prompt.rating}")
    footer_parts.append(f"ID: {prompt.id}")

    embed = discord.Embed(title=prompt.text, color=GAME_COLORS.get(prompt.game, 0x5865F2))
    embed.set_footer(text=" | ".join(footer_parts))

    if requester_name:
        embed.set_author(
            name=f"{GAME_LABELS.get(prompt.game, prompt.game)} | Requested by {requester_name}",
            icon_url=requester_avatar,
        )

    if prompt.game == "never_have_i_ever":
        embed.description = "**Never Have I Ever**"

    return embed


def build_paranoia_dm_embed(round_data: ParanoiaRound) -> discord.Embed:
    embed = discord.Embed(
        title=round_data.prompt.text,
        description="**Paranoia**\nReply honestly. Your answer will be revealed back in the server without naming you.",
        color=GAME_COLORS["paranoia"],
    )
    embed.set_author(name=f"Private round from {round_data.requester_name}")
    embed.set_footer(text=f"Rating: {round_data.prompt.rating} | ID: {round_data.prompt.id}")
    return embed


def build_paranoia_reveal_embed(round_data: ParanoiaRound) -> discord.Embed:
    embed = discord.Embed(
        title="Paranoia Answer",
        description=f"**Question**\n{round_data.prompt.text}\n\n**Anonymous answer**\n{round_data.answer_text or ''}",
        color=GAME_COLORS["paranoia"],
    )
    embed.set_footer(text=f"Type: PARANOIA | Rating: {round_data.prompt.rating} | ID: {round_data.prompt.id}")
    return embed


class PromptButtonsView(discord.ui.View):
    def __init__(self, prompt_engine: PromptEngine, prompt: PromptResult) -> None:
        super().__init__(timeout=240)
        self.prompt_engine = prompt_engine
        self.prompt = prompt

        if prompt.game in {"truth", "dare"}:
            self.add_item(self._build_prompt_button("Truth", discord.ButtonStyle.success, "truth", prompt.rating))
            self.add_item(self._build_prompt_button("Dare", discord.ButtonStyle.danger, "dare", prompt.rating))
            self.add_item(self._build_prompt_button("Random", discord.ButtonStyle.primary, "truth_or_dare", prompt.rating))
        elif prompt.game == "never_have_i_ever":
            self.add_item(self._build_prompt_button("Next Never Have I Ever", discord.ButtonStyle.primary, "never_have_i_ever", prompt.rating))
            self.add_item(self._build_prompt_button("Any Rating", discord.ButtonStyle.success, "never_have_i_ever", None))

    def _build_prompt_button(self, label: str, style: discord.ButtonStyle, game: str, rating: str | None) -> discord.ui.Button:
        button = discord.ui.Button(label=label, style=style)

        async def callback(interaction: discord.Interaction) -> None:
            await interaction.response.defer()
            if interaction.message is not None:
                try:
                    await interaction.message.edit(view=None)
                except discord.HTTPException:
                    pass

            next_prompt = await self.prompt_engine.get_next_prompt(
                requested_game=game,
                channel_id=interaction.channel_id or 0,
                requester_tag=str(interaction.user),
                rating=rating,
            )
            await interaction.followup.send(
                embed=build_prompt_embed(next_prompt, interaction.user),
                view=PromptButtonsView(self.prompt_engine, next_prompt),
            )

        button.callback = callback
        return button


class ParanoiaAnswerModal(discord.ui.Modal, title="Paranoia Answer"):
    answer = discord.ui.TextInput(
        label="Your answer",
        style=discord.TextStyle.paragraph,
        max_length=220,
        min_length=2,
        placeholder="Type your answer. It will be revealed anonymously.",
    )

    def __init__(self, bot_instance: "TruthDareBot", round_id: str) -> None:
        super().__init__()
        self.bot_instance = bot_instance
        self.round_id = round_id

    async def on_submit(self, interaction: discord.Interaction) -> None:
        round_data = paranoia_rounds.get(self.round_id)
        if round_data is None or round_data.status != "awaiting_answer":
            await interaction.response.send_message("That paranoia round is no longer active.", ephemeral=True)
            return

        if interaction.user.id != round_data.target_user_id:
            await interaction.response.send_message("That paranoia round is not for you.", ephemeral=True)
            return

        round_data.answer_text = sanitize_prompt(str(self.answer))[:220]
        if not round_data.answer_text:
            await interaction.response.send_message("Please send a real answer.", ephemeral=True)
            return

        channel = self.bot_instance.get_channel(round_data.channel_id)
        if channel is None:
            try:
                channel = await self.bot_instance.fetch_channel(round_data.channel_id)
            except discord.HTTPException:
                channel = None

        if channel is None or not isinstance(channel, (discord.TextChannel, discord.Thread)):
            round_data.status = "failed"
            await interaction.response.send_message("I got your answer, but I could not post it back in the original channel.")
            return

        await channel.send(embed=build_paranoia_reveal_embed(round_data))

        if round_data.ack_message_id:
            try:
                ack_message = await channel.fetch_message(round_data.ack_message_id)
                await ack_message.edit(content="Paranoia answer received. Anonymous reveal dropped below.")
            except discord.HTTPException:
                pass

        dm_channel = interaction.channel
        if isinstance(dm_channel, discord.DMChannel) and round_data.dm_message_id:
            try:
                dm_message = await dm_channel.fetch_message(round_data.dm_message_id)
                await dm_message.edit(view=None)
            except discord.HTTPException:
                pass

        round_data.status = "answered"
        await interaction.response.send_message("Answer sent anonymously.")


class ParanoiaAnswerView(discord.ui.View):
    def __init__(self, bot_instance: "TruthDareBot", round_id: str) -> None:
        super().__init__(timeout=1800)
        self.bot_instance = bot_instance
        self.round_id = round_id
        button = discord.ui.Button(label="Answer", style=discord.ButtonStyle.primary)
        button.callback = self.answer_callback
        self.add_item(button)

    async def answer_callback(self, interaction: discord.Interaction) -> None:
        round_data = paranoia_rounds.get(self.round_id)
        if round_data is None or round_data.status != "awaiting_answer":
            await interaction.response.send_message("That paranoia round is no longer active.", ephemeral=True)
            return
        if interaction.user.id != round_data.target_user_id:
            await interaction.response.send_message("That paranoia round is not for you.", ephemeral=True)
            return
        await interaction.response.send_modal(ParanoiaAnswerModal(self.bot_instance, self.round_id))


class TruthDareBot(commands.Bot):
    def __init__(self, prompt_engine: PromptEngine) -> None:
        intents = discord.Intents.none()
        intents.guilds = True
        super().__init__(command_prefix="!", intents=intents)
        self.prompt_engine = prompt_engine
        self.commands_synced = False

    async def on_ready(self) -> None:
        write_status(
            phase="discord_ready",
            discord_ready=True,
            bot_user=str(self.user) if self.user else None,
            last_error=None,
        )
        print(f"Logged in as {self.user}")
        counts = self.prompt_engine.get_counts()
        print(
            "Prompt catalog loaded: "
            f"{counts.get('truth', 0)} truths, "
            f"{counts.get('dare', 0)} dares, "
            f"{counts.get('never_have_i_ever', 0)} NHIE, "
            f"{counts.get('paranoia', 0)} paranoia."
        )

        if self.commands_synced:
            return

        scope = "global"
        try:
            guild_id = read_env_int("DISCORD_GUILD_ID", "GUILD_ID")
            if guild_id:
                guild = discord.Object(id=guild_id)
                await self.tree.sync(guild=guild)
                scope = "guild"
            else:
                await self.tree.sync()
            self.commands_synced = True
            print(f"Slash commands registered ({scope}).")
        except Exception as error:
            print(f"Slash command registration failed: {error}")
            write_status(
                phase="command_registration_failed",
                discord_ready=True,
                bot_user=str(self.user) if self.user else None,
                last_error=str(error),
            )

    async def on_disconnect(self) -> None:
        write_status(
            phase="discord_disconnected",
            discord_ready=False,
            bot_user=str(self.user) if self.user else None,
            last_error="Discord client disconnected",
        )

    async def on_resumed(self) -> None:
        write_status(
            phase="discord_ready",
            discord_ready=True,
            bot_user=str(self.user) if self.user else None,
            last_error=None,
        )

    async def on_shard_disconnect(self, shard_id: int, *args: Any) -> None:
        write_status(
            phase="discord_disconnected",
            discord_ready=False,
            bot_user=str(self.user) if self.user else None,
            last_error=f"Shard {shard_id} disconnected",
        )

    async def on_shard_resumed(self, shard_id: int) -> None:
        write_status(
            phase="discord_ready",
            discord_ready=True,
            bot_user=str(self.user) if self.user else None,
            last_error=None,
        )

    async def on_error(self, event_method: str, *args: Any, **kwargs: Any) -> None:
        error_time = discord.utils.utcnow()
        write_status(
            phase="discord_client_error",
            discord_ready=self.is_ready(),
            bot_user=str(self.user) if self.user else None,
            last_error=f"Unhandled error during {event_method} at {error_time.isoformat()}",
        )
        raise


if load_dotenv is not None:
    load_dotenv(ROOT_DIR / ".env")

TOKEN = read_env("BOT_TOKEN", "DISCORD_TOKEN")
if not TOKEN:
    raise RuntimeError("BOT_TOKEN or DISCORD_TOKEN is not set.")

prompt_engine = PromptEngine(load_prompt_catalog())
bot = TruthDareBot(prompt_engine=prompt_engine)


async def send_game_prompt(interaction: discord.Interaction, game: str, rating: str | None = None) -> None:
    await interaction.response.defer()
    prompt = await bot.prompt_engine.get_next_prompt(
        requested_game=game,
        channel_id=interaction.channel_id or 0,
        requester_tag=str(interaction.user),
        rating=rating,
    )
    await interaction.followup.send(
        embed=build_prompt_embed(prompt, interaction.user),
        view=PromptButtonsView(bot.prompt_engine, prompt),
    )


@bot.tree.command(name="truthordare", description="Get a Truth, Dare, or Random challenge panel.")
@app_commands.describe(type="Choose Truth, Dare, or Random", rating="Choose the prompt rating")
@app_commands.choices(type=TYPE_CHOICES, rating=RATING_CHOICES)
async def truth_or_dare(
    interaction: discord.Interaction,
    type: app_commands.Choice[str] | None = None,
    rating: app_commands.Choice[str] | None = None,
) -> None:
    await send_game_prompt(interaction, type.value if type else "truth_or_dare", rating.value if rating else None)


@bot.tree.command(name="truth", description="Gives a random question that has to be answered truthfully.")
@app_commands.describe(rating="Choose the prompt rating")
@app_commands.choices(rating=RATING_CHOICES)
async def truth_command(interaction: discord.Interaction, rating: app_commands.Choice[str] | None = None) -> None:
    await send_game_prompt(interaction, "truth", rating.value if rating else None)


@bot.tree.command(name="dare", description="Gives a dare that has to be completed.")
@app_commands.describe(rating="Choose the prompt rating")
@app_commands.choices(rating=RATING_CHOICES)
async def dare_command(interaction: discord.Interaction, rating: app_commands.Choice[str] | None = None) -> None:
    await send_game_prompt(interaction, "dare", rating.value if rating else None)


@bot.tree.command(name="neverever", description="Gives a random Never Have I Ever prompt.")
@app_commands.describe(rating="Choose the prompt rating")
@app_commands.choices(rating=RATING_CHOICES)
async def neverever_command(interaction: discord.Interaction, rating: app_commands.Choice[str] | None = None) -> None:
    await send_game_prompt(interaction, "never_have_i_ever", rating.value if rating else None)


@bot.tree.command(name="paranoia", description="Gives a paranoia question or sends one to a user.")
@app_commands.describe(target="User who will receive the paranoia question in DM", rating="Choose the prompt rating")
@app_commands.choices(rating=RATING_CHOICES)
async def paranoia_command(
    interaction: discord.Interaction,
    target: discord.User,
    rating: app_commands.Choice[str] | None = None,
) -> None:
    if interaction.guild_id is None:
        await interaction.response.send_message("This command only works in servers.", ephemeral=True)
        return

    if target.bot:
        await interaction.response.send_message("Pick a real user. Bots cannot receive paranoia rounds.", ephemeral=True)
        return

    if target.id == interaction.user.id:
        await interaction.response.send_message("Pick someone else for paranoia. You cannot target yourself.", ephemeral=True)
        return

    await interaction.response.defer()
    prompt = await bot.prompt_engine.get_next_prompt(
        requested_game="paranoia",
        channel_id=interaction.channel_id or 0,
        requester_tag=str(interaction.user),
        rating=rating.value if rating else None,
    )
    round_id = short_id("paranoia")
    round_data = ParanoiaRound(
        round_id=round_id,
        guild_id=interaction.guild_id,
        channel_id=interaction.channel_id or 0,
        requester_id=interaction.user.id,
        requester_name=getattr(interaction.user, "global_name", None) or interaction.user.name,
        target_user_id=target.id,
        prompt=prompt,
    )
    paranoia_rounds[round_id] = round_data

    try:
        dm_message = await target.send(
            embed=build_paranoia_dm_embed(round_data),
            view=ParanoiaAnswerView(bot, round_id),
        )
    except discord.HTTPException:
        paranoia_rounds.pop(round_id, None)
        await interaction.followup.send("I could not DM that user. Ask them to enable DMs and try again.")
        return

    round_data.dm_channel_id = dm_message.channel.id
    round_data.dm_message_id = dm_message.id
    ack_message = await interaction.followup.send(
        "Paranoia question sent. The anonymous answer will show up here once they reply."
    )
    round_data.ack_message_id = ack_message.id


@bot.tree.command(name="todstats", description="Show prompt pool size and anti-repeat status.")
async def tod_stats(interaction: discord.Interaction) -> None:
    await interaction.response.defer(ephemeral=True)
    counts = bot.prompt_engine.get_counts()
    channel_stats = bot.prompt_engine.get_channel_stats(interaction.channel_id or 0)
    content = "\n".join(
        [
            f"Truth pool: **{counts.get('truth', 0):,}**",
            f"Dare pool: **{counts.get('dare', 0):,}**",
            f"Never Have I Ever pool: **{counts.get('never_have_i_ever', 0):,}**",
            f"Paranoia pool: **{counts.get('paranoia', 0):,}**",
            f"Channel recent history: **{channel_stats['historySize']}**",
            f"Unique truths used in channel: **{channel_stats['truthUsed']}**",
            f"Unique dares used in channel: **{channel_stats['dareUsed']}**",
            f"Unique NHIE used in channel: **{channel_stats['neverUsed']}**",
            f"Unique paranoia used in channel: **{channel_stats['paranoiaUsed']}**",
        ]
    )
    await interaction.followup.send(content, ephemeral=True)


def extract_retry_after_seconds(exc: discord.HTTPException, fallback_seconds: int) -> int:
    response = getattr(exc, "response", None)
    retry_header = None
    if response is not None:
        retry_header = response.headers.get("Retry-After") or response.headers.get("X-RateLimit-Reset-After")

    try:
        return max(int(float(retry_header)), fallback_seconds) if retry_header else fallback_seconds
    except (TypeError, ValueError):
        return fallback_seconds


def main() -> int:
    ensure_storage()
    cooldown_seconds = LOGIN_429_COOLDOWN_SECONDS

    while True:
        login_started_at = utc_now_iso()
        write_status(
            phase="connecting_gateway",
            discord_ready=False,
            bot_user=None,
            last_error=None,
            login_started_at=login_started_at,
        )

        try:
            bot.run(TOKEN)
            return 0
        except discord.LoginFailure:
            raise
        except discord.HTTPException as exc:
            if exc.status != 429:
                write_status(
                    phase="discord_start_failed",
                    discord_ready=False,
                    bot_user=None,
                    last_error=str(exc),
                    login_started_at=login_started_at,
                )
                raise

            wait_seconds = min(
                extract_retry_after_seconds(exc, cooldown_seconds),
                LOGIN_429_COOLDOWN_MAX_SECONDS,
            )
            retry_message = f"Discord login is rate limited (HTTP 429). Waiting {wait_seconds} seconds before retrying."
            print(retry_message)
            write_status(
                phase="discord_login_rate_limited",
                discord_ready=False,
                bot_user=None,
                last_error=retry_message,
                login_started_at=login_started_at,
            )
            time.sleep(wait_seconds)
            cooldown_seconds = min(cooldown_seconds * 2, LOGIN_429_COOLDOWN_MAX_SECONDS)
        except Exception as exc:
            write_status(
                phase="discord_start_failed",
                discord_ready=False,
                bot_user=None,
                last_error=str(exc),
                login_started_at=login_started_at,
            )
            raise


if __name__ == "__main__":
    raise SystemExit(main())
