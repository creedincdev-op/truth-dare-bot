# Truth & Dare Bot (Discord)

High-variety Discord Truth or Dare bot with:
- Huge local prompt pool (truth + dare)
- Low-repeat engine per channel
- Pop-culture and crush-aware prompt mix without explicit content
- Optional AI fallback for fresh prompts when needed
- Interactive button panel (`Truth`, `Dare`, `Random`)

## 1) Install

```bash
npm install
```

## 2) Configure

Copy `.env.example` to `.env` and set:

- `DISCORD_TOKEN`: Bot token
- `DISCORD_CLIENT_ID`: Discord application client ID
- `DISCORD_GUILD_ID`: Optional (recommended for instant test command updates)
- `OPENAI_API_KEY`: Optional (enables AI-generated fresh prompts)
- `OPENAI_MODEL`: Optional, defaults to `gpt-4.1-mini`
- `BOT_LOGIN_429_COOLDOWN`: Optional login cooldown after Discord rate limits startup, defaults to `900`
- `BOT_LOGIN_429_COOLDOWN_MAX`: Optional max login cooldown, defaults to `3600`

## 3) Run

```bash
npm start
```

## Render Hosting

- Start command: `npm start`
- Health check path: `/healthz`
- Keepalive monitor: `/healthz`
- Discord readiness check: `/health`

## Commands

- `/truthordare` with optional `mode` (`random`, `truth`, `dare`)
- `/todstats` to inspect prompt pool + anti-repeat status

## Notes

- Prompt pool is generated from curated base prompts plus template and matrix expansion.
- The tone mixes crush, celeb, ex, and social-media prompts with general fun prompts instead of making the whole bot one style.
- The bot avoids recent repeats per channel by tracking history and used prompt keys.
- AI is optional. If no OpenAI key is configured, bot uses local pool only.
- Prompt safety filter blocks explicit sexual content, drugs, and profanity.
- `npm start` now runs a small supervisor process that keeps the Render health endpoint up and restarts the Discord bot child process with backoff if it crashes.
- The Discord child process also backs off on login `429` responses, matching the Render pattern used in the CLINX bot.

## Suggested Discord Permissions

- `applications.commands`
- `Send Messages`
- `Embed Links`
- `Read Message History`
- `Use Application Commands`
## Quick Start (Windows)

Double-click `start.bat` to auto-install dependencies (if missing) and start the bot.

## Developer Portal Checklist

See `DISCORD_PORTAL_SETUP.md` for exact toggles/scopes/permissions.
