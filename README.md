# Truth & Dare Bot (Discord)

High-variety Discord Truth or Dare bot with:
- Huge local prompt pool (truth + dare)
- Low-repeat engine per channel
- PG-safe filtering (very low curse/romance/ex style prompts)
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

## 3) Run

```bash
npm start
```

## Commands

- `/truthordare` with optional `mode` (`random`, `truth`, `dare`)
- `/todstats` to inspect prompt pool + anti-repeat status

## Notes

- Prompt pool is generated from large curated base prompts + template/matrix expansion.
- The bot avoids recent repeats per channel by tracking history and used prompt keys.
- AI is optional. If no OpenAI key is configured, bot uses local pool only.
- Prompt safety filter blocks many romance/ex/profanity style keywords.

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
