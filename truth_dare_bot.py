import json
import os
import random
import re
import secrets
import time
import asyncio
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
CORE_PROMPT_FILE = DATA_DIR / "core_prompt_catalog.json"
PROMPT_POOL_FILE = DATA_DIR / "prompt_pools.json"
STATUS_FILE = DATA_DIR / "runtime_status.json"
SETTINGS_FILE = DATA_DIR / "bot_settings.json"
AI_CACHE_FILE = DATA_DIR / "ai_prompt_cache.json"

RATINGS = ["PG", "PG13", "R"]
MADE_WITH_TAG = "Made with \u2615\ufe0f and \U0001f9e0 By Yuvraj"
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
AI_PARANOIA_REFRESH_SECONDS = max(300, int(os.getenv("AI_PARANOIA_REFRESH_SECONDS", "1800")))
AI_PARANOIA_BATCH_SIZE = max(3, int(os.getenv("AI_PARANOIA_BATCH_SIZE", "6")))
AI_PARANOIA_CACHE_TARGET = max(AI_PARANOIA_BATCH_SIZE, int(os.getenv("AI_PARANOIA_CACHE_TARGET", "18")))
CONTROL_REPLY_TTL_SECONDS = max(8, int(os.getenv("CONTROL_REPLY_TTL_SECONDS", "20")))
BLOCKED_AI_TERMS = {
    "politics",
    "religion",
    "caste",
    "racist",
    "race",
    "suicide",
    "self harm",
    "body count",
    "nude",
    "naked",
    "slur",
    "cheating",
    "abuse",
    "pregnant",
    "pregnancy",
    "sex",
    "hookup",
    "drunk",
    "weed",
    "drug",
    "alcohol",
}
SCOPE_CHOICES = [
    app_commands.Choice(name="This channel", value="channel"),
    app_commands.Choice(name="This server", value="server"),
]
DEFAULT_DEV_USER_IDS = {1240237445841420302}


def command_prefix(_bot: commands.Bot, _message: discord.Message) -> tuple[str, ...]:
    return ("<<", "<")


@dataclass(slots=True)
class PromptEntry:
    game: str
    category: str
    rating: str
    text: str
    tone: str
    weight: float
    key: str
    server_only: bool = False


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
    guild_name: str
    channel_id: int
    channel_name: str
    requester_id: int
    requester_name: str
    requester_avatar_url: str | None
    target_user_id: int
    prompt: PromptResult
    status: str = "awaiting_answer"
    ack_message_id: int | None = None
    dm_channel_id: int | None = None
    dm_message_id: int | None = None
    answer_text: str | None = None


@dataclass(slots=True)
class RuntimeSettings:
    disabled_guilds: set[int] = field(default_factory=set)
    disabled_channels: set[int] = field(default_factory=set)


paranoia_rounds: dict[str, ParanoiaRound] = {}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_storage() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def normalize_for_filter(text: str | None) -> str:
    return normalize_text(text).replace("  ", " ")


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


def contains_blocked_ai_term(text: str) -> bool:
    normalized = normalize_for_filter(text)
    return any(term in normalized for term in BLOCKED_AI_TERMS)


def titleize_category(category: str) -> str:
    return category.replace("_", " ").title()


def build_prompt_key(game: str, category: str, rating: str, text: str) -> str:
    return normalize_text(f"{game}|{category}|{rating}|{text}")


def short_id(prefix: str = "tod") -> str:
    return f"{prefix}_{secrets.token_urlsafe(6)}"


def load_runtime_settings() -> RuntimeSettings:
    if not SETTINGS_FILE.exists():
        return RuntimeSettings()

    try:
        payload = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return RuntimeSettings()

    return RuntimeSettings(
        disabled_guilds={int(value) for value in payload.get("disabled_guilds", [])},
        disabled_channels={int(value) for value in payload.get("disabled_channels", [])},
    )


def save_runtime_settings(settings: RuntimeSettings) -> None:
    ensure_storage()
    SETTINGS_FILE.write_text(
        json.dumps(
            {
                "disabled_guilds": sorted(settings.disabled_guilds),
                "disabled_channels": sorted(settings.disabled_channels),
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def is_location_disabled(settings: RuntimeSettings, guild_id: int | None, channel_id: int | None) -> bool:
    return (guild_id is not None and guild_id in settings.disabled_guilds) or (
        channel_id is not None and channel_id in settings.disabled_channels
    )


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
                    server_only=bool(item.get("server_only")),
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


def append_prompt(
    prompts: list[PromptEntry],
    seen_keys: set[str],
    *,
    game: str,
    category: str,
    rating: str,
    text: str,
    tone: str,
    weight: float = 1.0,
    server_only: bool = False,
) -> None:
    clean = sanitize_prompt(text)
    if not clean:
        return
    key = build_prompt_key(game, category, rating, clean)
    if key in seen_keys:
        return
    seen_keys.add(key)
    prompts.append(
        PromptEntry(
            game=game,
            category=category,
            rating=rating,
            text=clean,
            tone=tone,
            weight=weight,
            key=key,
            server_only=server_only,
        )
    )


def extend_with_server_reference_prompts(prompts: list[PromptEntry]) -> list[PromptEntry]:
    seen_keys = {prompt.key for prompt in prompts}
    server_prompts = list(prompts)

    truth_prompts = {
        "PG": [
            "Which person in this server could expose your personality the fastest?",
            "Whose messages in this server do you read first when they pop up?",
            "What is your most obvious habit in this server that people have definitely noticed?",
            "Which channel in this server matches your real personality the most?",
            "Who in this server would instantly know when you are pretending to be calm?",
            "What is the most embarrassing way this server could roast your typing style?",
            "Which person in this server do you think has the funniest timing?",
            "What is one thing you always notice in this server but never say out loud?",
            "Who in this server would make you the most nervous if they suddenly DMed you?",
            "What is your most unserious habit when you are lurking in this server?",
            "Which person in this server would you trust to write your public apology?",
            "What is the most suspicious reason you have checked the member list here?",
            "Whose reaction in this server affects your confidence more than it should?",
            "What is your biggest fake-calm move in this server?",
            "Who in this server has the energy of knowing exactly what you are up to?",
            "Which server moment would you erase from your own memory first?",
            "Whose approval in this server would secretly mean way too much to you?",
            "What is the most obvious thing about you during voice chat in this server?",
        ],
        "PG13": [
            "Who in this server could distract you with one good reply?",
            "Whose message in this server could make you smile and hide your phone immediately?",
            "What is the boldest thing you would admit about your vibe in this server?",
            "Who in this server would make you act the most different from your normal self?",
            "Whose attention in this server would boost your ego the fastest?",
            "What is your most obvious tell when one specific person is active in this server?",
            "Which person in this server could get away with teasing you the easiest?",
            "Who in this server could make you overthink one harmless message for hours?",
            "What is the softest thing you would do if the right person in this server gave you attention?",
            "Whose voice in this server would ruin your ability to act normal the fastest?",
            "Who in this server would you trust with one dangerous secret and instantly regret trusting?",
            "What is your most delusional thought you could have about someone active in this server?",
        ],
        "R": [
            "Who in this server could make you fold with almost no effort?",
            "What is the riskiest harmless thought you could have about someone in this server and still deny later?",
            "Who in this server could get one smooth line out of you and completely change your mood?",
            "Whose late-night presence in this server would make you the least trustworthy version of yourself?",
            "What is the boldest harmless thing you would admit about someone in this server noticing you?",
            "Who in this server could make you act unbothered while clearly failing at it?",
        ],
    }

    dare_prompts = {
        "PG": [
            "Drop a one-line review of this server like it is a chaotic restaurant.",
            "Tag one person in this server and give them a clean movie title.",
            "Post the safest photo from your gallery that somehow matches this server's vibe.",
            "Send a fake patch note about your behavior in this server.",
            "Type a dramatic apology to this server for your most obvious chat habit.",
            "React to the last five visible messages with your best fitting emoji.",
            "Send a one-line trailer voiceover for the current state of this server.",
            "Post a harmless confession beginning with 'This server made me realize...'",
            "Rename your mood in one line as if this server caused it.",
            "Tag someone and tell them what role they would play in a low-budget series about this server.",
            "Drop a harmless hot take about this server using exactly six words.",
            "Send the most dramatic safe status update about what this server does to your concentration.",
            "Type your next message in this channel like a sports commentator.",
            "Post one safe picture of the nearest object that represents your energy in this server.",
            "Compliment the funniest person you can think of in this server without using the word funny.",
        ],
        "PG13": [
            "Send one suspiciously confident line that could only exist in this server and then refuse to explain it.",
            "Tag the person with the most dangerous timing in this server and give them a clean title.",
            "Post a safe selfie angle or hand photo and caption it like this server is your audience.",
            "Drop a one-line warning for anyone who underestimates your energy in this server.",
            "Send a harmlessly bold review of the current vibe in this server.",
            "Type a message that sounds like you know something about this server and then add 'allegedly'.",
            "Describe your current server aura in one dramatic sentence.",
            "Give this server a fake episode title based on what happened today.",
            "Send the cleanest one-line flex you can get away with in this server.",
            "Tag someone in this server and assign them the role of final boss, narrator, or plot twist.",
        ],
        "R": [
            "Send one dangerously confident harmless line and let the server judge it.",
            "Post the smoothest safe caption you can think of for this server and do not explain it.",
            "Type the most suspicious clean sentence possible about the current server vibe.",
            "Tag the person here with the strongest menace-to-composure energy and give no context.",
            "Drop one late-night-quality line that is bold but still clean enough to survive this server.",
        ],
    }

    nhie_prompts = {
        "PG": [
            "Never have I ever checked who was online in this server for no reason.",
            "Never have I ever typed a whole message in this server and deleted it.",
            "Never have I ever stalked the member list here and acted like I did not.",
            "Never have I ever laughed at the wrong thing in this server and hoped nobody noticed.",
            "Never have I ever stayed in this server chat only for the unfolding drama.",
            "Never have I ever read old messages in this server just to reconnect the lore.",
            "Never have I ever acted busy while clearly watching this server in real time.",
            "Never have I ever waited for one specific person to say something in this server.",
            "Never have I ever opened this server to procrastinate and stayed way longer than planned.",
            "Never have I ever acted confident in this server while fully guessing the vibe.",
        ],
        "PG13": [
            "Never have I ever smiled at my screen because of someone active in this server.",
            "Never have I ever checked whether one specific person was online in this server.",
            "Never have I ever overthought one harmless message from someone in this server.",
            "Never have I ever acted less interested in this server than I actually was.",
            "Never have I ever hoped one specific person in this server would notice a message or post.",
            "Never have I ever replayed a good conversation from this server in my head later.",
            "Never have I ever changed my tone in this server because one person was around.",
        ],
        "R": [
            "Never have I ever acted fully unbothered in this server while clearly caring too much.",
            "Never have I ever stayed online in this server for one conversation I had no business waiting for.",
            "Never have I ever typed something bold in this server and then replaced it with something safe.",
            "Never have I ever let one tiny interaction in this server affect my whole mood.",
        ],
    }

    paranoia_prompts = {
        "PG": [
            "Who here would start the funniest chaos in this server and then act innocent?",
            "Who here would get exposed first by their own reaction history in this server?",
            "Who here would have the best secret folder of screenshots from this server?",
            "Who here would narrate this server like a reality show if given the chance?",
            "Who here would accidentally leak the funniest detail during voice chat?",
            "Who here would know the most server lore without ever admitting it?",
            "Who here would turn one random message in this server into a full investigation?",
            "Who here would panic first if the wrong screenshot from this server got posted?",
            "Whose name comes to mind first for the biggest quiet observer in this server?",
            "Who here would make the best fake spokesperson for this server?",
            "Who here would be caught lurking at the exact wrong time in this server?",
            "Who here would absolutely say 'I know nothing' while knowing everything in this server?",
        ],
        "PG13": [
            "Who here would fold first after one suspiciously good reply in this server?",
            "Who here would act chill in this server while clearly watching one specific person?",
            "Who here would post something subtle in this server just for one person to notice?",
            "Who here would overanalyze one clean flirty message in this server the longest?",
            "Whose name comes to mind first for the most dangerous reply timing in this server?",
            "Who here would pretend not to care in this server and fail immediately?",
            "Who here would have the highest chance of smiling at their screen because of this server?",
            "Who here would say something playful in this server and shift the whole vibe?",
            "Who here would act the smoothest in this server until it was time to actually be smooth?",
            "Who here would check for one specific reaction in this server faster than they should admit?",
        ],
        "R": [
            "Who here would create the most harmless tension in this server with almost no effort?",
            "Who here would act the most composed in this server while their thoughts are complete chaos?",
            "Whose name comes to mind first for someone who would send the boldest clean line in this server?",
            "Who here would get the most dangerous confidence boost from one good interaction in this server?",
            "Who here would make the rest of this server start guessing with one suspicious sentence?",
            "Who here would cause the biggest late-night spiral in this server by doing almost nothing?",
        ],
    }

    for rating, items in truth_prompts.items():
        category = "social" if rating == "PG" else "bold"
        tone = "social" if rating == "PG" else "bold"
        for text in items:
            append_prompt(
                server_prompts,
                seen_keys,
                game="truth",
                category=category,
                rating=rating,
                text=text,
                tone=tone,
                weight=1.08,
                server_only=True,
            )

    for rating, items in dare_prompts.items():
        category = "social" if rating == "PG" else "bold"
        for text in items:
            append_prompt(
                server_prompts,
                seen_keys,
                game="dare",
                category=category,
                rating=rating,
                text=text,
                tone="social" if rating == "PG" else "bold",
                weight=1.08,
                server_only=True,
            )

    for rating, items in nhie_prompts.items():
        category = "social" if rating != "R" else "bold"
        tone = "social" if rating != "R" else "bold"
        for text in items:
            append_prompt(
                server_prompts,
                seen_keys,
                game="never_have_i_ever",
                category=category,
                rating=rating,
                text=text,
                tone=tone,
                weight=1.07,
                server_only=True,
            )

    for rating, items in paranoia_prompts.items():
        category = "social" if rating == "PG" else "bold"
        tone = "social" if rating == "PG" else "bold"
        for text in items:
            append_prompt(
                server_prompts,
                seen_keys,
                game="paranoia",
                category=category,
                rating=rating,
                text=text,
                tone=tone,
                weight=1.09,
                server_only=True,
            )

    return server_prompts


def load_ai_cache() -> list[PromptEntry]:
    if not AI_CACHE_FILE.exists():
        return []

    try:
        payload = json.loads(AI_CACHE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []

    prompts: list[PromptEntry] = []
    for item in payload.get("prompts", []):
        text = sanitize_prompt(item.get("text"))
        game = sanitize_prompt(item.get("game"))
        category = sanitize_prompt(item.get("category")) or "social"
        rating = sanitize_prompt(item.get("rating")) or "PG"
        tone = sanitize_prompt(item.get("tone")) or category
        if not text or game != "paranoia" or rating not in RATINGS or contains_blocked_ai_term(text):
            continue
        prompts.append(
            PromptEntry(
                game="paranoia",
                category=category if category in {"social", "bold", "flirty"} else "social",
                rating=rating,
                text=text,
                tone=tone if tone in {"social", "bold", "flirty"} else "social",
                weight=float(item.get("weight") or 1.02),
                key=sanitize_prompt(item.get("key")) or build_prompt_key("paranoia", category, rating, text),
                server_only=False,
            )
        )
    return prompts


def save_ai_cache(prompts: list[PromptEntry]) -> None:
    ensure_storage()
    payload = {
        "prompts": [
            {
                "game": prompt.game,
                "category": prompt.category,
                "rating": prompt.rating,
                "text": prompt.text,
                "tone": prompt.tone,
                "weight": prompt.weight,
                "key": prompt.key,
            }
            for prompt in prompts
            if prompt.game == "paranoia"
        ]
    }
    AI_CACHE_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")


class AIPromptService:
    def __init__(self, api_key: str, model: str = "gpt-4.1-mini") -> None:
        self.enabled = bool(api_key and OpenAI is not None)
        self.model = model
        self.client = OpenAI(api_key=api_key) if self.enabled else None

    async def generate_paranoia_pack(
        self,
        *,
        rating: str,
        recent_prompts: list[str],
        batch_size: int,
    ) -> list[PromptEntry]:
        if not self.enabled or self.client is None:
            return []
        return await asyncio.to_thread(
            self._generate_paranoia_pack_sync,
            rating,
            recent_prompts,
            batch_size,
        )

    def _generate_paranoia_pack_sync(
        self,
        rating: str,
        recent_prompts: list[str],
        batch_size: int,
    ) -> list[PromptEntry]:
        recent_block = "\n".join(f"{index + 1}. {entry}" for index, entry in enumerate(recent_prompts[:20]))
        instruction = "\n".join(
            [
                "Return only a JSON array.",
                f"Generate {batch_size} unique Discord paranoia prompts.",
                "Each item must be an object with keys: category, tone, text.",
                "Allowed category values: social, bold, flirty.",
                "Allowed tone values: social, bold, flirty.",
                f"Rating: {rating}",
                "Focus on Discord server energy: channels, member lists, reactions, voice chat, lurking, timing, screenshots, status, vibes.",
                "Make them funny, clever, crazy, unique, and playable in a server.",
                "Keep them controversy-free and non-explicit.",
                "No politics, religion, caste, race, trauma, abuse, cheating accusations, explicit sexual content, or slurs.",
                "Avoid generic or stale prompts like hottest person, best kisser, biggest crush.",
                "Most prompts should start with 'Who here' or 'Whose'.",
                "Recent prompts to avoid:",
                recent_block or "(none)",
            ]
        )

        response = self.client.responses.create(
            model=self.model,
            input=instruction,
            temperature=1.05,
            max_output_tokens=1400,
        )
        raw_text = sanitize_prompt(getattr(response, "output_text", ""))
        if raw_text.startswith("```"):
            raw_text = re.sub(r"^```(?:json)?", "", raw_text).strip()
            raw_text = re.sub(r"```$", "", raw_text).strip()

        start = raw_text.find("[")
        end = raw_text.rfind("]")
        if start == -1 or end == -1 or end <= start:
            return []

        try:
            items = json.loads(raw_text[start : end + 1])
        except json.JSONDecodeError:
            return []

        prompts: list[PromptEntry] = []
        seen_keys: set[str] = set()
        for item in items:
            text = sanitize_prompt(item.get("text"))
            category = sanitize_prompt(item.get("category")).lower() or "social"
            tone = sanitize_prompt(item.get("tone")).lower() or category
            if (
                not text
                or category not in {"social", "bold", "flirty"}
                or tone not in {"social", "bold", "flirty"}
                or contains_blocked_ai_term(text)
            ):
                continue
            key = build_prompt_key("paranoia", category, rating, text)
            if key in seen_keys:
                continue
            seen_keys.add(key)
            prompts.append(
                PromptEntry(
                    game="paranoia",
                    category=category,
                    rating=rating,
                    text=text,
                    tone=tone,
                    weight=1.03,
                    key=key,
                    server_only=False,
                )
            )

        return prompts

class PromptEngine:
    def __init__(self, prompts: list[PromptEntry], recent_history_limit: int = 220) -> None:
        self.prompts = prompts
        self.recent_history_limit = recent_history_limit
        self.state_by_channel: dict[int, ChannelState] = {}
        self.state_by_guild: dict[int, ChannelState] = {}
        self.prompt_index: set[str] = {prompt.key for prompt in prompts}

    def get_channel_state(self, channel_id: int) -> ChannelState:
        if channel_id not in self.state_by_channel:
            self.state_by_channel[channel_id] = ChannelState()
        return self.state_by_channel[channel_id]

    def get_guild_state(self, guild_id: int) -> ChannelState:
        if guild_id not in self.state_by_guild:
            self.state_by_guild[guild_id] = ChannelState()
        return self.state_by_guild[guild_id]

    def extend_prompts(self, prompts: list[PromptEntry]) -> int:
        added = 0
        for prompt in prompts:
            if prompt.key in self.prompt_index:
                continue
            self.prompt_index.add(prompt.key)
            self.prompts.append(prompt)
            added += 1
        return added

    def clear_history(self, *, channel_id: int | None = None, guild_id: int | None = None) -> None:
        if channel_id is not None and channel_id in self.state_by_channel:
            self.state_by_channel[channel_id] = ChannelState()
        if guild_id is not None and guild_id in self.state_by_guild:
            self.state_by_guild[guild_id] = ChannelState()

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

    def _record_to_state(self, state: ChannelState, prompt: PromptEntry) -> None:
        state.used_by_game.setdefault(prompt.game, set()).add(prompt.key)
        state.usage_counts[prompt.key] = state.usage_counts.get(prompt.key, 0) + 1
        state.history.insert(0, HistoryEntry(prompt.key, prompt.game, prompt.category, prompt.tone, prompt.text))
        if len(state.history) > self.recent_history_limit:
            state.history.pop()

    def record_prompt(self, channel_id: int, guild_id: int | None, prompt: PromptEntry) -> None:
        self._record_to_state(self.get_channel_state(channel_id), prompt)
        if guild_id is not None:
            self._record_to_state(self.get_guild_state(guild_id), prompt)

    def score_candidates(
        self,
        candidates: list[PromptEntry],
        state: ChannelState,
        *,
        prefer_server_prompts: bool = False,
    ) -> list[tuple[PromptEntry, float]]:
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
            if prefer_server_prompts and prompt.server_only:
                weight *= 1.28
            scored.append((prompt, weight))

        scored.sort(key=lambda item: item[1], reverse=True)
        return scored[:64]

    async def get_next_prompt(
        self,
        *,
        requested_game: str,
        channel_id: int,
        guild_id: int | None,
        requester_tag: str,
        rating: str | None = None,
    ) -> PromptResult:
        game = self.resolve_game(requested_game)
        effective_rating = rating if rating in RATINGS else "PG"
        channel_state = self.get_channel_state(channel_id)
        guild_state = self.get_guild_state(guild_id) if guild_id is not None else None
        matching = [
            prompt
            for prompt in self.prompts
            if prompt.game == game
            and prompt.rating == effective_rating
            and (guild_id is not None or not prompt.server_only)
        ]

        if not matching and rating is not None:
            matching = [
                prompt
                for prompt in self.prompts
                if prompt.game == game
                and (guild_id is not None or not prompt.server_only)
            ]
        if not matching:
            raise RuntimeError(f"No prompts are available for {GAME_LABELS.get(game, game)}.")

        used_keys = set(channel_state.used_by_game.get(game, set()))
        recent_keys = {entry.key for entry in channel_state.history[: self.recent_history_limit]}
        if guild_state is not None:
            used_keys.update(guild_state.used_by_game.get(game, set()))
            recent_keys.update(entry.key for entry in guild_state.history[: self.recent_history_limit])
        unseen = [prompt for prompt in matching if prompt.key not in used_keys and prompt.key not in recent_keys]

        if not unseen:
            channel_state.used_by_game[game] = set()
            if guild_state is not None:
                guild_state.used_by_game[game] = set()
            unseen = [prompt for prompt in matching if prompt.key not in recent_keys]

        candidate_pool = unseen if unseen else [prompt for prompt in matching if prompt.key not in recent_keys]
        if not candidate_pool:
            candidate_pool = matching

        selected = weighted_choice(
            self.score_candidates(
                candidate_pool,
                channel_state if guild_state is None else ChannelState(
                    history=channel_state.history[:40] + guild_state.history[:40],
                    used_by_game={},
                    usage_counts={
                        **guild_state.usage_counts,
                        **channel_state.usage_counts,
                    },
                ),
                prefer_server_prompts=guild_id is not None,
            )
        ) or random.choice(candidate_pool)
        self.record_prompt(channel_id, guild_id, selected)
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


def escape_md(value: str | None) -> str:
    return discord.utils.escape_markdown(str(value or ""), as_needed=True)


def build_paranoia_jump_url(round_data: ParanoiaRound) -> str:
    return f"https://discord.com/channels/{round_data.guild_id}/{round_data.channel_id}"


def build_paranoia_footer_text(round_data: ParanoiaRound, *, include_type: bool = True) -> str:
    parts: list[str] = []
    if include_type:
        parts.append("PARANOIA")
    parts.append(f"Rating {round_data.prompt.rating}")
    parts.append(f"ID {round_data.prompt.id}")
    parts.append(MADE_WITH_TAG)
    return f"-# {' \u2022 '.join(parts)}"


def build_paranoia_dm_details(round_data: ParanoiaRound, *, answered: bool = False) -> str:
    reveal_line = "Your answer was sent anonymously." if answered else "Your name stays out of the public reveal."
    return "\n\n".join(
        [
            f"**👤 Sent by**\n{escape_md(round_data.requester_name)}",
            f"**🎭 Reveal style**\n{reveal_line}",
        ]
    )


def build_paranoia_card_container(
    *,
    eyebrow: str,
    headline: str,
    body: str,
    accent_color: int,
    footer: str,
    accessory_url: str | None = None,
    actions: list[discord.ui.Button[Any]] | None = None,
) -> discord.ui.Container:
    container = discord.ui.Container(accent_color=accent_color)
    container.add_item(discord.ui.TextDisplay(f"-# {eyebrow}"))
    container.add_item(discord.ui.TextDisplay(f"## {headline}"))

    if accessory_url:
        container.add_item(discord.ui.Section(body, accessory=discord.ui.Thumbnail(accessory_url)))
    else:
        container.add_item(discord.ui.TextDisplay(body))

    if actions:
        row = discord.ui.ActionRow()
        for action in actions:
            row.add_item(action)
        container.add_item(row)

    container.add_item(discord.ui.Separator(spacing=discord.SeparatorSpacing.large))
    container.add_item(discord.ui.TextDisplay(footer))
    return container


def build_paranoia_card_view(
    *,
    eyebrow: str,
    headline: str,
    body: str,
    accent_color: int,
    footer: str,
    accessory_url: str | None = None,
    actions: list[discord.ui.Button[Any]] | None = None,
    timeout: float | None = None,
) -> discord.ui.LayoutView:
    view = discord.ui.LayoutView(timeout=timeout)
    container = build_paranoia_card_container(
        eyebrow=eyebrow,
        headline=headline,
        body=body,
        accent_color=accent_color,
        footer=footer,
        accessory_url=accessory_url,
        actions=actions,
    )
    view.add_item(container)
    return view


def build_paranoia_launch_view(round_data: ParanoiaRound, *, answered: bool = False) -> discord.ui.LayoutView:
    if answered:
        return build_paranoia_card_view(
            eyebrow="Truth OR Dare \u2022 Paranoia",
            headline="\u2705 Anonymous answer received",
            body="The reveal just landed below.",
            accent_color=0x57F287,
            footer=f"-# Anonymous mode stayed clean \u2022 {MADE_WITH_TAG}",
        )

    return build_paranoia_card_view(
        eyebrow="Truth OR Dare \u2022 Paranoia",
        headline="\U0001f92b Secret question delivered",
        body=(
            "Someone got a private Paranoia question.\n\n"
            "The anonymous answer will appear here once they reply."
        ),
        accent_color=GAME_COLORS["paranoia"],
        footer=f"-# No requester or answerer is shown here \u2022 {MADE_WITH_TAG}",
    )


def build_paranoia_reveal_view(round_data: ParanoiaRound) -> discord.ui.LayoutView:
    return build_paranoia_card_view(
        eyebrow="Truth OR Dare \u2022 Paranoia",
        headline=escape_md(round_data.prompt.text),
        body=f"**\U0001f4ac Anonymous answer**\n{escape_md(round_data.answer_text or 'No answer provided.')}",
        accent_color=GAME_COLORS["paranoia"],
        footer=build_paranoia_footer_text(round_data),
    )


def build_paranoia_failure_embed() -> discord.Embed:
    embed = discord.Embed(
        title="📭 Paranoia could not be delivered",
        description="I could not DM that user. Ask them to open DMs and try again.",
        color=0xED4245,
    )
    embed.set_footer(text="No round was started.")
    return embed


def build_disabled_embed(scope: str) -> discord.Embed:
    label = "this server" if scope == "server" else "this channel"
    return discord.Embed(
        title="Bot disabled here",
        description=f"This bot is currently disabled in {label}.",
        color=0xED4245,
    )


def build_control_status_embed(bot_instance: "TruthDareBot", interaction: discord.Interaction) -> discord.Embed:
    settings = bot_instance.runtime_settings
    scope_lines = [
        f"Server disabled: **{'Yes' if interaction.guild_id in settings.disabled_guilds else 'No'}**",
        f"Channel disabled: **{'Yes' if (interaction.channel_id or 0) in settings.disabled_channels else 'No'}**",
        f"Developer IDs loaded: **{len(bot_instance.dev_user_ids)}**",
        f"AI paranoia refresh: **{'ON' if bot_instance.ai_prompt_service.enabled else 'OFF'}**",
    ]
    counts = bot_instance.prompt_engine.get_counts()
    embed = discord.Embed(
        title="Bot control status",
        description="\n".join(scope_lines),
        color=0x5865F2,
    )
    embed.add_field(
        name="Prompt pools",
        value=(
            f"Truth **{counts.get('truth', 0):,}**\n"
            f"Dare **{counts.get('dare', 0):,}**\n"
            f"Never Ever **{counts.get('never_have_i_ever', 0):,}**\n"
            f"Paranoia **{counts.get('paranoia', 0):,}**"
        ),
        inline=False,
    )
    return embed


async def check_bot_enabled(interaction: discord.Interaction) -> bool:
    if is_location_disabled(bot.runtime_settings, interaction.guild_id, interaction.channel_id):
        scope = "server" if interaction.guild_id in bot.runtime_settings.disabled_guilds else "channel"
        await interaction.response.send_message(embed=build_disabled_embed(scope), ephemeral=True)
        return False
    return True


async def check_button_enabled(interaction: discord.Interaction) -> bool:
    if is_location_disabled(bot.runtime_settings, interaction.guild_id, interaction.channel_id):
        scope = "server" if interaction.guild_id in bot.runtime_settings.disabled_guilds else "channel"
        await interaction.response.send_message(embed=build_disabled_embed(scope), ephemeral=True)
        return False
    return True


async def ensure_developer(interaction: discord.Interaction) -> bool:
    if bot.is_developer_user(interaction.user.id):
        return True
    await interaction.response.send_message("This command is developer-only.", ephemeral=True)
    return False


async def apply_disable_toggle(interaction: discord.Interaction, scope: str, disabled: bool) -> None:
    if interaction.guild_id is None:
        await interaction.followup.send("This command only works in servers.", ephemeral=True)
        return

    if scope == "server":
        target_set = bot.runtime_settings.disabled_guilds
        target_id = interaction.guild_id
        label = "this server"
    else:
        target_set = bot.runtime_settings.disabled_channels
        target_id = interaction.channel_id or 0
        label = "this channel"

    if disabled:
        target_set.add(target_id)
    else:
        target_set.discard(target_id)

    save_runtime_settings(bot.runtime_settings)
    await interaction.followup.send(
        f"{'Disabled' if disabled else 'Enabled'} the bot in **{label}**.",
        ephemeral=True,
    )


def build_prompt_footer_text(prompt: PromptResult) -> str:
    return f"-# ID {prompt.id} • {MADE_WITH_TAG}"


def build_prompt_details_text(prompt: PromptResult, requester_name: str | None) -> str:
    lines: list[str] = []
    if requester_name:
        lines.append(f"**👤 Requested by**\n{escape_md(requester_name)}")
    lines.append(f"**✨ Details**\n{titleize_category(prompt.category)} • {prompt.rating}")
    return "\n\n".join(lines)


class PromptCardView(discord.ui.LayoutView):
    def __init__(
        self,
        prompt_engine: PromptEngine,
        prompt: PromptResult,
        *,
        requester_name: str | None = None,
        requester_avatar_url: str | None = None,
        interactive: bool = True,
    ) -> None:
        super().__init__(timeout=240 if interactive else None)
        self.prompt_engine = prompt_engine
        self.prompt = prompt
        self.requester_name = requester_name
        self.requester_avatar_url = requester_avatar_url

        actions = self._build_actions() if interactive else None
        self.add_item(
            build_paranoia_card_container(
                eyebrow=f"Truth OR Dare • {GAME_LABELS.get(prompt.game, prompt.game)}",
                headline=escape_md(prompt.text),
                body=build_prompt_details_text(prompt, requester_name),
                accent_color=GAME_COLORS.get(prompt.game, 0x5865F2),
                footer=build_prompt_footer_text(prompt),
                accessory_url=requester_avatar_url,
                actions=actions,
            )
        )

    def _build_actions(self) -> list[discord.ui.Button[Any]]:
        if self.prompt.game in {"truth", "dare"}:
            return [
                self._build_prompt_button("Truth", "🟢", discord.ButtonStyle.success, "truth", self.prompt.rating),
                self._build_prompt_button("Dare", "🔴", discord.ButtonStyle.danger, "dare", self.prompt.rating),
                self._build_prompt_button("Random", "🎲", discord.ButtonStyle.primary, "truth_or_dare", self.prompt.rating),
            ]

        if self.prompt.game == "never_have_i_ever":
            return [
                self._build_prompt_button("Next", "🌀", discord.ButtonStyle.primary, "never_have_i_ever", self.prompt.rating),
                self._build_prompt_button("Any Rating", "🎲", discord.ButtonStyle.success, "never_have_i_ever", None),
            ]

        return []

    def _build_prompt_button(
        self,
        label: str,
        emoji: str,
        style: discord.ButtonStyle,
        game: str,
        rating: str | None,
    ) -> discord.ui.Button[Any]:
        button = discord.ui.Button(label=label, emoji=emoji, style=style)

        async def callback(interaction: discord.Interaction) -> None:
            if not await check_button_enabled(interaction):
                return
            await interaction.response.defer()
            if interaction.message is not None:
                try:
                    await interaction.message.edit(
                        view=PromptCardView(
                            self.prompt_engine,
                            self.prompt,
                            requester_name=self.requester_name,
                            requester_avatar_url=self.requester_avatar_url,
                            interactive=False,
                        )
                    )
                except discord.HTTPException:
                    pass

            next_prompt = await self.prompt_engine.get_next_prompt(
                requested_game=game,
                channel_id=interaction.channel_id or 0,
                guild_id=interaction.guild_id,
                requester_tag=str(interaction.user),
                rating=rating,
            )
            next_requester_name = getattr(interaction.user, "global_name", None) or interaction.user.name
            next_requester_avatar = interaction.user.display_avatar.url if interaction.user.display_avatar else None
            await interaction.followup.send(
                view=PromptCardView(
                    self.prompt_engine,
                    next_prompt,
                    requester_name=next_requester_name,
                    requester_avatar_url=next_requester_avatar,
                )
            )

        button.callback = callback
        return button


class ParanoiaAnswerModal(discord.ui.Modal, title="Anonymous Answer"):
    answer = discord.ui.TextInput(
        label="Your answer",
        style=discord.TextStyle.paragraph,
        max_length=220,
        min_length=2,
        placeholder="Drop the answer that will make the chat overthink.",
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

        await channel.send(view=build_paranoia_reveal_view(round_data))

        if round_data.ack_message_id:
            try:
                ack_message = await channel.fetch_message(round_data.ack_message_id)
                await ack_message.delete()
            except discord.HTTPException:
                pass

        dm_channel = interaction.channel
        if isinstance(dm_channel, discord.DMChannel) and round_data.dm_message_id:
            try:
                dm_message = await dm_channel.fetch_message(round_data.dm_message_id)
                await dm_message.edit(view=ParanoiaAnswerView(self.bot_instance, self.round_id, answered=True))
            except discord.HTTPException:
                pass

        round_data.status = "answered"
        await interaction.response.send_message("Answer sent anonymously.")


class ParanoiaAnswerView(discord.ui.LayoutView):
    def __init__(self, bot_instance: "TruthDareBot", round_id: str, *, answered: bool = False) -> None:
        super().__init__(timeout=None if answered else 1800)
        self.bot_instance = bot_instance
        self.round_id = round_id

        round_data = paranoia_rounds.get(round_id)
        if round_data is None:
            return

        button = discord.ui.Button(
            label="Answered" if answered else "Answer",
            emoji="✅" if answered else "💬",
            style=discord.ButtonStyle.success if answered else discord.ButtonStyle.primary,
            disabled=answered,
        )
        if not answered:
            button.callback = self.answer_callback

        body = "\n\n".join(
            [
                build_paranoia_dm_details(round_data, answered=answered),
                "-# Reply once. Keep it funny, clean, and server-safe."
                if not answered
                else "-# Locked in. The public reveal already has your anonymous answer.",
            ]
        )

        container = discord.ui.Container(
            accent_color=0x57F287 if answered else GAME_COLORS["paranoia"],
        )
        container.add_item(discord.ui.TextDisplay("### Truth OR Dare • Paranoia"))
        container.add_item(
            discord.ui.TextDisplay(
                "## ✅ Answer locked in" if answered else "## 🤫 Secret Paranoia Drop"
            )
        )
        container.add_item(discord.ui.TextDisplay(f"# {escape_md(round_data.prompt.text)}"))
        container.add_item(discord.ui.TextDisplay(body))
        row = discord.ui.ActionRow()
        row.add_item(button)
        container.add_item(row)
        container.add_item(discord.ui.Separator(spacing=discord.SeparatorSpacing.large))
        container.add_item(discord.ui.TextDisplay(build_paranoia_footer_text(round_data, include_type=False)))
        self.add_item(container)

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
    def __init__(
        self,
        prompt_engine: PromptEngine,
        runtime_settings: RuntimeSettings,
        ai_prompt_service: AIPromptService,
        ai_cache_prompts: list[PromptEntry],
    ) -> None:
        intents = discord.Intents.none()
        intents.guilds = True
        intents.guild_messages = True
        intents.dm_messages = True
        intents.message_content = True
        super().__init__(
            command_prefix=command_prefix,
            intents=intents,
            help_command=None,
            case_insensitive=True,
        )
        self.prompt_engine = prompt_engine
        self.commands_synced = False
        self.runtime_settings = runtime_settings
        self.ai_prompt_service = ai_prompt_service
        self.ai_cache_prompts = ai_cache_prompts
        self.ai_refresh_task: asyncio.Task | None = None
        self.dev_user_ids: set[int] = set(DEFAULT_DEV_USER_IDS) | {
            int(value)
            for value in re.split(r"[,\s]+", read_env("BOT_OWNER_IDS", "DISCORD_DEVELOPER_IDS", fallback=""))
            if value.strip().isdigit()
        }

    async def hydrate_dev_user_ids(self) -> None:
        try:
            application_info = await self.application_info()
        except discord.HTTPException:
            return

        owner = getattr(application_info, "owner", None)
        team = getattr(application_info, "team", None)
        if owner is not None:
            self.dev_user_ids.add(owner.id)
        if team is not None:
            for member in team.members:
                self.dev_user_ids.add(member.id)

    def is_developer_user(self, user_id: int) -> bool:
        return user_id in self.dev_user_ids

    def reload_prompt_engine(self) -> None:
        base_prompts = extend_with_server_reference_prompts(load_prompt_catalog())
        self.ai_cache_prompts = load_ai_cache()
        self.prompt_engine = PromptEngine(base_prompts)
        self.prompt_engine.extend_prompts(self.ai_cache_prompts)

    async def sync_command_tree(self, *, guild_only: bool) -> str:
        guild_id = read_env_int("DISCORD_GUILD_ID", "GUILD_ID")
        if guild_only and guild_id:
            guild = discord.Object(id=guild_id)
            await self.tree.sync(guild=guild)
            return "guild"

        await self.tree.sync()
        return "global"

    async def refresh_ai_paranoia_cache(self, *, batch_size: int | None = None) -> int:
        if not self.ai_prompt_service.enabled:
            return 0

        existing_texts = [prompt.text for prompt in self.prompt_engine.prompts if prompt.game == "paranoia"]
        added_total = 0
        batch_target = batch_size or AI_PARANOIA_BATCH_SIZE
        existing_cache_keys = {prompt.key for prompt in self.ai_cache_prompts}

        for rating in RATINGS:
            current_ai_count = sum(
                1
                for prompt in self.ai_cache_prompts
                if prompt.game == "paranoia" and prompt.rating == rating
            )
            if current_ai_count >= AI_PARANOIA_CACHE_TARGET and batch_size is None:
                continue

            generated = await self.ai_prompt_service.generate_paranoia_pack(
                rating=rating,
                recent_prompts=existing_texts[-40:],
                batch_size=batch_target,
            )
            if not generated:
                continue

            added = self.prompt_engine.extend_prompts(generated)
            if added == 0:
                continue

            for prompt in generated:
                if prompt.key not in existing_cache_keys:
                    existing_cache_keys.add(prompt.key)
                    self.ai_cache_prompts.append(prompt)
                    existing_texts.append(prompt.text)

            added_total += added

        if added_total > 0:
            save_ai_cache(self.ai_cache_prompts)

        return added_total

    async def ai_paranoia_refresh_loop(self) -> None:
        await self.wait_until_ready()
        while not self.is_closed():
            try:
                await self.refresh_ai_paranoia_cache()
            except Exception as error:  # pragma: no cover
                print(f"AI paranoia refresh failed: {error}")
            await asyncio.sleep(AI_PARANOIA_REFRESH_SECONDS)

    async def on_ready(self) -> None:
        write_status(
            phase="discord_ready",
            discord_ready=True,
            bot_user=str(self.user) if self.user else None,
            last_error=None,
        )
        await self.hydrate_dev_user_ids()
        print(f"Logged in as {self.user}")
        counts = self.prompt_engine.get_counts()
        print(
            "Prompt catalog loaded: "
            f"{counts.get('truth', 0)} truths, "
            f"{counts.get('dare', 0)} dares, "
            f"{counts.get('never_have_i_ever', 0)} NHIE, "
            f"{counts.get('paranoia', 0)} paranoia."
        )

        if self.ai_prompt_service.enabled and self.ai_refresh_task is None:
            self.ai_refresh_task = asyncio.create_task(self.ai_paranoia_refresh_loop())

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
OPENAI_API_KEY = read_env("OPENAI_API_KEY")
OPENAI_MODEL = read_env("OPENAI_MODEL", fallback="gpt-4.1-mini")
if not TOKEN:
    raise RuntimeError("BOT_TOKEN or DISCORD_TOKEN is not set.")

runtime_settings = load_runtime_settings()
ai_prompt_service = AIPromptService(api_key=OPENAI_API_KEY, model=OPENAI_MODEL)
base_prompts = extend_with_server_reference_prompts(load_prompt_catalog())
ai_cache_prompts = load_ai_cache()
prompt_engine = PromptEngine(base_prompts)
prompt_engine.extend_prompts(ai_cache_prompts)
bot = TruthDareBot(
    prompt_engine=prompt_engine,
    runtime_settings=runtime_settings,
    ai_prompt_service=ai_prompt_service,
    ai_cache_prompts=ai_cache_prompts,
)


async def send_game_prompt(interaction: discord.Interaction, game: str, rating: str | None = None) -> None:
    if not await check_bot_enabled(interaction):
        return
    await interaction.response.defer()
    prompt = await bot.prompt_engine.get_next_prompt(
        requested_game=game,
        channel_id=interaction.channel_id or 0,
        guild_id=interaction.guild_id,
        requester_tag=str(interaction.user),
        rating=rating,
    )
    requester_name = getattr(interaction.user, "global_name", None) or interaction.user.name
    requester_avatar = interaction.user.display_avatar.url if interaction.user.display_avatar else None
    await interaction.followup.send(
        view=PromptCardView(
            bot.prompt_engine,
            prompt,
            requester_name=requester_name,
            requester_avatar_url=requester_avatar,
        )
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
    if not await check_bot_enabled(interaction):
        return

    if interaction.guild_id is None:
        await interaction.response.send_message("This command only works in servers.", ephemeral=True)
        return

    if target.bot:
        await interaction.response.send_message("Pick a real user. Bots cannot receive paranoia rounds.", ephemeral=True)
        return

    if target.id == interaction.user.id:
        await interaction.response.send_message("Pick someone else for paranoia. You cannot target yourself.", ephemeral=True)
        return

    await interaction.response.defer(ephemeral=True)
    prompt = await bot.prompt_engine.get_next_prompt(
        requested_game="paranoia",
        channel_id=interaction.channel_id or 0,
        guild_id=interaction.guild_id,
        requester_tag=str(interaction.user),
        rating=rating.value if rating else None,
    )
    round_id = short_id("paranoia")
    round_data = ParanoiaRound(
        round_id=round_id,
        guild_id=interaction.guild_id,
        guild_name=interaction.guild.name if interaction.guild else "Unknown Server",
        channel_id=interaction.channel_id or 0,
        channel_name=getattr(interaction.channel, "name", "unknown-channel"),
        requester_id=interaction.user.id,
        requester_name=getattr(interaction.user, "global_name", None) or interaction.user.name,
        requester_avatar_url=interaction.user.display_avatar.url if interaction.user.display_avatar else None,
        target_user_id=target.id,
        prompt=prompt,
    )
    paranoia_rounds[round_id] = round_data

    try:
        dm_message = await target.send(
            content=build_paranoia_jump_url(round_data),
            view=ParanoiaAnswerView(bot, round_id),
        )
    except discord.HTTPException:
        paranoia_rounds.pop(round_id, None)
        await interaction.followup.send(embed=build_paranoia_failure_embed(), ephemeral=True)
        return

    round_data.dm_channel_id = dm_message.channel.id
    round_data.dm_message_id = dm_message.id
    public_channel = interaction.channel
    if public_channel is not None and isinstance(public_channel, (discord.TextChannel, discord.Thread)):
        ack_message = await public_channel.send(view=build_paranoia_launch_view(round_data))
        round_data.ack_message_id = ack_message.id

    await interaction.followup.send(
        content="🫢 Paranoia sent. The public card was posted without your name.",
        ephemeral=True,
    )


@bot.tree.command(name="todstats", description="Show prompt pool size and anti-repeat status.")
async def tod_stats(interaction: discord.Interaction) -> None:
    if not await check_bot_enabled(interaction):
        return

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


async def safe_delete_message(message: discord.Message) -> None:
    try:
        await message.delete()
    except discord.HTTPException:
        pass


def parse_scope(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip().lower()
    if normalized in {"channel", "server"}:
        return normalized
    return None


def build_admin_help_embed() -> discord.Embed:
    embed = discord.Embed(
        title="Admin controls",
        description="These controls auto-hide in chat and work only for server admins.",
        color=0x5865F2,
    )
    embed.add_field(
        name="<adminhelp",
        value="Show this admin help panel.",
        inline=False,
    )
    embed.add_field(
        name="<disableall channel | server",
        value="Disable the bot in the current channel or entire server.",
        inline=False,
    )
    embed.add_field(
        name="<enableall channel | server",
        value="Re-enable the bot in the current channel or entire server.",
        inline=False,
    )
    embed.add_field(
        name="<adminstatus",
        value="Show current disable state and prompt totals.",
        inline=False,
    )
    embed.set_footer(text="Use in a server where you have Manage Server.")
    return embed


def build_dev_help_embed() -> discord.Embed:
    embed = discord.Embed(
        title="Developer controls",
        description="Hidden developer controls for runtime, prompt packs, and sync.",
        color=0xF1C40F,
    )
    lines = [
        "<<devhelp",
        "<<devstatus",
        "<<disableall channel | server",
        "<<enableall channel | server",
        "<<reloadprompts",
        "<<clearhistory channel | server",
        f"<<fillparanoia [3-{AI_PARANOIA_BATCH_SIZE if AI_PARANOIA_BATCH_SIZE > 3 else 12}]",
        "<<sync guild | global",
    ]
    embed.add_field(name="Commands", value="\n".join(f"`{line}`" for line in lines), inline=False)
    embed.add_field(
        name="Notes",
        value="Use `<<` only. Replies auto-hide in chat and are locked to your user ID.",
        inline=False,
    )
    embed.set_footer(text="Developer locked to your user ID.")
    return embed


async def send_hidden_control_response(
    ctx: commands.Context[Any],
    *,
    embed: discord.Embed | None = None,
    content: str | None = None,
    ttl: int = CONTROL_REPLY_TTL_SECONDS,
) -> None:
    await safe_delete_message(ctx.message)
    kwargs: dict[str, Any] = {
        "delete_after": ttl,
        "allowed_mentions": discord.AllowedMentions.none(),
    }
    if embed is not None:
        kwargs["embed"] = embed
    if content is not None:
        kwargs["content"] = content
    try:
        await ctx.channel.send(**kwargs)
    except discord.HTTPException:
        pass


async def ensure_admin_ctx(ctx: commands.Context[Any]) -> bool:
    if ctx.guild is None:
        await send_hidden_control_response(ctx, content="This command only works in servers.")
        return False
    member = ctx.author if isinstance(ctx.author, discord.Member) else None
    if member is None or not member.guild_permissions.manage_guild:
        await send_hidden_control_response(ctx, content="You need Manage Server to use this.")
        return False
    return True


async def ensure_dev_ctx(ctx: commands.Context[Any]) -> bool:
    if not bot.is_developer_user(ctx.author.id):
        await send_hidden_control_response(ctx, content="Developer-only command.")
        return False
    return True


@bot.command(name="adminhelp")
async def prefix_adminhelp(ctx: commands.Context[Any]) -> None:
    if ctx.prefix != "<":
        return
    if not await ensure_admin_ctx(ctx):
        return
    await send_hidden_control_response(ctx, embed=build_admin_help_embed())


@bot.command(name="disableall")
async def prefix_disableall(ctx: commands.Context[Any], scope: str | None = None) -> None:
    if ctx.prefix == "<<":
        if not await ensure_dev_ctx(ctx):
            return
    else:
        if not await ensure_admin_ctx(ctx):
            return

    parsed_scope = parse_scope(scope)
    if parsed_scope is None:
        await send_hidden_control_response(ctx, content="Use `<disableall channel` or `<disableall server`.")
        return

    if ctx.guild is None:
        await send_hidden_control_response(ctx, content="This command only works in servers.")
        return

    if parsed_scope == "server":
        bot.runtime_settings.disabled_guilds.add(ctx.guild.id)
    else:
        bot.runtime_settings.disabled_channels.add(ctx.channel.id)
    save_runtime_settings(bot.runtime_settings)
    await send_hidden_control_response(
        ctx,
        embed=discord.Embed(
            title="Bot disabled",
            description=f"Disabled in **{'this server' if parsed_scope == 'server' else 'this channel'}**.",
            color=0xED4245,
        ),
    )


@bot.command(name="enableall")
async def prefix_enableall(ctx: commands.Context[Any], scope: str | None = None) -> None:
    if ctx.prefix == "<<":
        if not await ensure_dev_ctx(ctx):
            return
    else:
        if not await ensure_admin_ctx(ctx):
            return

    parsed_scope = parse_scope(scope)
    if parsed_scope is None:
        await send_hidden_control_response(ctx, content="Use `<enableall channel` or `<enableall server`.")
        return

    if ctx.guild is None:
        await send_hidden_control_response(ctx, content="This command only works in servers.")
        return

    if parsed_scope == "server":
        bot.runtime_settings.disabled_guilds.discard(ctx.guild.id)
    else:
        bot.runtime_settings.disabled_channels.discard(ctx.channel.id)
    save_runtime_settings(bot.runtime_settings)
    await send_hidden_control_response(
        ctx,
        embed=discord.Embed(
            title="Bot enabled",
            description=f"Enabled in **{'this server' if parsed_scope == 'server' else 'this channel'}**.",
            color=0x57F287,
        ),
    )


@bot.command(name="adminstatus")
async def prefix_adminstatus(ctx: commands.Context[Any]) -> None:
    if ctx.prefix != "<":
        return
    if not await ensure_admin_ctx(ctx):
        return
    fake_interaction = type("StatusCtx", (), {"guild_id": ctx.guild.id if ctx.guild else None, "channel_id": ctx.channel.id})()
    await send_hidden_control_response(ctx, embed=build_control_status_embed(bot, fake_interaction))


@bot.command(name="devhelp")
async def prefix_devhelp(ctx: commands.Context[Any]) -> None:
    if ctx.prefix != "<<":
        return
    if not await ensure_dev_ctx(ctx):
        return
    await send_hidden_control_response(ctx, embed=build_dev_help_embed())


@bot.command(name="devstatus")
async def prefix_devstatus(ctx: commands.Context[Any]) -> None:
    if ctx.prefix != "<<":
        return
    if not await ensure_dev_ctx(ctx):
        return
    fake_interaction = type("StatusCtx", (), {"guild_id": ctx.guild.id if ctx.guild else None, "channel_id": ctx.channel.id})()
    await send_hidden_control_response(ctx, embed=build_control_status_embed(bot, fake_interaction))


@bot.command(name="reloadprompts")
async def prefix_reloadprompts(ctx: commands.Context[Any]) -> None:
    if ctx.prefix != "<<":
        return
    if not await ensure_dev_ctx(ctx):
        return
    bot.reload_prompt_engine()
    await send_hidden_control_response(
        ctx,
        embed=discord.Embed(title="Prompt packs reloaded", color=0x57F287),
    )


@bot.command(name="clearhistory")
async def prefix_clearhistory(ctx: commands.Context[Any], scope: str | None = None) -> None:
    if ctx.prefix != "<<":
        return
    if not await ensure_dev_ctx(ctx):
        return
    parsed_scope = parse_scope(scope)
    if parsed_scope is None:
        await send_hidden_control_response(ctx, content="Use `<<clearhistory channel` or `<<clearhistory server`.")
        return
    if parsed_scope == "server":
        bot.prompt_engine.clear_history(guild_id=ctx.guild.id if ctx.guild else None)
    else:
        bot.prompt_engine.clear_history(channel_id=ctx.channel.id)
    await send_hidden_control_response(
        ctx,
        embed=discord.Embed(
            title="History cleared",
            description=f"Cleared **{parsed_scope}** repeat memory.",
            color=0x57F287,
        ),
    )


@bot.command(name="fillparanoia")
async def prefix_fillparanoia(ctx: commands.Context[Any], batch_size: str | None = None) -> None:
    if ctx.prefix != "<<":
        return
    if not await ensure_dev_ctx(ctx):
        return
    size = AI_PARANOIA_BATCH_SIZE
    if batch_size and batch_size.isdigit():
        size = max(3, min(12, int(batch_size)))
    added = await bot.refresh_ai_paranoia_cache(batch_size=size)
    await send_hidden_control_response(
        ctx,
        embed=discord.Embed(
            title="AI paranoia refresh done",
            description=f"Added **{added}** prompts.",
            color=0x57F287,
        ),
    )


@bot.command(name="sync")
async def prefix_sync(ctx: commands.Context[Any], scope: str | None = None) -> None:
    if ctx.prefix != "<<":
        return
    if not await ensure_dev_ctx(ctx):
        return
    normalized = (scope or "guild").strip().lower()
    guild_only = normalized != "global"
    sync_scope = await bot.sync_command_tree(guild_only=guild_only)
    await send_hidden_control_response(
        ctx,
        embed=discord.Embed(
            title="Command sync complete",
            description=f"Synced using **{sync_scope}** scope.",
            color=0x57F287,
        ),
    )


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
