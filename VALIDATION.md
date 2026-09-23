# Validation

- 12 automated tests passed on Node.js 24.14.0: original storage, role safety, hierarchy, and command checks plus automod exclusions, enforcement, edited messages, flood expiration, AI channel restrictions, API parsing, disabled mode, rate limiting, and error handling.
- `node --check src/index.js` passed.
- `npm ci --ignore-scripts` installed the locked dependencies; npm reported zero known vulnerabilities at installation.
- The starter requires Node >=24.17.0 <25. The local runtime is older, so npm produced an engine warning. Use the declared runtime for deployment; the tests above were run on the installed runtime.
- Discord gateway behavior, actual server permissions, live OpenAI calls, Docker, and Railway deployment have not been tested. AI tests use mocked API responses and do not send data externally.

Before deployment, test verification, welcomes, automod in log-only mode, and staff permissions in a Discord test server. Enable AI only after setting its channel allowlist and notifying members.
