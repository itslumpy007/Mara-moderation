# Mara • The Blacklisted

Mara is a JavaScript Discord moderation bot with persistent settings, moderation cases, verification, automod, private tickets, AI assistance, and an optional Discord-authenticated dashboard.

**Full feature and deployment guide: [ROADMAP-RELEASE.md](ROADMAP-RELEASE.md).**

## Quick start

Use Node.js >=24.17.0 within the Node 24 line. Copy `.env.example` to `.env` and enter your bot token, CLIENT_ID, GUILD_ID, and channel/role IDs privately. Enable Server Members and Message Content intents in the Discord Developer Portal. Keep `.env` out of GitHub.

```sh
npm ci
npm test
npm run register
npm start
```

Invite Mara with bot and applications.commands scopes. Grant View Channels, Send Messages, Read Message History, Embed Links, Add Reactions, Manage Roles, Manage Channels, Manage Messages, Moderate Members, Kick Members, and Ban Members as needed. Administrator is not required. Move Mara above the basic Verified role and members she should moderate.

Run `/help` and `/setup-check`. Use `/config` to save channels and roles directly in Discord; `/welcome` customizes the greeting. `/panel` posts verification or ticket panels and supports private previews. Make logs staff-only and restrict member channels to Verified if verification should control access. Rules acceptance and CAPTCHA do not establish age or identity.

## Railway

Deploy this repository using its Dockerfile. Add a persistent volume at `/data` and set `DATA_DIR=/data`, together with the Discord settings from `.env`. Use one replica and leave Serverless off. Stop any local copy before starting Railway. Look for `Mara online as ...` in deployment logs.

The bot runs without a public domain. For the optional dashboard and CAPTCHA, follow [the dashboard setup](ROADMAP-RELEASE.md#dashboard-setup-on-railway). The web server starts only when DASHBOARD_ENABLED=true. Use /health as an optional health check only in that mode.

AI needs an OpenAI API key and a configured text model. Automated scanning is restricted to AI_CHANNEL_IDS; contextual scanning is separately enabled. AI output is advisory. See the full guide for data sharing and rate limits.

## Data and upgrades

Settings, cases, ticket metadata, and the delivery queue use SQLite. Existing starter warnings migrate once. Backup snapshots are saved on the same volume, keeping seven copies; maintain an off-volume backup too. Transcript files and closed channels are retained for staff. Set a retention policy; records do not expire automatically.

New message protections, warning escalation, raid actions, CAPTCHA, and AI context review default off. Existing automod settings remain in place. After updating commands, run `npm run register` once. This replaces Mara’s guild slash commands and does not start another bot.

See [VALIDATION.md](VALIDATION.md) for tested behavior and integration limits.
