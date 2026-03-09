# Discord Developer Portal Setup (Truth & Dare Bot)

## 1) Bot tab
Set these:
- Public Bot: ON (or OFF if only you should invite/manage it)
- Requires OAuth2 Code Grant: OFF
- Presence Intent: OFF
- Server Members Intent: OFF
- Message Content Intent: OFF

This bot only uses slash commands + buttons, so privileged intents are not required.

## 2) OAuth2 -> URL Generator
Scopes:
- `bot`
- `applications.commands`

Bot Permissions:
- Send Messages
- Embed Links
- Read Message History
- Use Application Commands

Then open generated invite URL and add the bot to your server.

## 3) Optional fast command updates
In `.env`, set `DISCORD_GUILD_ID` to your server ID while testing.
- Guild commands update almost instantly.
- If empty, global commands are used and can take time to appear.

## 4) Start bot
Use `start.bat` in project root.
