import json
import os
import random
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT_DIR = Path(__file__).resolve().parent
DATA_DIR = ROOT_DIR / "data"
WEB_DIR = ROOT_DIR / "web"
STATE_FILE = DATA_DIR / "render_runtime_state.json"
STATUS_FILE = DATA_DIR / "runtime_status.json"
PROMPT_POOL_FILE = DATA_DIR / "prompt_pools.json"
CORE_PROMPT_FILE = DATA_DIR / "core_prompt_catalog.json"
BOT_ENTRY = ROOT_DIR / "truth_dare_bot.py"
STARTED_AT = time.monotonic()
DEFAULT_SUPPORT_URL = "https://discord.gg/4fGf87kGhU"
DEFAULT_GITHUB_URL = "https://github.com/creedincdev-op/truth-dare-bot"
PAGE_ROUTES = {
    "/": WEB_DIR / "index.html",
    "/index.html": WEB_DIR / "index.html",
    "/features": WEB_DIR / "features.html",
    "/features.html": WEB_DIR / "features.html",
    "/docs": WEB_DIR / "docs.html",
    "/docs.html": WEB_DIR / "docs.html",
    "/developer": WEB_DIR / "developer.html",
    "/developer.html": WEB_DIR / "developer.html",
    "/faq": WEB_DIR / "faq.html",
    "/faq.html": WEB_DIR / "faq.html",
    "/support": WEB_DIR / "support.html",
    "/support.html": WEB_DIR / "support.html",
    "/privacy": WEB_DIR / "privacy.html",
    "/privacy.html": WEB_DIR / "privacy.html",
    "/terms": WEB_DIR / "terms.html",
    "/terms.html": WEB_DIR / "terms.html",
    "/license": WEB_DIR / "license.html",
    "/license.html": WEB_DIR / "license.html",
}
ASSET_ROUTES = {
    "/site-config.js": (WEB_DIR / "site-config.js", "application/javascript; charset=utf-8"),
    "/brand-logo.svg": (WEB_DIR / "brand-logo.svg", "image/svg+xml"),
    "/brand-banner.svg": (WEB_DIR / "brand-banner.svg", "image/svg+xml"),
    "/landing.css": (WEB_DIR / "landing.css", "text/css; charset=utf-8"),
    "/landing.js": (WEB_DIR / "landing.js", "application/javascript; charset=utf-8"),
    "/assets/site-config.js": (WEB_DIR / "site-config.js", "application/javascript; charset=utf-8"),
    "/assets/brand-logo.svg": (WEB_DIR / "brand-logo.svg", "image/svg+xml"),
    "/assets/brand-banner.svg": (WEB_DIR / "brand-banner.svg", "image/svg+xml"),
    "/assets/landing.css": (WEB_DIR / "landing.css", "text/css; charset=utf-8"),
    "/assets/landing.js": (WEB_DIR / "landing.js", "application/javascript; charset=utf-8"),
}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_env(name: str, fallback: str = "") -> str:
    value = os.getenv(name, "")
    if not isinstance(value, str):
        return fallback
    normalized = value.strip().strip("\"'")
    return normalized or fallback


def read_int_env(name: str, fallback: int, minimum: int = 0) -> int:
    raw = read_env(name)
    try:
        value = int(raw) if raw else fallback
    except ValueError:
        value = fallback
    return max(minimum, value)


def load_runtime_state(initial_backoff_seconds: int) -> dict[str, float | int]:
    if not STATE_FILE.exists():
        return {
            "backoff_seconds": initial_backoff_seconds,
            "rapid_failures": 0,
            "next_start_after": 0.0,
        }

    try:
        payload = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        payload = {}

    return {
        "backoff_seconds": max(initial_backoff_seconds, int(payload.get("backoff_seconds", initial_backoff_seconds))),
        "rapid_failures": max(0, int(payload.get("rapid_failures", 0))),
        "next_start_after": max(0.0, float(payload.get("next_start_after", 0.0))),
    }


def save_runtime_state(runtime_state: dict[str, float | int]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(runtime_state, indent=2), encoding="utf-8")


def sleep_with_stop(stop_state: dict[str, object], seconds: int | float) -> None:
    deadline = time.monotonic() + max(0.0, float(seconds))
    while not stop_state["stop"]:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return
        time.sleep(min(5.0, remaining))


def read_bot_status(supervisor_state: dict[str, object]) -> dict[str, object]:
    payload: dict[str, object] = {
        "discordReady": False,
        "botUser": None,
        "phase": str(supervisor_state.get("phase") or "booting"),
        "lastError": supervisor_state.get("last_error"),
        "loginStartedAt": supervisor_state.get("login_started_at"),
    }

    if STATUS_FILE.exists():
        try:
            file_payload = json.loads(STATUS_FILE.read_text(encoding="utf-8"))
            if isinstance(file_payload, dict):
                payload.update(file_payload)
        except (OSError, json.JSONDecodeError):
            payload["lastError"] = "Failed to read runtime status file"

    child_running = bool(supervisor_state.get("proc") is not None)
    if not child_running:
        payload["discordReady"] = False
        payload["botUser"] = None
        payload["phase"] = str(supervisor_state.get("phase") or payload.get("phase") or "booting")
        if supervisor_state.get("last_error"):
            payload["lastError"] = supervisor_state.get("last_error")

    payload["childRunning"] = child_running
    payload["childPid"] = supervisor_state.get("child_pid")
    payload["supervisorPhase"] = supervisor_state.get("phase")
    payload["reconnectAt"] = supervisor_state.get("reconnect_at")
    payload["uptimeSeconds"] = int(time.monotonic() - STARTED_AT)
    payload["checkedAt"] = utc_now_iso()
    return payload


def sanitize_prompt(text: object) -> str:
    return " ".join(str(text or "").split()).strip()


def pick_spaced_samples(items: list[str], count: int) -> list[str]:
    if count <= 0 or not items:
        return []
    if len(items) <= count:
        return items[:]

    step = len(items) / count
    samples = []
    for index in range(count):
        sample_index = min(len(items) - 1, int(index * step + (step / 3)))
        samples.append(items[sample_index])
    return samples


def load_prompt_pool_summary() -> dict[str, object]:
    if CORE_PROMPT_FILE.exists():
        try:
            payload = json.loads(CORE_PROMPT_FILE.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, FileNotFoundError):
            payload = {}

        prompts = payload.get("prompts", [])
        truth_pool = [sanitize_prompt(entry.get("text")) for entry in prompts if sanitize_prompt(entry.get("text")) and entry.get("game") == "truth"]
        dare_pool = [sanitize_prompt(entry.get("text")) for entry in prompts if sanitize_prompt(entry.get("text")) and entry.get("game") == "dare"]
        nhie_total = sum(1 for entry in prompts if entry.get("game") == "never_have_i_ever")
        paranoia_total = sum(1 for entry in prompts if entry.get("game") == "paranoia")

        samples: list[dict[str, str]] = []
        truth_samples = pick_spaced_samples(truth_pool, 3)
        dare_samples = pick_spaced_samples(dare_pool, 3)
        for index in range(max(len(truth_samples), len(dare_samples))):
            if index < len(truth_samples):
                samples.append({"type": "truth", "text": truth_samples[index]})
            if index < len(dare_samples):
                samples.append({"type": "dare", "text": dare_samples[index]})

        return {
            "truth": len(truth_pool),
            "dare": len(dare_pool),
            "nhie": nhie_total,
            "paranoia": paranoia_total,
            "total": len(prompts),
            "samples": samples,
        }

    try:
        payload = json.loads(PROMPT_POOL_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, FileNotFoundError):
        payload = {}

    truth_pool = [sanitize_prompt(entry) for entry in payload.get("truthPool", []) if sanitize_prompt(entry)]
    dare_pool = [sanitize_prompt(entry) for entry in payload.get("darePool", []) if sanitize_prompt(entry)]

    samples: list[dict[str, str]] = []
    truth_samples = pick_spaced_samples(truth_pool, 4)
    dare_samples = pick_spaced_samples(dare_pool, 4)
    for index in range(max(len(truth_samples), len(dare_samples))):
        if index < len(truth_samples):
            samples.append({"type": "truth", "text": truth_samples[index]})
        if index < len(dare_samples):
            samples.append({"type": "dare", "text": dare_samples[index]})

    return {
        "truth": len(truth_pool),
        "dare": len(dare_pool),
        "nhie": 0,
        "paranoia": 0,
        "total": len(truth_pool) + len(dare_pool),
        "samples": samples,
    }


def build_invite_url() -> str | None:
    client_id = read_env("DISCORD_CLIENT_ID", "")
    if not client_id:
        return None
    return (
        "https://discord.com/oauth2/authorize"
        f"?client_id={client_id}&scope=bot%20applications.commands"
    )


def build_support_url() -> str:
    return read_env("SUPPORT_SERVER_URL", DEFAULT_SUPPORT_URL)


def build_github_url() -> str:
    return read_env("GITHUB_REPO_URL", DEFAULT_GITHUB_URL)


def build_site_payload(supervisor_state: dict[str, object]) -> dict[str, object]:
    prompt_summary = load_prompt_pool_summary()
    client_id = read_env("DISCORD_CLIENT_ID", "") or None
    return {
        "brand": "Truth OR Dare",
        "counts": {
            "truth": prompt_summary["truth"],
            "dare": prompt_summary["dare"],
            "nhie": prompt_summary["nhie"],
            "paranoia": prompt_summary["paranoia"],
            "total": prompt_summary["total"],
        },
        "samples": prompt_summary["samples"],
        "historyLimit": 180,
        "aiEnabled": bool(read_env("OPENAI_API_KEY", "")),
        "inviteUrl": build_invite_url(),
        "supportUrl": build_support_url(),
        "githubUrl": build_github_url(),
        "clientId": client_id,
        "commands": [
            {
                "name": "/truthordare",
                "detail": "Launch the main Truth or Dare flow with random, truth, or dare prompts.",
            },
            {
                "name": "/truth",
                "detail": "Get a truth-only prompt instantly.",
            },
            {
                "name": "/dare",
                "detail": "Get a dare-only prompt instantly.",
            },
            {
                "name": "/neverever",
                "detail": "Play Never Have I Ever with the same anti-repeat catalog.",
            },
            {
                "name": "/paranoia",
                "detail": "Send a private paranoia prompt and reveal the answer anonymously.",
            },
            {
                "name": "/todstats",
                "detail": "Check live pool size and anti-repeat behavior.",
            },
        ],
        "useCases": [
            "Late-night voice chats",
            "Server icebreakers",
            "Chaotic friend groups",
            "Clean flirt rounds",
            "Streaming room filler",
            "Party game resets",
        ],
        "status": read_bot_status(supervisor_state),
    }


class HealthHandler(BaseHTTPRequestHandler):
    supervisor_state: dict[str, object] = {}

    def _send_bytes(
        self,
        body: bytes,
        *,
        content_type: str,
        status_code: int = 200,
        include_body: bool = True,
    ) -> None:
        self.send_response(status_code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if include_body:
            self.wfile.write(body)

    def _send_json(self, payload: dict[str, object], status_code: int = 200, include_body: bool = True) -> None:
        body = json.dumps(payload).encode("utf-8")
        self._send_bytes(body, content_type="application/json", status_code=status_code, include_body=include_body)

    def _send_text(self, text: str, *, content_type: str, status_code: int = 200, include_body: bool = True) -> None:
        self._send_bytes(
            text.encode("utf-8"),
            content_type=content_type,
            status_code=status_code,
            include_body=include_body,
        )

    def _serve_asset(self, path: Path, content_type: str, include_body: bool) -> None:
        try:
            body = path.read_bytes()
        except OSError:
            self._send_text(
                "Not found",
                content_type="text/plain; charset=utf-8",
                status_code=404,
                include_body=include_body,
            )
            return

        self._send_bytes(body, content_type=content_type, include_body=include_body)

    def _handle(self, include_body: bool) -> None:
        request_path = urlparse(self.path).path

        if request_path in ("/healthz", "/ping"):
            self._send_json(
                {
                    "ok": True,
                    "phase": str(self.supervisor_state.get("phase") or "booting"),
                    "uptimeSeconds": int(time.monotonic() - STARTED_AT),
                },
                include_body=include_body,
            )
            return

        if request_path == "/site-data":
            self._send_json(build_site_payload(self.supervisor_state), include_body=include_body)
            return

        if request_path in PAGE_ROUTES:
            self._serve_asset(PAGE_ROUTES[request_path], "text/html; charset=utf-8", include_body)
            return

        if request_path in ASSET_ROUTES:
            asset_path, content_type = ASSET_ROUTES[request_path]
            self._serve_asset(asset_path, content_type, include_body)
            return

        if request_path in ("/health", "/readyz"):
            payload = read_bot_status(self.supervisor_state)
            status_code = 200 if payload.get("discordReady") else 503
            self._send_json(payload, status_code=status_code, include_body=include_body)
            return

        self._send_text(
            "Not found",
            content_type="text/plain; charset=utf-8",
            status_code=404,
            include_body=include_body,
        )

    def do_GET(self) -> None:
        self._handle(include_body=True)

    def do_HEAD(self) -> None:
        self._handle(include_body=False)

    def log_message(self, format: str, *args) -> None:
        return


def run_health_server(port: int, supervisor_state: dict[str, object]) -> ThreadingHTTPServer:
    HealthHandler.supervisor_state = supervisor_state
    server = ThreadingHTTPServer(("0.0.0.0", port), HealthHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def main() -> int:
    if not BOT_ENTRY.exists():
        raise RuntimeError(f"Bot entry file not found: {BOT_ENTRY}")

    if not os.getenv("BOT_TOKEN") and read_env("DISCORD_TOKEN"):
        os.environ["BOT_TOKEN"] = read_env("DISCORD_TOKEN")

    port = read_int_env("PORT", 10000, 1)
    initial_backoff_seconds = read_int_env("BOT_RESTART_BACKOFF_INITIAL", 900, 60)
    max_backoff_seconds = read_int_env("BOT_RESTART_BACKOFF_MAX", 7200, initial_backoff_seconds)
    rapid_exit_threshold_seconds = read_int_env("BOT_RAPID_EXIT_SECONDS", 180, 30)
    startup_jitter_max_seconds = read_int_env("BOT_STARTUP_JITTER_MAX", 45, 0)
    runtime_state = load_runtime_state(initial_backoff_seconds)

    supervisor_state: dict[str, object] = {
        "stop": False,
        "proc": None,
        "phase": "booting",
        "last_error": None,
        "login_started_at": None,
        "child_pid": None,
        "reconnect_at": None,
    }
    server = run_health_server(port, supervisor_state)

    def shutdown_handler(signum, frame) -> None:
        supervisor_state["stop"] = True
        proc = supervisor_state.get("proc")
        if isinstance(proc, subprocess.Popen) and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                proc.kill()
        server.shutdown()

    signal.signal(signal.SIGTERM, shutdown_handler)
    signal.signal(signal.SIGINT, shutdown_handler)

    if startup_jitter_max_seconds > 0:
        initial_delay = random.randint(0, startup_jitter_max_seconds)
        if initial_delay > 0:
            supervisor_state["phase"] = "startup_jitter"
            supervisor_state["reconnect_at"] = datetime.fromtimestamp(
                time.time() + initial_delay, tz=timezone.utc
            ).isoformat()
            print(f"Applying startup jitter of {initial_delay} seconds before first bot launch.")
            sleep_with_stop(supervisor_state, initial_delay)

    while not supervisor_state["stop"]:
        now = time.time()
        next_start_after = float(runtime_state.get("next_start_after", 0.0))
        if next_start_after > now:
            wait_for = int(next_start_after - now)
            supervisor_state["phase"] = "cooldown"
            supervisor_state["reconnect_at"] = datetime.fromtimestamp(next_start_after, tz=timezone.utc).isoformat()
            print(f"Cooling down for {wait_for} seconds before next bot launch.")
            sleep_with_stop(supervisor_state, wait_for)
            if supervisor_state["stop"]:
                break

        supervisor_state["phase"] = "starting_child"
        supervisor_state["last_error"] = None
        supervisor_state["login_started_at"] = utc_now_iso()
        supervisor_state["reconnect_at"] = None
        try:
            STATUS_FILE.unlink(missing_ok=True)
        except OSError:
            pass

        proc = subprocess.Popen(
            [sys.executable, str(BOT_ENTRY.name)],
            cwd=str(ROOT_DIR),
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
        )
        supervisor_state["proc"] = proc
        supervisor_state["child_pid"] = proc.pid

        started_at = time.monotonic()
        code = proc.wait()
        runtime_seconds = int(time.monotonic() - started_at)
        supervisor_state["proc"] = None
        supervisor_state["child_pid"] = None

        if supervisor_state["stop"]:
            break

        if runtime_seconds >= rapid_exit_threshold_seconds:
            runtime_state["rapid_failures"] = 0
            runtime_state["backoff_seconds"] = initial_backoff_seconds
        else:
            runtime_state["rapid_failures"] = int(runtime_state.get("rapid_failures", 0)) + 1
            runtime_state["backoff_seconds"] = min(
                max(initial_backoff_seconds, int(runtime_state["backoff_seconds"]) * 2),
                max_backoff_seconds,
            )

        current_backoff = int(runtime_state["backoff_seconds"])
        jitter = random.randint(0, max(15, current_backoff // 5))
        delay = min(current_backoff + jitter, max_backoff_seconds)
        runtime_state["next_start_after"] = time.time() + delay
        save_runtime_state(runtime_state)

        supervisor_state["phase"] = "cooldown"
        supervisor_state["last_error"] = (
            f"Bot process exited with code {code}. Runtime was {runtime_seconds} seconds."
        )
        supervisor_state["reconnect_at"] = datetime.fromtimestamp(
            float(runtime_state["next_start_after"]), tz=timezone.utc
        ).isoformat()

        print(
            f"Bot process exited with code {code}. "
            f"Runtime was {runtime_seconds} seconds. "
            f"Restarting in {delay} seconds..."
        )
        sleep_with_stop(supervisor_state, delay)

    server.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
