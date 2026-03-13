# Truth & Dare Bot (Discord)

Node-based Discord game bot with:

- `/truthordare` as the main command
- separate easy-to-find commands for Truth, Dare, Would You Rather, Never Have I Ever, Paranoia, Icebreaker, Challenge, and Hot Take
- `PG`, `PG13`, and `R` rating filters
- category filters and a separate `/todcategory` browser command
- Persistent no-repeat history, reports, blacklist, sessions, and schedules in `data/bot.sqlite`
- Session modes: `classic`, `battle`, `streak`, `timer`
- Daily autopost scheduler
- Optional OpenAI prompt generation / rewrite fallback

## Install

```bash
npm install
```

## Configure

Use `.env.example` as the base for `.env`.

Required:

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`

Optional:

- `DISCORD_GUILD_ID`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `BOT_DB_FILE`
- `DEFAULT_TIMEZONE`
- `SCHEDULER_INTERVAL_SECONDS`
- `BOT_LOGIN_429_COOLDOWN`
- `BOT_LOGIN_429_COOLDOWN_MAX`
- `BOT_RESTART_BACKOFF_INITIAL`
- `BOT_RESTART_BACKOFF_MAX`
- `BOT_RAPID_EXIT_SECONDS`
- `BOT_STARTUP_JITTER_MAX`

## Run

```bash
npm start
```

For Windows, use `start.bat`.

## Commands

- `/truthordare` - main play command with game, category, rating, and mode options
- `/truth` - truth only
- `/dare` - dare only
- `/wouldyourather` - would you rather only
- `/neverhaveiever` - never have I ever only
- `/paranoia` - paranoia only
- `/icebreaker` - icebreaker only
- `/challenge` - challenge only
- `/hottake` - hot take only
- `/todbattle` - tracked battle session
- `/todstreak` - tracked streak session
- `/todtimer` - tracked timer session
- `/todcategory` - list available categories for a game/rating
- `/todconfig` - server config for default rating, timeout, prompt length, disabled games/categories
- `/todautopost` - create, list, or delete daily drop schedules
- `/todstats` - pool, blacklist, usage, and schedule stats

## Notes

- Prompt buttons expire automatically using the guild timeout config.
- Reports blacklist prompt IDs immediately so bad prompts stop reappearing.
- Prompts do not repeat in the same channel until that filtered prompt pool has been exhausted.
- Session modes keep scores in persistent storage.
- The supervisor entrypoint is `render_start.js`; it keeps health checks alive and restarts the bot child if needed.
- Secrets belong only in `.env`. Rotate the Discord token if it was shared anywhere public.

## Suggested Discord Permissions

- `applications.commands`
- `Send Messages`
- `Embed Links`
- `Read Message History`
- `Use Application Commands`

## Developer Portal

See `DISCORD_PORTAL_SETUP.md`.
