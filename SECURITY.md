# Security policy

## Reporting a vulnerability

**Do not open a public issue for security problems.** Email
**`shekollasaikiran@gmail.com`** with:

- A description of the issue
- Steps to reproduce (or a proof-of-concept)
- The version / commit you tested against
- Any mitigation suggestions

I'll acknowledge within 72 hours and aim to triage within a week. If the
issue is confirmed:

- **Critical / high (auth bypass, RCE, data exfiltration):** patch released
  within 7 days, advisory published after the fix is tagged.
- **Medium (info disclosure, DoS, weakening of an existing protection):**
  patched in the next release; advisory published with the release notes.
- **Low (hardening, defense-in-depth):** rolled into the normal release
  cadence.

You'll be credited in the advisory unless you'd rather stay anonymous.

## Scope

This repo's `main` branch + the latest tagged release.

In scope:
- The Express server (`server/`) — auth, sessions, rate limits, the chat
  proxy, `/api/state`, the due-notification cron, security headers, CSP.
- The React frontend (`status_tracker.jsx` + `components/`, `lib/`) —
  XSS surface (especially `lib/markdown.js`'s escape pipeline), the
  storage shim, anything that handles user-supplied HTML or URLs.
- The Docker image (`Dockerfile`) — base image vulnerabilities, the
  `node` UID 1000 + read-only FS hardening, the healthcheck path.

Out of scope:
- Self-inflicted misconfiguration (running with `COOKIE_SECURE=false`
  on a public domain, weak `BOOTSTRAP_ADMIN_PASS`, exposing the
  container without a reverse proxy).
- Vulnerabilities in upstream dependencies that aren't yet patched
  (file with the upstream first).
- Social-engineering attacks against the maintainer.
- Findings on a fork that has been modified from `main`.

## What we already do

- Bcrypt password hashes at cost 12, constant-time compare against a
  dummy hash on unknown-user login (no timing oracle).
- Per-IP login rate limit (10 attempts / 15 min) persisted in SQLite.
- Per-user webhook rate limit (5s min interval, 5/min burst, 100/day)
  to contain a frontend regression that might spam Chat.
- URL allowlist on `/api/chat-post` (`^https://chat.googleapis.com/`) —
  the frontend cannot post to arbitrary URLs even if compromised.
- HTML escape-first markdown pipeline (`lib/markdown.js`) — the only
  XSS guard for user-supplied titles + descriptions.
- CSP `connect-src 'self'`, `frame-ancestors 'none'`, no inline
  scripts. Headers set in `server/server.js`.
- HttpOnly + SameSite=lax + signed cookie-session.
- Container hardening: `read_only: true`, `cap_drop: ALL`,
  `no-new-privileges:true`, runs as non-root UID 1000.

## Threat model assumptions

- Single-tenant deployment. There is no multi-org / shared-tenancy
  isolation; users on the same instance trust each other.
- Self-hosted. The maintainer (the person running the container) is
  trusted with the SQLite blob, environment variables, and host
  filesystem. We don't try to defend against root on the host.
- Behind a TLS-terminating reverse proxy in production. Plain HTTP
  serving is documented as test-only.

If your deployment violates these assumptions and you find a related
issue, that's still worth reporting — but the fix may be a documentation
change rather than code.
