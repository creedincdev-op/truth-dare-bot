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


ROOT_DIR = Path(__file__).resolve().parent
DATA_DIR = ROOT_DIR / "data"
STATE_FILE = DATA_DIR / "render_runtime_state.json"
STATUS_FILE = DATA_DIR / "runtime_status.json"
BOT_ENTRY = ROOT_DIR / "truth_dare_bot.py"
STARTED_AT = time.monotonic()


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


class HealthHandler(BaseHTTPRequestHandler):
    supervisor_state: dict[str, object] = {}

    def _send_json(self, payload: dict[str, object], status_code: int = 200, include_body: bool = True) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if include_body:
            self.wfile.write(body)

    def _handle(self, include_body: bool) -> None:
        if self.path in ("/", "/healthz", "/ping"):
            self._send_json(
                {
                    "ok": True,
                    "phase": str(self.supervisor_state.get("phase") or "booting"),
                    "uptimeSeconds": int(time.monotonic() - STARTED_AT),
                },
                include_body=include_body,
            )
            return

        if self.path in ("/health", "/readyz"):
            payload = read_bot_status(self.supervisor_state)
            status_code = 200 if payload.get("discordReady") else 503
            self._send_json(payload, status_code=status_code, include_body=include_body)
            return

        self._send_json(read_bot_status(self.supervisor_state), include_body=include_body)

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
