# Mara: full roadmap release

This release implements all eight roadmap areas. External service setup is still required for the optional dashboard, CAPTCHA, and AI. They are off unless configured. The bot remains one server and one process.

## What is included

| Area | Available now in the code |
| --- | --- |
| Reliability | Startup diagnostics, interaction error references, durable report/log retry queue, SQLite backups on startup, shutdown, daily, and by command |
| Configuration | /config, /welcome, private /panel previews, settings persisted on the volume and editable in Discord or the dashboard |
| Moderation | Numbered cases, /case, /history, /warn-remove with preserved history, /unban, optional warning-triggered timeouts |
| Protection | Repeated messages, blocked domains, unusual URL structures, channel/category exemptions, join-spike alerts or temporary verification pauses |
| Verification | Account-age checks, optional Turnstile challenge, review requests and staff approval/denial, verification cases |
| Tickets | Categories, staff claiming, close confirmation, saved text transcripts, owner feedback |
| AI | Recent-ticket summaries, draft replies, contextual review of flagged messages in explicitly allowed channels |
| Dashboard | Discord login, live permission checks, settings and automod forms, case search/pagination, status and ticket/review overview, mobile layout |

## Activate the bot update

1. Keep the Railway volume mounted at /data and DATA_DIR=/data. Keep one replica.
2. Deploy the updated main branch.
3. Register the updated commands once with npm run register using the existing bot credentials. Do not start a second local bot.
4. Run /setup-check. Ensure Mara can read ticket history, manage channels and roles, and send embeds.
5. Open /config to select the log, welcome, verified, staff, and ticket category IDs. Saved settings override the Railway values; clearing a value disables that resource instead of falling back.

Existing warnings are imported into cases automatically once. Existing open ticket owner mappings remain recognized. Existing verification/ticket buttons still work. Existing automated-message settings are preserved; new protections default off.

## Everyday commands

- /welcome text:Welcome {user} to {server}! You are member {count}.
- /panel channel:#verification kind:Verification preview:true (private, disabled-button preview)
- /case number:12 and /history user:@member before:12
- /warn-remove number:12 reason:Appeal accepted
- /unban id:DISCORD_USER_ID reason:Appeal accepted
- /escalation warnings:3 minutes:10 (every third active warning triggers a timeout; 0 disables; only new warnings trigger it)
- /protection repeats:true suspicious-links:true
- /protection blocked-domains:example.com,other.example
- /protection exempt-channels:CHANNEL_ID,CATEGORY_ID
- /raid action:alert joins:8 seconds:20
- /raid action:pause-verification pause-minutes:10
- /raid resume:true (ends an active pause)
- /verification minimum-days:3
- /verification-review user:@member action:Approve reason:Reviewed
- /ticket-categories names:General support,Member report,Appeal
- /ticket-claim, /ticket-transcript, /close
- /ticket-feedback ticket:TICKET_CHANNEL_ID rating:5
- /backup

The bot owner, bots, staff role, and members with Manage Messages remain exempt from message automod. The log channel is also exempt. Test automod using a consenting nonstaff test account. Join-spike responses do not automatically kick or ban.

## Dashboard setup on Railway

Generate a public HTTPS domain for the Mara service (Railway service Settings → Networking). The Docker image includes the web app and binds to Railway's PORT when enabled.

Add these Railway variables privately:

    DASHBOARD_ENABLED=true
    PUBLIC_BASE_URL=https://YOUR-MARA-DOMAIN
    DISCORD_CLIENT_SECRET=YOUR_DISCORD_OAUTH_CLIENT_SECRET

CLIENT_ID must remain the same Discord application ID used by Mara. In Discord Developer Portal → OAuth2, add this exact redirect URI:

    https://YOUR-MARA-DOMAIN/oauth/callback

Deploy the variables, visit the root URL, and sign in with Discord. Only current server members with Manage Server can access staff APIs. Permissions are checked on each request. The dashboard never returns tokens or client secrets. Sessions last one hour and are reset on restart. Settings saves require a same-origin request and session CSRF token.

An optional HTTP health check can now use /health while DASHBOARD_ENABLED=true. Leave it unset when the dashboard is disabled. The endpoint reports only bot readiness.

## CAPTCHA setup

Create a managed Cloudflare Turnstile widget for the exact dashboard hostname. Add TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY in Railway, then redeploy. Run /verification captcha:true.

Members click the existing verification button and follow the private link. They sign in with Discord, accept the server rules, and complete the challenge. The server checks Turnstile success, hostname, and action before assigning a role. Tokens cannot be reused. Minimum account age and raid pause checks also run on the server. Staff approval is an explicit exception path; it still refuses unsafe roles.

CAPTCHA is a bot challenge, not age or identity verification. Do not collect identity documents. If the service is unavailable, members can request staff review.

## AI setup

AI_ENABLED=true and OPENAI_API_KEY enable the provider. Set AI_MODEL to an available Responses API text model. Keys remain in Railway.

- /ticket-ai mode:Summary or Suggested reply sends up to 4000 characters from the most recent 50 ticket messages to OpenAI. Only ticket staff with channel access can run it. Outputs are private drafts and never auto-post as staff replies.
- /ai-context enabled:true lets Mara retrieve up to six recent messages after a moderation flag, within the AI_CHANNEL_IDS scope. Automated review also requires /automod enabled:true.
- The existing two-concurrent / twenty-per-minute request cap and timeouts apply across all AI features. Notify members about which message/ticket text is shared with the provider.

## Data, delivery, and recovery

- Settings, warning cases, ticket metadata, reviews, and the retry queue live in mara.sqlite.
- Reports are acknowledged as saved for delivery, not falsely marked delivered. Private report delivery rechecks channel permissions on every retry. Only the configured staff role, Mara, and administrator role overrides are accepted; remove extra role/member allows before using /report.
- Delivery is at-least-once. A crash after Discord accepts a message but before the database confirms it may cause a duplicate.
- Backups use the SQLite backup API, keep the latest seven snapshots under /data/backups, and are on the same volume. They protect against local database mistakes, not loss of the entire volume. Copy backups off-volume through Railway and enable Railway volume backups where available.
- Text transcripts are saved under /data/transcripts. Exports include at most the most recent 5000 messages and 1.5 million text characters. Attachment links may expire; attachments are not downloaded. Staff can re-export a retained channel with /ticket-transcript.
- Closed channels, transcripts, cases, and feedback have no automatic expiry in this release. Establish a retention policy and remove old channels/files through your administrator tools. Backups may retain earlier records until rotated.
- To restore: stop the bot, back up the current data directory, restore a chosen snapshot as mara.sqlite, and handle any old SQLite WAL/SHM files only while the process is stopped. Start one instance and run /setup-check.
- Back up before rolling back code. The old bot cannot understand new case records or dashboard settings.

## Verification performed

Automated tests cover migration/restart persistence, backup restore, warning revocation, validation, raid thresholds, CAPTCHA gating, role safety, private delivery retries, transcript permissions, OAuth state/replay rejection, CSRF, dashboard authorization and permission revocation. Desktop and mobile dashboard previews were inspected using sample data, with no browser errors or horizontal overflow.

Live Discord permission flows, real OAuth and Turnstile credentials, AI provider calls, and Railway deployment still require an integration check after configuration. No credentials are included in this repository.

References: [Discord OAuth2](https://docs.discord.com/developers/topics/oauth2), [Cloudflare server validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/), [Railway volumes](https://docs.railway.com/volumes).

### All-channel AI review
Set AI_CHANNEL_IDS=all in Railway and deploy to review new eligible messages across the configured server, including private channels Mara can read. This does not scan historical messages. Blank disables automatic AI scanning; comma-separated IDs restrict it. Requires AI_ENABLED=true, OPENAI_API_KEY, and /automod enabled:true. Existing staff, bot, webhook, log-channel and configured channel/category exemptions still apply. Local-rule matches are handled before AI. The existing limit of 20 AI requests/minute and two concurrent requests remains; excess requests are skipped. Notify members that reviewed message text is sent to OpenAI.
