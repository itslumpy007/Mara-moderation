# Mara • The Blacklisted

JavaScript Discord bot, prepared for Railway. One Discord server, one running instance, SQLite storage. This project is source code, not a deployed bot.

## Features

- Moderation: warnings, warning history, timeouts, kicks, bans, recent-message purge.
- Logging: Mara moderation actions, joins/leaves, cached message edits/deletions.
- Welcome messages and button-based rules acceptance.
- Private support tickets and private member reports.
- Announcements and named custom text responses.
- One-role reaction panels (✅ to add, remove reaction to remove).
- Configurable automod for message floods, mass mentions, Discord invites, and blocked phrases.
- Optional AI message review and private, staff-requested report summaries.

## New automod and AI setup

After setting up the original bot below, run `npm run register` again to add `/automod` and `/ai-summary`.

Start with `/automod enabled:true action:log`. This records matches without deleting messages. Configure `LOG_CHANNEL_ID` first. Use `/automod` without options to inspect settings. Members need Manage Server to change settings; the bot also checks this permission when a command runs.

- `/automod action:delete` deletes messages that match local rules. Mara needs Manage Messages in each moderated channel.
- `/automod block-invites:true` checks standard Discord invite links.
- `/automod mention-limit:5 spam-limit:6` triggers at five unique user/role mentions, an everyone/here mention, or six messages by one member across channels in ten seconds.
- `/automod blocked-words:phrase one,phrase two` replaces the blocked phrase list. Matching is case-insensitive substring matching, including normalized Unicode; use `blocked-words:-` to clear it.

Defaults are disabled, log-only, invites allowed, five mentions, six messages per ten seconds, and no blocked phrases. Settings persist in SQLite. Edits are checked for content rules without increasing the flood count. Bots, webhooks, the server owner, members with Manage Messages, the configured staff role, and the log channel are exempt. Flood counters reset on restart. These rules are basic text filters, not comprehensive scam-link detection or raid protection. Deletion failures are logged; Mara does not automatically timeout, kick, or ban.

For optional AI, set `AI_ENABLED=true`, `OPENAI_API_KEY`, and comma-separated `AI_CHANNEL_IDS`. Only messages in those explicitly selected channels are sent for automated AI review, and automod must be enabled. AI flags go to the staff log for human review, even when the local action is delete. Local-rule matches skip AI review. No message attachments are sent or analyzed.

For `/ai-summary text:...`, also set `AI_MODEL` to a Responses API text model available to your OpenAI account. Members need Moderate Members; the draft is returned privately. This command sends only the text staff supply, not channel history or stored tickets. Review drafts against the original report before making decisions.

Inform members before enabling AI that selected message text is sent to OpenAI. Keep private tickets and sensitive channels out of `AI_CHANNEL_IDS`. AI defaults off, requests time out after 15 seconds, and one bot process allows at most two concurrent requests and twenty requests per minute across both AI features. Excess automated reviews are skipped with a console warning; local rules continue. Summary requests can incur API charges. `store:false` is used for summaries; it does not override the provider's other data retention policies.

Implementation references: [OpenAI moderation API](https://developers.openai.com/api/reference/resources/moderations) and [text generation](https://developers.openai.com/api/docs/guides/text).

## 1. Create Mara in Discord

Open https://discord.com/developers/applications and create an application named **Mara**.
On the Bot page, generate a token. Keep it secret; never paste it into chat, source code, screenshots, or GitHub. Reset it immediately if exposed.
Enable **Server Members Intent** and **Message Content Intent**. Copy the application ID as CLIENT_ID.
Enable Discord Developer Mode to copy your server ID as GUILD_ID and the channel/role IDs below.

Invite Mara with the `bot` and `applications.commands` scopes. Grant View Channels, Send Messages, Read Message History, Add Reactions, Manage Roles, Manage Channels, Manage Messages, Moderate Members, Kick Members, and Ban Members. Do not grant Administrator.
Put Mara's role above the verified and self-assigned roles and members she should moderate, but below admin/staff roles where practical.

## 2. Prepare your server

Create a staff-only text channel for logs and reports. Deny View Channel for @everyone and allow only trusted staff and Mara. Check other role overrides too: a role-level allow can expose the channel. Reports identify the reporter to staff; they are not anonymous.
Create a welcome text channel, a plain non-privileged Verified role, a staff role, and optionally a Tickets category.
Restrict member channels to the Verified role if desired. Mara does not change existing server permissions for you. Verification is self-service rules acceptance, NOT age verification, identity verification, or a CAPTCHA.
Post your actual rules before posting the verification panel. Do not use the Verified role as a reaction-panel role if you want people to accept rules first.

## 3. Run and test locally

Install Node.js 24.17 or newer within the Node 24 release line. Extract this folder and open it in Codex or your editor.
Copy `.env.example` to `.env` and fill in your values.

```sh
npm ci
npm test
npm run register
npm start
```

`register` replaces this application's slash commands in the configured server. Run it again after changing command definitions. Do not run two copies of Mara simultaneously.

## 4. Deploy on Railway

1. Create a private GitHub repository and upload this project's contents, including package-lock.json, Dockerfile, railway.json, and src. Keep `.env`, node_modules, and data out of GitHub.
2. In Railway, create a service from that repository. Railway should use the included Dockerfile.
3. Add a persistent **volume mounted at `/data`**. Set **DATA_DIR=/data**. Without the volume, stored warnings, tickets, and reaction mappings can disappear on deployment.
4. Add service variables: DISCORD_TOKEN, GUILD_ID, CLIENT_ID, LOG_CHANNEL_ID, WELCOME_CHANNEL_ID, VERIFIED_ROLE_ID, STAFF_ROLE_ID, and optionally TICKET_CATEGORY_ID.
5. Use one replica, disable application sleeping/serverless for this long-running gateway bot, and deploy. Do not configure an HTTP health-check path: this bot has no web server and needs no public domain.
6. Run `npm run register` locally using the same application/server credentials (step 3), or through an authorized Railway service shell. Then look for `Mara online as ...` in the service logs.

Deployment has not been performed for you. Railway account access, a repository, and your Discord application credentials are required. Railway hosting may incur costs; review your account's pricing before deploying.

## 5. Configure Discord panels

Run these commands as an administrator or member with Manage Server:

| Command | Purpose |
| --- | --- |
| `/panel channel:#verification kind:Verification` | Post rules-acceptance button |
| `/panel channel:#support kind:Tickets` | Post private-ticket button |
| `/rolepanel channel:#roles role:@Gaming text:Gaming notifications` | Post a self-assignable reaction role |
| `/announce channel:#announcements text:Welcome to The Blacklisted` | Publish announcement |
| `/custom-set name:rules text:Read our rules in the rules channel.` | Save a named response |
| `/custom name:rules` | Retrieve a response privately |
| `/custom-delete name:rules` | Remove it |

Staff moderation commands: `/warn`, `/warnings`, `/timeout`, `/kick`, `/ban`, `/purge`. All check the caller's current Discord permissions. Moderation commands act immediately; test only on consenting test accounts. Warning counts do not automatically punish members. Bans do not delete message history. Purge skips messages older than 14 days.

Members can use `/report user:... reason:...` once per minute. Ticket owners or staff can `/close`. Closure hides the ticket from its owner and preserves the channel for staff; administrators can still see it. Staff should archive or delete old tickets according to your retention policy. There is no transcript export in v1.

## Privacy, limitations, and operations

- Log-channel privacy is your responsibility. Warn members that message edits/deletions and moderation records may be retained. Avoid collecting IDs or other sensitive verification documents in tickets.
- Content from uncached/deleted messages may be unavailable. There is no bulk-deletion transcript or attribution of outside staff actions; this is not a comprehensive Discord audit-log mirror.
- Reaction changes while the bot is offline are not reconciled. Users can toggle their reaction again after restart. Privileged and unmanageable roles are refused.
- Reaction panels are independent; exclusive role groups and custom emoji are not included.
- Closed ticket channels retain conversation history. SQLite retains warnings, panel mappings, and custom responses without automatic expiration. Back up the volume and establish a deletion/retention process before production use.
- This starter is for a single server and one process. Do not scale replicas with the same SQLite file.
- Unit tests cover storage, role safety, moderation hierarchy, and command definitions. Live Discord permission flows and Railway deployment require a test server and have not been exercised here.

## Troubleshooting

- Invalid token: reset it in Discord and update the Railway secret variable.
- Disallowed intents: enable the two privileged intents in the Developer Portal.
- Missing commands: run `npm run register` with the correct CLIENT_ID and GUILD_ID.
- Missing permissions: check both server roles and channel overrides; move Mara above the role/member she must manage.
- Lost configuration after deployment: confirm the Railway volume mount and DATA_DIR both use `/data`.

Reference documentation: https://discord.js.org/docs and https://docs.railway.com/volumes
