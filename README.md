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

## Channel and category lettering

Use `/channel-style` to choose a channel or category, enter its base name, and pick Plain, Small caps, Bold serif, Monospace, Italic, Bold italic, Script, Gothic, Double-struck, Sans bold, or Fullwidth. Add an optional star, flower, or diamond decoration. The default is a private preview; repeat with `apply:True` to rename the selected channel.

Example: `/channel-style channel:#general name:general style:small-caps decoration:star` previews **✦・ɢᴇɴᴇʀᴀʟ**. Categories and voice channels retain spaces and case; text channel spaces become hyphens. These are Unicode letters, not installed fonts; rendering, screen readers, and name search may differ across clients. Choose Plain with an undecorated base name to return to ordinary lettering.

You and Mara need View Channel and Manage Channels on the selected channel/category. Only its name changes; IDs, permissions, and category placement stay intact. Run `npm run register` after deploying this update to make the new command available.

Bulk styling: use `/channel-style-bulk scope:all style:small-caps decoration:star` for a private preview file of every proposed rename. Scopes include all names, channels only, categories only, or children within a selected category. Repeat with `apply:True` to apply. Existing Mara lettering and decorations are replaced instead of stacked; unrelated emoji and symbols are preserved. Plain with no decoration removes Mara styling (original capitalization cannot be recovered from small caps). Names you cannot manage are skipped. Changes run sequentially with a per-server lock and produce a results file listing failures; retrying skips names already in the requested style. Discord rate limits can delay completion. No channels are moved and permissions stay unchanged.

Category dividers: choose `divider:stars`, `divider:lines`, or `divider:brackets` in either styling command to create headings such as **━━ ✦ COMMUNITY ✦ ━━**. For every category, preview `/channel-style-bulk scope:categories style:plain divider:stars`, then repeat with `apply:True`. Lettering styles work inside dividers. Omit decoration for a clean frame. Existing Mara dividers are replaced, and `divider:none` removes them. With scope all, only categories receive frames. This formats current category names when you run the command; it does not create categories or automatically format future ones.

## Railway

Deploy this repository using its Dockerfile. Add a persistent volume at `/data` and set `DATA_DIR=/data`, together with the Discord settings from `.env`. Use one replica and leave Serverless off. Stop any local copy before starting Railway. Look for `Mara online as ...` in deployment logs.

The bot runs without a public domain. For the optional dashboard and CAPTCHA, follow [the dashboard setup](ROADMAP-RELEASE.md#dashboard-setup-on-railway). The web server starts only when DASHBOARD_ENABLED=true. Use /health as an optional health check only in that mode.

AI needs an OpenAI API key and a configured text model. AI_CHANNEL_IDS accepts comma-separated channel IDs, all for every eligible channel Mara can read (including private channels), or blank for staff commands only. Automod exemptions still apply; contextual scanning is separately enabled. AI output is advisory. See the full guide for data sharing and rate limits.

## Data and upgrades

Settings, cases, ticket metadata, and the delivery queue use SQLite. Existing starter warnings migrate once. Backup snapshots are saved on the same volume, keeping seven copies; maintain an off-volume backup too. Transcript files and closed channels are retained for staff. Set a retention policy; records do not expire automatically.

New message protections, warning escalation, raid actions, CAPTCHA, and AI context review default off. Existing automod settings remain in place. After updating commands, run `npm run register` once. This replaces Mara’s guild slash commands and does not start another bot.

See [VALIDATION.md](VALIDATION.md) for tested behavior and integration limits.
