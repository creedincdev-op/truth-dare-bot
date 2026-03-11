const { fork } = require("child_process");
const http = require("http");
const path = require("path");

const BOT_ENTRY = path.join(__dirname, "src", "bot.js");
const INITIAL_BACKOFF_MS = Number(process.env.BOT_RESTART_BACKOFF_INITIAL || 60) * 1000;
const MAX_BACKOFF_MS = Number(process.env.BOT_RESTART_BACKOFF_MAX || 900) * 1000;
const RAPID_EXIT_SECONDS = Number(process.env.BOT_RAPID_EXIT_SECONDS || 180);
const STARTUP_JITTER_MAX_SECONDS = Number(process.env.BOT_STARTUP_JITTER_MAX || 15);

const port = Number(process.env.PORT || 10000);
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

let child = null;
let stopRequested = false;
let restartTimer = null;
let currentBackoffMs = INITIAL_BACKOFF_MS;

function clearRestartTimer() {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  runtimeState.reconnectAt = null;
}

function uptimeSeconds() {
  return Math.floor(process.uptime());
}

function createPayload() {
  return {
    ...runtimeState,
    uptimeSeconds: uptimeSeconds(),
  };
}

function scheduleRestart(reason, delayMs) {
  runtimeState.phase = "discord_reconnect_wait";
  runtimeState.lastError = reason;
  runtimeState.discordReady = false;
  runtimeState.botUser = null;
  runtimeState.reconnectAt = new Date(Date.now() + delayMs).toISOString();

  if (restartTimer || stopRequested) {
    return;
  }

  console.error(`${reason}. Restarting Discord child in ${Math.round(delayMs / 1000)}s.`);
  restartTimer = setTimeout(() => {
    clearRestartTimer();
    if (!stopRequested) {
      launchChild();
    }
  }, delayMs);
}

function launchChild() {
  if (stopRequested || child) {
    return;
  }

  clearRestartTimer();
  runtimeState.startAttempts += 1;
  runtimeState.phase = "starting_child";
  runtimeState.lastError = null;
  runtimeState.loginStartedAt = new Date().toISOString();

  child = fork(BOT_ENTRY, {
    cwd: __dirname,
    env: { ...process.env },
    stdio: ["inherit", "inherit", "inherit", "ipc"],
  });

  runtimeState.childRunning = true;
  runtimeState.childPid = child.pid;
  runtimeState.childStartedAt = new Date().toISOString();

  child.on("message", (message) => {
    if (!message || message.type !== "status") {
      return;
    }

    runtimeState.phase = message.phase || runtimeState.phase;
    runtimeState.lastError = message.lastError ?? runtimeState.lastError;
    runtimeState.loginStartedAt = message.loginStartedAt || runtimeState.loginStartedAt;
    runtimeState.discordReady = Boolean(message.discordReady);
    runtimeState.botUser = message.botUser || null;

    if (runtimeState.discordReady) {
      runtimeState.reconnectAt = null;
      currentBackoffMs = INITIAL_BACKOFF_MS;
    }
  });

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

    if (runtimeSeconds >= RAPID_EXIT_SECONDS) {
      currentBackoffMs = INITIAL_BACKOFF_MS;
    } else {
      currentBackoffMs = Math.min(Math.max(INITIAL_BACKOFF_MS, currentBackoffMs * 2), MAX_BACKOFF_MS);
    }

    const jitterMs = Math.floor(Math.random() * Math.max(5000, Math.floor(currentBackoffMs / 5)));
    const delayMs = Math.min(currentBackoffMs + jitterMs, MAX_BACKOFF_MS);
    const exitReason = `Discord child exited with code ${code ?? "null"}${signal ? ` and signal ${signal}` : ""} after ${runtimeSeconds}s`;
    scheduleRestart(exitReason, delayMs);
  });
}

const server = http.createServer((req, res) => {
  if (req.url === "/ping" || req.url === "/healthz") {
    const body = JSON.stringify({ ok: true, phase: runtimeState.phase, uptimeSeconds: uptimeSeconds() });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(body);
    return;
  }

  if (req.url === "/health" || req.url === "/readyz") {
    const body = JSON.stringify(createPayload());
    res.writeHead(runtimeState.discordReady ? 200 : 503, { "Content-Type": "application/json" });
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
  clearRestartTimer();

  if (child) {
    child.kill("SIGTERM");
  }

  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

if (STARTUP_JITTER_MAX_SECONDS > 0) {
  const delayMs = Math.floor(Math.random() * (STARTUP_JITTER_MAX_SECONDS * 1000));
  runtimeState.phase = "startup_jitter";
  runtimeState.reconnectAt = new Date(Date.now() + delayMs).toISOString();
  setTimeout(() => {
    clearRestartTimer();
    launchChild();
  }, delayMs);
} else {
  launchChild();
}
