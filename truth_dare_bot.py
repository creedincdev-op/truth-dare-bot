import asyncio
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

try:
    from openai import OpenAI
except ImportError:  # pragma: no cover
    OpenAI = None


ROOT_DIR = Path(__file__).resolve().parent
DATA_DIR = ROOT_DIR / "data"
PROMPT_POOL_FILE = DATA_DIR / "prompt_pools.json"
STATUS_FILE = DATA_DIR / "runtime_status.json"

BLOCKED_WORDS = [
    "sexy",
    "sex",
    "nsfw",
    "hookup",
    "make out",
    "drunk",
    "weed",
    "drug",
    "alcohol",
    "vape",
    "cigarette",
    "damn",
    "shit",
    "fuck",
    "bitch",
    "asshole",
    "nude",
    "naked",
    "bedroom",
    "body count",
    "porn",
    "oral",
]

SIGNATURE_STOP_WORDS = {
    "a",
    "an",
    "and",
    "are",
    "at",
    "be",
    "did",
    "do",
    "for",
    "from",
    "have",
    "how",
    "if",
    "in",
    "is",
    "it",
    "kind",
    "like",
    "most",
    "of",
    "on",
    "one",
    "or",
    "really",
    "right",
    "someone",
    "something",
    "that",
    "the",
    "thing",
    "this",
    "to",
    "what",
    "when",
    "which",
    "who",
    "would",
    "you",
    "your",
}

SIGNATURE_SHORT_ALLOWLIST = {"dm", "ex", "ig"}

TYPE_STYLES = {
    "truth": {
        "label": "Truth",
        "color": 0x2ECC71,
        "button_style": discord.ButtonStyle.success,
    },
    "dare": {
        "label": "Dare",
        "color": 0xE74C3C,
        "button_style": discord.ButtonStyle.danger,
    },
}

LOGIN_429_COOLDOWN_SECONDS = max(60, int(os.getenv("BOT_LOGIN_429_COOLDOWN", "1800")))
LOGIN_429_COOLDOWN_MAX_SECONDS = max(
    LOGIN_429_COOLDOWN_SECONDS,
    int(os.getenv("BOT_LOGIN_429_COOLDOWN_MAX", "7200")),
)


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


def contains_blocked_words(text: str | None) -> bool:
    normalized = normalize_text(text)
    return any(word in normalized for word in BLOCKED_WORDS)


def build_prompt_signature(text: str) -> set[str]:
    tokens = []
    for token in normalize_text(text).split(" "):
        if not token or token in SIGNATURE_STOP_WORDS:
            continue
        if len(token) > 2 or token in SIGNATURE_SHORT_ALLOWLIST:
            tokens.append(token)
    return set(tokens)


def score_signature_overlap(signature_a: set[str], signature_b: set[str]) -> float:
    if not signature_a or not signature_b:
        return 0.0

    shared = sum(1 for token in signature_a if token in signature_b)
    return shared / min(len(signature_a), len(signature_b))


def pick_random(items: list[str]) -> str | None:
    if not items:
        return None
    return random.choice(items)


def short_id(prefix: str = "tod") -> str:
    return f"{prefix}_{secrets.token_urlsafe(6)}"


def load_prompt_pools() -> tuple[list[str], list[str]]:
    if not PROMPT_POOL_FILE.exists():
        raise RuntimeError(f"Prompt pool file not found: {PROMPT_POOL_FILE}")

    payload = json.loads(PROMPT_POOL_FILE.read_text(encoding="utf-8"))
    truth_pool = [sanitize_prompt(entry) for entry in payload.get("truthPool", []) if sanitize_prompt(entry)]
    dare_pool = [sanitize_prompt(entry) for entry in payload.get("darePool", []) if sanitize_prompt(entry)]
    return truth_pool, dare_pool


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


def build_prompt_embed(prompt: "PromptResult", requester_user: discord.abc.User | None) -> discord.Embed:
    style = TYPE_STYLES.get(prompt.type, TYPE_STYLES["truth"])
    requester_name = None

    if requester_user is not None:
        requester_name = getattr(requester_user, "global_name", None) or requester_user.name

    embed = discord.Embed(
        title=prompt.text,
        color=style["color"],
    )
    embed.set_footer(text=f"Type: {style['label'].upper()} | Rating: {prompt.rating} | ID: {prompt.id}")

    if requester_name:
        avatar = requester_user.display_avatar.url if requester_user.display_avatar else None
        embed.set_author(name=f"Requested by {requester_name}", icon_url=avatar or discord.Embed.Empty)

    return embed


@dataclass
class PromptResult:
    id: str
    type: str
    text: str
    requester_tag: str
    rating: str = "PG-13"
    source: str = "local"


@dataclass
class ChannelState:
    history: list[str] = field(default_factory=list)
    used_truth: set[str] = field(default_factory=set)
    used_dare: set[str] = field(default_factory=set)


class AIPromptService:
    def __init__(self, api_key: str, model: str = "gpt-4.1-mini") -> None:
        self.enabled = bool(api_key and OpenAI is not None)
        self.model = model
        self.client = OpenAI(api_key=api_key) if self.enabled else None

    async def generate_prompt(self, *, prompt_type: str, recent_prompts: list[str]) -> str | None:
        if not self.enabled or self.client is None:
            return None

        return await asyncio.to_thread(self._generate_prompt_sync, prompt_type, recent_prompts)

    def _generate_prompt_sync(self, prompt_type: str, recent_prompts: list[str]) -> str | None:
        mode = "TRUTH" if prompt_type == "truth" else "DARE"
        recent_block = "\n".join(f"{index + 1}. {entry}" for index, entry in enumerate(recent_prompts[:20]))

        instruction = "\n".join(
            [
                "Generate exactly ONE concise Discord game prompt.",
                f"Mode: {mode}",
                "Style: funny, savage, playful, and Indian gen-z friendly.",
                "Allow crush, ex, celebrity, simping, and social-media themes, but not in every prompt.",
                "Keep the tone slightly filmy or slightly delulu when it fits.",
                "Keep it non-explicit, non-abusive, and profanity-free.",
                "Keep it under 130 characters.",
                "Avoid duplicates and avoid these recent prompts:",
                recent_block or "(none)",
                "Return only the prompt text. No numbering, no quotes, no labels.",
            ]
        )

        try:
            response = self.client.responses.create(
                model=self.model,
                input=instruction,
                temperature=0.9,
                max_output_tokens=80,
            )
        except Exception:
            return None

        prompt = sanitize_prompt(getattr(response, "output_text", ""))
        if not prompt or contains_blocked_words(prompt):
            return None

        return prompt


class PromptEngine:
    def __init__(self, truth_pool: list[str], dare_pool: list[str], ai_prompt_service: AIPromptService | None = None, recent_history_limit: int = 180) -> None:
        self.truth_pool = truth_pool
        self.dare_pool = dare_pool
        self.ai_prompt_service = ai_prompt_service
        self.recent_history_limit = recent_history_limit
        self.state_by_channel: dict[int, ChannelState] = {}

    def get_pool(self, prompt_type: str) -> list[str]:
        return self.dare_pool if prompt_type == "dare" else self.truth_pool

    def get_counts(self) -> dict[str, int]:
        return {"truth": len(self.truth_pool), "dare": len(self.dare_pool)}

    def resolve_type(self, mode: str) -> str:
        if mode in {"truth", "dare"}:
            return mode
        return "truth" if random.random() < 0.5 else "dare"

    def get_channel_state(self, channel_id: int) -> ChannelState:
        if channel_id not in self.state_by_channel:
            self.state_by_channel[channel_id] = ChannelState()
        return self.state_by_channel[channel_id]

    def get_channel_stats(self, channel_id: int) -> dict[str, int]:
        state = self.get_channel_state(channel_id)
        return {
            "historySize": len(state.history),
            "truthUsed": len(state.used_truth),
            "dareUsed": len(state.used_dare),
        }

    def push_history(self, channel_state: ChannelState, key: str) -> None:
        channel_state.history.insert(0, key)
        if len(channel_state.history) > self.recent_history_limit:
            channel_state.history.pop()

    def select_prompt_from_pool(self, pool: list[str], used_set: set[str], recent_history: list[str]) -> str | None:
        recent_set = set(recent_history[:80])
        recent_signatures = [
            build_prompt_signature(entry)
            for entry in recent_history[:18]
            if build_prompt_signature(entry)
        ]

        candidates = [prompt for prompt in pool if normalize_text(prompt) not in used_set and normalize_text(prompt) not in recent_set]

        if not candidates:
            used_set.clear()
            candidates = [prompt for prompt in pool if normalize_text(prompt) not in recent_set]

        if not candidates:
            candidates = pool

        scored_candidates = []
        for prompt in candidates:
            signature = build_prompt_signature(prompt)
            overlap = 0.0
            for recent_signature in recent_signatures:
                overlap = max(overlap, score_signature_overlap(signature, recent_signature))
            scored_candidates.append({"prompt": prompt, "overlap": overlap})

        scored_candidates.sort(key=lambda item: item["overlap"])
        preferred = [entry for entry in scored_candidates if entry["overlap"] < 0.45]
        selection_pool = (preferred if preferred else scored_candidates)[:60]
        return pick_random([entry["prompt"] for entry in selection_pool])

    async def get_next_prompt(self, *, mode: str, channel_id: int, requester_tag: str) -> PromptResult:
        prompt_type = self.resolve_type(mode)
        channel_state = self.get_channel_state(channel_id)

        used_set = channel_state.used_dare if prompt_type == "dare" else channel_state.used_truth
        pool = self.get_pool(prompt_type)
        text = self.select_prompt_from_pool(pool, used_set, channel_state.history)
        source = "local"

        if not text and self.ai_prompt_service is not None:
            recent = []
            for key in channel_state.history[:25]:
                match = next((prompt for prompt in pool if normalize_text(prompt) == key), None)
                if match:
                    recent.append(match)

            ai_prompt = await self.ai_prompt_service.generate_prompt(prompt_type=prompt_type, recent_prompts=recent)
            if ai_prompt and not contains_blocked_words(ai_prompt):
                text = ai_prompt
                source = "ai"

        if not text:
            text = (
                "What is the most simp thing you have done but still deny?"
                if prompt_type == "truth"
                else "Draft a clean flirty IG reply in one line."
            )
            source = "fallback"

        text_key = normalize_text(text)
        if prompt_type == "truth":
            channel_state.used_truth.add(text_key)
        else:
            channel_state.used_dare.add(text_key)
        self.push_history(channel_state, text_key)

        return PromptResult(
            id=short_id(prompt_type),
            type=prompt_type,
            text=text,
            requester_tag=requester_tag,
            source=source,
        )


class PromptButtonsView(discord.ui.View):
    def __init__(self, prompt_engine: PromptEngine) -> None:
        super().__init__(timeout=1800)
        self.prompt_engine = prompt_engine

    async def send_prompt(self, interaction: discord.Interaction, mode: str) -> None:
        await interaction.response.defer()
        prompt = await self.prompt_engine.get_next_prompt(
            mode=mode,
            channel_id=interaction.channel_id or 0,
            requester_tag=str(interaction.user),
        )

        if interaction.message is not None:
            try:
                await interaction.message.edit(view=None)
            except discord.HTTPException:
                pass

        await interaction.followup.send(
            embed=build_prompt_embed(prompt, interaction.user),
            view=PromptButtonsView(self.prompt_engine),
        )

    @discord.ui.button(label="Truth", style=discord.ButtonStyle.success, custom_id="tod:truth")
    async def truth_button(self, interaction: discord.Interaction, _: discord.ui.Button) -> None:
        await self.send_prompt(interaction, "truth")

    @discord.ui.button(label="Dare", style=discord.ButtonStyle.danger, custom_id="tod:dare")
    async def dare_button(self, interaction: discord.Interaction, _: discord.ui.Button) -> None:
        await self.send_prompt(interaction, "dare")

    @discord.ui.button(label="Random", style=discord.ButtonStyle.primary, custom_id="tod:random")
    async def random_button(self, interaction: discord.Interaction, _: discord.ui.Button) -> None:
        await self.send_prompt(interaction, "random")


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
        print(f"Prompt pool loaded: {counts['truth']} truths, {counts['dare']} dares.")

        if self.commands_synced:
            return

        scope = "global"
        try:
            guild_id = read_env_int("DISCORD_GUILD_ID", "GUILD_ID")
            if guild_id:
                guild = discord.Object(id=guild_id)
                self.tree.copy_global_to(guild=guild)
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
        error = discord.utils.utcnow()
        write_status(
            phase="discord_client_error",
            discord_ready=self.is_ready(),
            bot_user=str(self.user) if self.user else None,
            last_error=f"Unhandled error during {event_method} at {error.isoformat()}",
        )
        raise


if load_dotenv is not None:
    load_dotenv(ROOT_DIR / ".env")

TOKEN = read_env("BOT_TOKEN", "DISCORD_TOKEN")
OPENAI_API_KEY = read_env("OPENAI_API_KEY")
OPENAI_MODEL = read_env("OPENAI_MODEL", fallback="gpt-4.1-mini")

if not TOKEN:
    raise RuntimeError("BOT_TOKEN or DISCORD_TOKEN is not set.")

truth_pool, dare_pool = load_prompt_pools()
ai_prompt_service = AIPromptService(api_key=OPENAI_API_KEY, model=OPENAI_MODEL)
prompt_engine = PromptEngine(truth_pool=truth_pool, dare_pool=dare_pool, ai_prompt_service=ai_prompt_service)
bot = TruthDareBot(prompt_engine=prompt_engine)


async def reply_with_prompt(interaction: discord.Interaction, mode: str) -> None:
    await interaction.response.defer()
    prompt = await bot.prompt_engine.get_next_prompt(
        mode=mode,
        channel_id=interaction.channel_id or 0,
        requester_tag=str(interaction.user),
    )
    await interaction.followup.send(
        embed=build_prompt_embed(prompt, interaction.user),
        view=PromptButtonsView(bot.prompt_engine),
    )


@bot.tree.command(name="truthordare", description="Get a Truth, Dare, or Random challenge panel.")
@app_commands.describe(mode="Choose what prompt type you want")
@app_commands.choices(
    mode=[
        app_commands.Choice(name="Random", value="random"),
        app_commands.Choice(name="Truth", value="truth"),
        app_commands.Choice(name="Dare", value="dare"),
    ]
)
async def truth_or_dare(interaction: discord.Interaction, mode: app_commands.Choice[str] | None = None) -> None:
    try:
        await reply_with_prompt(interaction, mode.value if mode else "random")
    except Exception as error:
        print(f"Interaction error: {error}")
        if interaction.response.is_done():
            await interaction.followup.send("Something broke while generating the prompt. Try again.", ephemeral=True)
        else:
            await interaction.response.send_message("Something broke while generating the prompt. Try again.", ephemeral=True)


@bot.tree.command(name="todstats", description="Show prompt pool size and anti-repeat status.")
async def tod_stats(interaction: discord.Interaction) -> None:
    try:
        await interaction.response.defer(ephemeral=True)
        counts = bot.prompt_engine.get_counts()
        channel_stats = bot.prompt_engine.get_channel_stats(interaction.channel_id or 0)
        content = "\n".join(
            [
                f"Truth pool: **{counts['truth']:,}**",
                f"Dare pool: **{counts['dare']:,}**",
                f"Channel recent history: **{channel_stats['historySize']}**",
                f"Unique truths used in channel: **{channel_stats['truthUsed']}**",
                f"Unique dares used in channel: **{channel_stats['dareUsed']}**",
                f"AI fallback: **{'ON' if ai_prompt_service.enabled else 'OFF'}**",
            ]
        )
        await interaction.followup.send(content, ephemeral=True)
    except Exception as error:
        print(f"Interaction error: {error}")
        if interaction.response.is_done():
            await interaction.followup.send("Something broke while loading stats. Try again.", ephemeral=True)
        else:
            await interaction.response.send_message("Something broke while loading stats. Try again.", ephemeral=True)


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
