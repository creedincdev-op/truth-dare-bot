const RUNTIME_CONFIG = window.TRUTH_OR_DARE_CONFIG || {};

const DEFAULT_SITE_DATA = {
  brand: "Truth OR Dare",
  companyName: "CreeD INC. </>",
  developerName: "YUVRAJ",
  developerDiscordId: "1240237445841420302",
  counts: {
    truth: 656,
    dare: 838,
    total: 1494,
  },
  historyLimit: 180,
  inviteUrl: null,
  supportUrl: "https://discord.gg/4fGf87kGhU",
  githubUrl: "https://github.com/creedincdev-op/truth-dare-bot",
  clientId: "1480626648163549375",
  commands: [
    {
      name: "/maxplay",
      detail: "Launch the main game flow with a random, truth, or dare style round.",
    },
    {
      name: "/maxdeck",
      detail: "Browse categories and counts before you drop a round into chat.",
    },
    {
      name: "/maxsetup",
      detail: "Control defaults, timers, and server-level play settings.",
    },
    {
      name: "/maxdrops",
      detail: "Schedule daily prompt drops for your server without manual posting.",
    },
    {
      name: "/maxstats",
      detail: "Check live pool size, usage totals, and anti-repeat behavior.",
    },
  ],
  useCases: [
    "Late-night voice chats",
    "Server icebreakers",
    "Chaotic friend groups",
    "Clean flirt rounds",
    "Streaming room filler",
    "Party game resets",
  ],
  samples: [
    {
      type: "truth",
      text: "What is one confident thing that instantly gets your attention in a late-night conversation?",
    },
    {
      type: "dare",
      text: "Pretend you are a radio host and explain your worst weakness in 30 seconds.",
    },
    {
      type: "truth",
      text: "Who is your athlete crush that is not the obvious answer?",
    },
    {
      type: "dare",
      text: "Describe your vibe like a streaming-show title.",
    },
    {
      type: "truth",
      text: "Who is your athlete crush that you can defend seriously?",
    },
    {
      type: "dare",
      text: "Do a fake award speech for 20 seconds.",
    },
  ],
  status: {
    discordReady: false,
    botUser: null,
    phase: "preview",
    lastError: "Open the page through the bot server to show live status.",
    uptimeSeconds: 0,
  },
};

const state = {
  apiAvailable: false,
  samples: [],
  sampleIndex: 0,
  rotationId: null,
};

function cloneDefaultData() {
  return JSON.parse(JSON.stringify(DEFAULT_SITE_DATA));
}

function mergeSiteData(base, extra) {
  const merged = { ...base, ...(extra || {}) };
  merged.counts = { ...base.counts, ...((extra && extra.counts) || {}) };
  merged.status = { ...base.status, ...((extra && extra.status) || {}) };
  merged.commands = Array.isArray(extra && extra.commands) && extra.commands.length ? extra.commands : base.commands;
  merged.useCases = Array.isArray(extra && extra.useCases) && extra.useCases.length ? extra.useCases : base.useCases;
  merged.samples = Array.isArray(extra && extra.samples) && extra.samples.length ? extra.samples : base.samples;
  return merged;
}

function apiBaseUrl() {
  const configuredBase = String(RUNTIME_CONFIG.apiBase || "").trim().replace(/\/+$/, "");
  if (configuredBase) {
    return configuredBase;
  }

  const meta = document.querySelector('meta[name="site-api-base"]');
  const value = (meta && meta.getAttribute("content")) || "";
  return value.trim().replace(/\/+$/, "");
}

function apiUrl(path) {
  const base = apiBaseUrl();
  return base ? `${base}${path}` : path;
}

function isHttpContext() {
  return window.location.protocol === "http:" || window.location.protocol === "https:";
}

function readFallbackData() {
  const element = document.getElementById("site-fallback");
  if (!element) {
    return cloneDefaultData();
  }

  try {
    return mergeSiteData(cloneDefaultData(), JSON.parse(element.textContent || "{}"));
  } catch (error) {
    return cloneDefaultData();
  }
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}

function setHtml(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.innerHTML = value;
  }
}

function fallbackAvatarDataUri(label) {
  const monogram = String(label || "Y").trim().slice(0, 1).toUpperCase();
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
      <defs>
        <linearGradient id="g" x1="0%" x2="100%" y1="0%" y2="100%">
          <stop offset="0%" stop-color="#71f0ff" />
          <stop offset="55%" stop-color="#d4ff45" />
          <stop offset="100%" stop-color="#ff7a5c" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="124" fill="#07131b" />
      <rect x="18" y="18" width="476" height="476" rx="108" fill="url(#g)" opacity="0.18" />
      <text x="50%" y="54%" text-anchor="middle" font-size="220" font-family="Archivo Black, Arial Black, sans-serif" fill="#f7f3e8">${monogram}</text>
    </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function buildInviteUrl(clientId) {
  const normalized = String(clientId || "").trim();
  if (!normalized) {
    return null;
  }

  return (
    "https://discord.com/oauth2/authorize"
    + `?client_id=${encodeURIComponent(normalized)}&scope=bot%20applications.commands`
  );
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

function formatUptime(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds || 0));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function humanizePhase(phase) {
  return String(phase || "booting").replace(/_/g, " ");
}

function statusTone(payload) {
  if (!payload) {
    return {
      pill: "status-pill status-pill--offline",
      label: "Status unavailable",
      note: "Live status could not be loaded.",
    };
  }

  if (payload.discordReady) {
    return {
      pill: "status-pill status-pill--online",
      label: payload.botUser ? `Online as ${payload.botUser}` : "Bot online",
      note: "Supervisor is healthy and the Discord client is connected.",
    };
  }

  const phase = String(payload.phase || payload.supervisorPhase || "booting");
  if (phase.includes("cooldown") || phase.includes("rate")) {
    return {
      pill: "status-pill status-pill--warning",
      label: "Recovering",
      note: payload.lastError || "Waiting before the next reconnect attempt.",
    };
  }

  return {
    pill: "status-pill status-pill--offline",
    label: "Starting up",
    note: payload.lastError || "The bot is not ready yet.",
  };
}

function updateStatus(payload) {
  const pill = document.getElementById("status-pill");
  const tone = statusTone(payload);

  if (pill) {
    pill.className = `header-pill ${tone.pill}`;
    pill.textContent = tone.label;
  }

  setText("runtime-phase", humanizePhase(payload && (payload.phase || payload.supervisorPhase)));
  setText("runtime-user", payload && payload.botUser ? payload.botUser : "not ready");
  setText("runtime-uptime", formatUptime(payload && payload.uptimeSeconds));
  setText("status-note", tone.note);

  if (payload && !payload.discordReady && payload.reconnectAt) {
    const reconnectAt = new Date(payload.reconnectAt);
    setText("status-time", `next ${reconnectAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
  } else if (payload && payload.checkedAt) {
    const checkedAt = new Date(payload.checkedAt);
    setText("status-time", checkedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  } else {
    setText("status-time", "health feed");
  }
}

function renderUseCases(items) {
  const root = document.getElementById("use-case-list");
  if (!root || !Array.isArray(items) || items.length === 0) {
    return;
  }

  root.innerHTML = "";
  items.forEach((item) => {
    const chip = document.createElement("span");
    chip.className = "signal-chip";
    chip.textContent = item;
    root.appendChild(chip);
  });
}

function renderCommands(commands) {
  const root = document.getElementById("command-grid");
  if (!root || !Array.isArray(commands) || commands.length === 0) {
    return;
  }

  root.innerHTML = "";
  commands.forEach((command) => {
    const card = document.createElement("article");
    card.className = "command-card";

    const name = document.createElement("span");
    name.className = "command-name";
    name.textContent = command.name;

    const detail = document.createElement("p");
    detail.textContent = command.detail;

    card.append(name, detail);
    root.appendChild(card);
  });
}

function renderSamples(samples) {
  const root = document.getElementById("sample-grid");
  if (!root || !Array.isArray(samples) || samples.length === 0) {
    return;
  }

  root.innerHTML = "";
  samples.forEach((sample) => {
    const card = document.createElement("article");
    card.className = `sample-card sample-card--${sample.type === "dare" ? "dare" : "truth"}`;

    const tag = document.createElement("span");
    tag.className = "sample-tag";
    tag.textContent = sample.type === "dare" ? "Dare" : "Truth";

    const text = document.createElement("p");
    text.textContent = sample.text;

    card.append(tag, text);
    root.appendChild(card);
  });
}

function rotateStage() {
  if (!state.samples.length) {
    return;
  }

  const sample = state.samples[state.sampleIndex % state.samples.length];
  setText("stage-type", sample.type === "dare" ? "Dare" : "Truth");
  setText("stage-prompt", sample.text);
  state.sampleIndex = (state.sampleIndex + 1) % state.samples.length;
}

function startRotation(samples) {
  state.samples = Array.isArray(samples) ? samples.slice() : [];
  state.sampleIndex = 0;
  rotateStage();

  if (state.rotationId) {
    window.clearInterval(state.rotationId);
  }

  if (state.samples.length > 1) {
    state.rotationId = window.setInterval(rotateStage, 4200);
  }
}

function setLink(element, url, label, openInNewTab) {
  if (!element) {
    return;
  }

  element.href = url;
  element.textContent = label;

  if (openInNewTab) {
    element.target = "_blank";
    element.rel = "noreferrer";
    return;
  }

  element.removeAttribute("target");
  element.removeAttribute("rel");
}

function syncLinkGroup(role, options) {
  const elements = document.querySelectorAll(`[data-link-role="${role}"]`);
  elements.forEach((element) => {
    const activeLabel = element.dataset.activeLabel || options.activeLabel || element.textContent.trim();
    const fallbackLabel = element.dataset.fallbackLabel || options.fallbackLabel || element.textContent.trim();

    if (options.activeUrl) {
      setLink(element, options.activeUrl, activeLabel, Boolean(options.activeExternal));
      return;
    }

    const fallbackUrl = options.fallbackUrl || element.getAttribute("href") || "#";
    setLink(element, fallbackUrl, fallbackLabel, Boolean(options.fallbackExternal));
  });
}

function syncInviteLinks(inviteUrl, clientId) {
  const resolvedInviteUrl = inviteUrl || buildInviteUrl(clientId || RUNTIME_CONFIG.clientId || DEFAULT_SITE_DATA.clientId);
  if (resolvedInviteUrl) {
    syncLinkGroup("invite", {
      activeUrl: resolvedInviteUrl,
      activeLabel: "Add to Discord",
      activeExternal: true,
    });
    return;
  }

  if (state.apiAvailable) {
    syncLinkGroup("invite", {
      fallbackUrl: apiUrl("/health"),
      fallbackLabel: "Live Status",
      fallbackExternal: true,
    });
    return;
  }

  syncLinkGroup("invite", {
    fallbackUrl: "./docs.html",
    fallbackLabel: "See Commands",
    fallbackExternal: false,
  });
}

function syncSupportLinks(supportUrl) {
  syncLinkGroup("support", {
    activeUrl: supportUrl || RUNTIME_CONFIG.supportUrl || DEFAULT_SITE_DATA.supportUrl,
    activeLabel: "Discord",
    activeExternal: true,
  });
}

function syncGithubLinks(githubUrl) {
  syncLinkGroup("github", {
    activeUrl: githubUrl || RUNTIME_CONFIG.githubUrl || DEFAULT_SITE_DATA.githubUrl,
    activeLabel: "GitHub",
    activeExternal: true,
  });
}

function syncHealthLinks() {
  if (state.apiAvailable) {
    syncLinkGroup("health", {
      activeUrl: apiUrl("/health"),
      activeLabel: "Open live health",
      activeExternal: true,
    });
    return;
  }

  syncLinkGroup("health", {
    fallbackUrl: "./support.html",
    fallbackLabel: "Open support page",
    fallbackExternal: false,
  });
}

function syncFooterMeta(clientId) {
  const companyName = String(RUNTIME_CONFIG.companyName || DEFAULT_SITE_DATA.companyName).trim();
  const developerName = String(RUNTIME_CONFIG.developerName || DEFAULT_SITE_DATA.developerName).trim();
  setText("footer-year", String(new Date().getFullYear()));
  setText("footer-client-id", clientId ? `Client ID: ${clientId}` : `Client ID: ${RUNTIME_CONFIG.clientId || DEFAULT_SITE_DATA.clientId}`);
  document.querySelectorAll(".footer-maker").forEach((element) => {
    element.textContent = `Made by ${developerName} </>`;
  });

  document.querySelectorAll(".footer-meta").forEach((element) => {
    element.textContent = companyName;
  });

  document.querySelectorAll(".footer-bottom p:first-child").forEach((element) => {
    element.innerHTML = `Copyright &copy; <span id="footer-year">${new Date().getFullYear()}</span> ${companyName.replace(/</g, "&lt;").replace(/>/g, "&gt;")}`;
  });
}

function syncDeveloperProfile() {
  const developerName = String(RUNTIME_CONFIG.developerName || DEFAULT_SITE_DATA.developerName).trim();
  const developerDiscordId = String(RUNTIME_CONFIG.developerDiscordId || DEFAULT_SITE_DATA.developerDiscordId).trim();

  setText("developer-name", `${developerName} </>`);
  setText("developer-discord-id", developerDiscordId);
  setText("developer-inline-id", developerDiscordId);
  setText("developer-short-id", developerDiscordId.slice(-6));
  setHtml("developer-id-code", `Discord ID // <strong>${developerDiscordId}</strong>`);
  setText("developer-username", `@${developerName.toLowerCase()}`);

  const avatar = document.getElementById("developer-avatar");
  if (avatar) {
    avatar.setAttribute("src", fallbackAvatarDataUri(developerName));
    avatar.setAttribute("alt", `${developerName} Discord profile picture`);
  }
}

function applyDeveloperProfile(profile) {
  if (!profile) {
    return;
  }

  const displayName = String(profile.displayName || profile.username || RUNTIME_CONFIG.developerName || DEFAULT_SITE_DATA.developerName).trim();
  const username = String(profile.username || displayName).trim();
  const userId = String(profile.id || RUNTIME_CONFIG.developerDiscordId || DEFAULT_SITE_DATA.developerDiscordId).trim();
  const avatarUrl = String(profile.avatarUrl || "").trim();

  setText("developer-name", `${displayName} </>`);
  setText("developer-discord-id", userId);
  setText("developer-short-id", userId.slice(-6));
  setText("developer-username", `@${username}`);
  setHtml("developer-id-code", `Discord ID // <strong>${userId}</strong>`);

  const avatar = document.getElementById("developer-avatar");
  if (avatar) {
    avatar.setAttribute("src", avatarUrl || fallbackAvatarDataUri(displayName));
    avatar.setAttribute("alt", `${displayName} Discord profile picture`);
  }
}

async function loadDeveloperProfile() {
  if (!document.getElementById("developer-avatar")) {
    return;
  }

  applyDeveloperProfile({
    id: RUNTIME_CONFIG.developerDiscordId || DEFAULT_SITE_DATA.developerDiscordId,
    username: String(RUNTIME_CONFIG.developerName || DEFAULT_SITE_DATA.developerName).toLowerCase(),
    displayName: RUNTIME_CONFIG.developerName || DEFAULT_SITE_DATA.developerName,
    avatarUrl: "",
  });

  if (!isHttpContext() && !apiBaseUrl()) {
    return;
  }

  try {
    const response = await fetch(apiUrl("/developer-profile"), { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load developer profile: ${response.status}`);
    }

    const payload = await response.json();
    applyDeveloperProfile(payload);
  } catch (error) {
    return;
  }
}

function initRevealMotion() {
  const elements = document.querySelectorAll(
    ".spotlight-card, .mini-panel, .feature-card, .sample-card, .flow-card, .command-card, "
    + ".expand-card, .detail-card, .page-panel, .faq-item, .cta-banner, .vision-card, .developer-card, .developer-micro"
  );

  if (!elements.length) {
    return;
  }

  if (!("IntersectionObserver" in window)) {
    elements.forEach((element) => element.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) {
        return;
      }

      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.16 });

  elements.forEach((element, index) => {
    element.classList.add("reveal-item");
    element.style.setProperty("--reveal-delay", `${Math.min(index * 45, 280)}ms`);
    observer.observe(element);
  });
}

function applySiteData(payload) {
  setText("stat-truth", formatNumber(payload.counts && payload.counts.truth));
  setText("stat-dare", formatNumber(payload.counts && payload.counts.dare));
  setText("stat-total", formatNumber(payload.counts && payload.counts.total));
  setText("stat-history", formatNumber(payload.historyLimit));

  renderUseCases(payload.useCases);
  renderCommands(payload.commands);
  renderSamples(payload.samples);
  startRotation(payload.samples);
  syncInviteLinks(payload.inviteUrl, payload.clientId);
  syncSupportLinks(payload.supportUrl);
  syncGithubLinks(payload.githubUrl);
  syncHealthLinks();
  syncFooterMeta(payload.clientId);
  syncDeveloperProfile();
  updateStatus(payload.status);
}

async function loadSiteData() {
  const fallback = readFallbackData();

  if (!isHttpContext() && !apiBaseUrl()) {
    applySiteData(fallback);
    return;
  }

  try {
    const response = await fetch(apiUrl("/site-data"), { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load site-data: ${response.status}`);
    }

    const payload = await response.json();
    state.apiAvailable = true;
    applySiteData(mergeSiteData(cloneDefaultData(), payload));
  } catch (error) {
    state.apiAvailable = false;
    applySiteData(fallback);
  }
}

async function refreshStatus() {
  try {
    const response = await fetch(apiUrl("/health"), { cache: "no-store" });
    if (!response.ok && response.status !== 503) {
      throw new Error(`Failed to load health: ${response.status}`);
    }

    const payload = await response.json();
    state.apiAvailable = true;
    syncInviteLinks(null);
    syncHealthLinks();
    updateStatus(payload);
  } catch (error) {
    updateStatus(null);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadSiteData();
  syncDeveloperProfile();
  initRevealMotion();
  await loadDeveloperProfile();

  if (state.apiAvailable) {
    window.setInterval(refreshStatus, 15000);
  }
});
