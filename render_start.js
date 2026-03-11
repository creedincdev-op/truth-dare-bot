const fs = require("fs");
const http = require("http");
const path = require("path");
const { fork } = require("child_process");

const ROOT_DIR = __dirname;
const BOT_ENTRY = path.join(ROOT_DIR, "src", "bot.js");
const STATE_FILE = path.join(ROOT_DIR, "data", "render_runtime_state.json");

function readEnv(name, fallback = "") {
  const value = process.env[name];

  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().replace(/^['"]+|['"]+$/g, "");
  return normalized || fallback;
}

function readIntEnv(name, fallback, minimum = null) {
  const raw = readEnv(name);
  const parsed = raw ? Number(raw) : fallback;
  let value = Number.isFinite(parsed) ? parsed : fallback;

  if (minimum !== null) {
    value = Math.max(minimum, value);
  }

  return Math.floor(value);
}

function loadRuntimeState(initialBackoffSeconds) {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return {
        backoffSeconds: initialBackoffSeconds,
        rapidFailures: 0,
        nextStartAfter: 0,
      };
    }

    const payload = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return {
      backoffSeconds: Math.max(initialBackoffSeconds, Number(payload.backoffSeconds) || initialBackoffSeconds),
      rapidFailures: Math.max(0, Number(payload.rapidFailures) || 0),
      nextStartAfter: Math.max(0, Number(payload.nextStartAfter) || 0),
    };
  } catch {
    return {
      backoffSeconds: initialBackoffSeconds,
      rapidFailures: 0,
      nextStartAfter: 0,
    };
  }
}

function saveRuntimeState(runtimeState) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(runtimeState, null, 2));
}

const port = readIntEnv("PORT", 10000, 1);
const initialBackoffSeconds = readIntEnv("BOT_RESTART_BACKOFF_INITIAL", 900, 60);
const maxBackoffSeconds = readIntEnv("BOT_RESTART_BACKOFF_MAX", 7200, initialBackoffSeconds);
const rapidExitThresholdSeconds = readIntEnv("BOT_RAPID_EXIT_SECONDS", 180, 30);
const startupJitterMaxSeconds = readIntEnv("BOT_STARTUP_JITTER_MAX", 45, 0);

const runtimeState = {
  discordReady: false,
  botUser: null,
  phase: "booting",
  lastError: null,
  loginStartedAt: null,
  reconnectAt: null,
  startAttempts: 0,
  childRunning: false,
  childPid: null,
  childStartedAt: null,
};

const persistedState = loadRuntimeState(initialBackoffSeconds);

let child = null;
let stopRequested = false;
let launchTimer = null;

if (!process.env.DISCORD_TOKEN && process.env.BOT_TOKEN) {
  process.env.DISCORD_TOKEN = readEnv("BOT_TOKEN");
}

if (process.env.DISCORD_CLIENT_ID) {
  process.env.DISCORD_CLIENT_ID = readEnv("DISCORD_CLIENT_ID");
}

function uptimeSeconds() {
  return Math.floor(process.uptime());
}

function clearLaunchTimer() {
  if (launchTimer) {
    clearTimeout(launchTimer);
    launchTimer = null;
  }

  runtimeState.reconnectAt = null;
}

function createPayload() {
  return {
    ...runtimeState,
    uptimeSeconds: uptimeSeconds(),
  };
}

function updateFromChild(message) {
  if (!message || message.type !== "status") {
    return;
  }

  runtimeState.phase = message.phase || runtimeState.phase;
  runtimeState.lastError = message.lastError ?? runtimeState.lastError;
  runtimeState.loginStartedAt = message.loginStartedAt || runtimeState.loginStartedAt;
  runtimeState.discordReady = Boolean(message.discordReady);
  runtimeState.botUser = message.botUser || null;

  if (runtimeState.discordReady) {
    persistedState.backoffSeconds = initialBackoffSeconds;
    persistedState.rapidFailures = 0;
    persistedState.nextStartAfter = 0;
    saveRuntimeState(persistedState);
  }
}

function scheduleLaunch(delaySeconds, reason) {
  clearLaunchTimer();

  if (stopRequested) {
    return;
  }

  const delayMs = Math.max(0, delaySeconds * 1000);
  runtimeState.phase = "cooldown";
  runtimeState.lastError = reason;
  runtimeState.discordReady = false;
  runtimeState.botUser = null;
  runtimeState.reconnectAt = new Date(Date.now() + delayMs).toISOString();

  console.error(`${reason}. Launching Discord child in ${Math.round(delayMs / 1000)}s.`);

  launchTimer = setTimeout(() => {
    clearLaunchTimer();
    launchChild();
  }, delayMs);
}

function launchChild() {
  if (stopRequested || child) {
    return;
  }

  clearLaunchTimer();
  runtimeState.phase = "starting_child";
  runtimeState.lastError = null;
  runtimeState.loginStartedAt = new Date().toISOString();
  runtimeState.discordReady = false;
  runtimeState.botUser = null;
  runtimeState.startAttempts += 1;

  child = fork(BOT_ENTRY, {
    cwd: ROOT_DIR,
    env: { ...process.env },
    stdio: ["inherit", "inherit", "inherit", "ipc"],
  });

  runtimeState.childRunning = true;
  runtimeState.childPid = child.pid;
  runtimeState.childStartedAt = new Date().toISOString();

  child.on("message", updateFromChild);

  child.once("exit", (code, signal) => {
    const startedAt = runtimeState.childStartedAt ? Date.parse(runtimeState.childStartedAt) : Date.now();
    const runtimeSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));

    runtimeState.childRunning = false;
    runtimeState.childPid = null;
    runtimeState.childStartedAt = null;
    runtimeState.discordReady = false;
    runtimeState.botUser = null;
    child = null;

    if (stopRequested) {
      return;
    }

    if (runtimeSeconds >= rapidExitThresholdSeconds) {
      persistedState.rapidFailures = 0;
      persistedState.backoffSeconds = initialBackoffSeconds;
    } else {
      persistedState.rapidFailures += 1;
      persistedState.backoffSeconds = Math.min(
        Math.max(initialBackoffSeconds, persistedState.backoffSeconds * 2),
        maxBackoffSeconds,
      );
    }

    const currentBackoffSeconds = persistedState.backoffSeconds;
    const jitterSeconds = Math.floor(Math.random() * Math.max(15, Math.floor(currentBackoffSeconds / 5)));
    const delaySeconds = Math.min(currentBackoffSeconds + jitterSeconds, maxBackoffSeconds);
    const reason = `Discord child exited with code ${code ?? "null"}${signal ? ` and signal ${signal}` : ""} after ${runtimeSeconds}s`;

    persistedState.nextStartAfter = Date.now() + (delaySeconds * 1000);
    saveRuntimeState(persistedState);
    scheduleLaunch(delaySeconds, reason);
  });
}

const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/healthz" || req.url === "/ping") {
    const body = JSON.stringify({ ok: true, phase: runtimeState.phase, uptimeSeconds: uptimeSeconds() });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(body);
    return;
  }

  if (req.url === "/health" || req.url === "/readyz") {
    const body = JSON.stringify(createPayload());
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(body);
    return;
  }

  const body = JSON.stringify(createPayload());
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(body);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Health server listening on ${port}`);
});

function shutdown() {
  stopRequested = true;
  clearLaunchTimer();

  if (child) {
    child.kill("SIGTERM");
  }

  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

const now = Date.now();
if (persistedState.nextStartAfter > now) {
  const delaySeconds = Math.floor((persistedState.nextStartAfter - now) / 1000);
  scheduleLaunch(delaySeconds, `Cooling down from previous child exit`);
} else if (startupJitterMaxSeconds > 0) {
  const delaySeconds = Math.floor(Math.random() * startupJitterMaxSeconds);
  scheduleLaunch(delaySeconds, "Applying startup jitter");
} else {
  launchChild();
}
