# Validation — Mara 2.0

- 33 automated tests passed on Node.js 24.14.0.
- Syntax checks passed for every JavaScript file in src and web.
- All 37 slash-command definitions passed naming, option-order, uniqueness, and length checks.
- Regression coverage includes existing role safety, moderation hierarchy, automod and AI adapters; new tests cover warning migration and revocation, backup restore, escalation, raid response, verification gates, private-delivery retries, transcript ownership and close failures, configuration validation, and dashboard authentication/CSRF/permission revocation.
- Dashboard previews with sample data were inspected at 1440×1000 and 390×844. No JavaScript errors or horizontal overflow occurred.
- No new runtime dependencies were added. The original locked dependency installation reported zero known vulnerabilities at installation; this is not a new vulnerability audit.
- The package declares Node >=24.17.0 <25. Local tests used the installed Node 24.14.0; use the declared version for production. SQLite prints an experimental-feature warning on the local runtime.
- Real Discord events, live OAuth/Turnstile, paid AI calls, and Railway deployment have not been exercised by these tests. External APIs were mocked, and the browser preview used sample data.
- Docker was unavailable in the local environment, so the image build was not run. The Dockerfile now copies both src and web.

See ROADMAP-RELEASE.md for activation, defaults, data retention, and integration checks.
