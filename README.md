# daypage

[![CI](https://github.com/shekolla/daypage/actions/workflows/ci.yml/badge.svg)](https://github.com/shekolla/daypage/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Container](https://img.shields.io/badge/ghcr.io-daypage-blue?logo=docker)](https://github.com/shekolla/daypage/pkgs/container/daypage)
[![Node](https://img.shields.io/badge/node-22%20LTS-43853d?logo=node.js&logoColor=white)](https://nodejs.org/)

A self-hosted daily-status tracker. Numbered priorities → sub-tasks → date-stamped notes, modeled on the "Daily Status Summary" Slides format you'd otherwise maintain by hand. React + Express + SQLite, single user with multi-team support, runs in one ~250 MB Docker container.

> _Daily standups are a UI problem, not a process problem. daypage is the UI._

**What you get:** P0/P1/P2/P3 priority tiers (per-team customizable, including custom colors and ranks), sub-tasks with status cascades + auto-promote, due dates with timezone-aware overdue, snooze, undo on delete, drag-reorder, keyboard shortcuts (j/k/x/c/?), Insights tab (velocity bars + assignee pivot), 30-day history, auto-archive of done work, search + chip-style filters, saved filter views, hand-rolled markdown editor with @-mentions, and one-click Chat webhook posting (with a server-side cron for due-date pings even when no tab is open).

**Stack:** React 19 · Vite 7 · Tailwind 4 · Vitest 4 · Express 5 · better-sqlite3 12 · Node 22 LTS.

**License:** MIT. See [LICENSE](./LICENSE).

---

## Quick start (Docker)

```bash
git clone https://github.com/shekolla/daypage
cd daypage
cp .env.example .env
# edit .env: set BOOTSTRAP_ADMIN_USER and BOOTSTRAP_ADMIN_PASS for the first user
docker compose up -d
# open http://localhost:8384  →  login form
```

Or run the prebuilt image without cloning (released on each tag):

```bash
docker run -d --name daypage \
  -p 8384:3000 \
  -e BOOTSTRAP_ADMIN_USER=admin \
  -e BOOTSTRAP_ADMIN_PASS='use-a-real-password' \
  -e TZ=Asia/Kolkata \
  -v daypage-data:/data \
  ghcr.io/shekolla/daypage:latest
```

---

## Architecture

A single React component. Drop into any Vite / Next / CRA project that has Tailwind CSS installed.

### Quickest path — Docker

Two flavors:

**Production** (default — multi-stage build, Node + Express + SQLite for per-user state, login form + session cookies, security headers, healthcheck):

```bash
cp .env.example .env
# edit .env: set BOOTSTRAP_ADMIN_USER and BOOTSTRAP_ADMIN_PASS for the first user
docker compose up -d --build
# open http://localhost:8384  →  login form
```

Per-user state is persisted server-side in SQLite at `/data/tracker.db`, mounted on a named volume (`tracker-data`). Each user sees only their own priorities. Survives `docker compose down` / `docker compose up`. To wipe everything: `docker compose down -v`.

#### Managing users

After bootstrap, create / list / delete / re-password users with the bundled CLI:

```bash
# interactive (hidden prompt — recommended)
docker compose exec -it tracker node scripts/users.js create alice

# automation: pipe the password on stdin so it never lands in shell history
# or in the host process listing
read -rs PASSWORD
echo "$PASSWORD" | docker compose exec -T tracker node scripts/users.js create alice
unset PASSWORD

docker compose exec tracker node scripts/users.js list
docker compose exec -it tracker node scripts/users.js passwd alice
docker compose exec    tracker node scripts/users.js delete alice    # also wipes their state
```

> **Never** type the password as a positional argument or as an
> inline `PASSWORD=...` env on the host shell — both end up in
> `~/.bash_history` and the host process list.

Passwords are stored as bcrypt hashes (cost 12). Sessions are signed cookies (`tracker.session`) with a 7-day rolling expiry. The signing secret auto-generates and persists in the SQLite `kv` table on first start — set `SESSION_SECRET` in `.env` if you need to rotate or share across replicas.

**Development** (Vite dev server, hot-reload, bind-mounted source):

```bash
docker compose -f docker-compose.dev.yml up -d
# open http://localhost:5173
# edit status_tracker.jsx and the browser updates
```

Stop either with `docker compose down`. Data persists in browser localStorage and survives container restarts.

> **Note for SELinux hosts (Fedora, RHEL):** the dev compose file adds `:Z` to the bind-mount. The tracker file must be readable by the container — if you see permission errors, run `chmod 644 status_tracker.jsx`.

#### Verify the prod container

```bash
# health is unauthenticated (used by the container healthcheck)
curl http://localhost:8384/health           # → ok

# anonymous request: SPA HTML is served, login form renders
curl -I http://localhost:8384/              # → 200 (HTML)

# /api/me without a session
curl -I http://localhost:8384/api/me        # → 401

# log in to get a session cookie
curl -c /tmp/c.txt -X POST \
     -H 'Content-Type: application/json' \
     -d '{"username":"admin","password":"yourpass"}' \
     http://localhost:8384/api/login

# now use the cookie
curl -b /tmp/c.txt http://localhost:8384/api/me      # → {"username":"admin"}
curl -b /tmp/c.txt http://localhost:8384/api/state   # → state JSON

docker compose ps                            # health: healthy
```

> **Password rotation**: edit the user's password with `users.js passwd <name>`. Add or remove users at any time — runtime change, no rebuild. The signing secret for sessions is stored in the DB; rotating it (set a new `SESSION_SECRET` in `.env`, restart) invalidates all active sessions.

### Install (if you'd rather skip Docker and host inside an existing React app)

```bash
npm i lucide-react
```

Tailwind required. Fraunces + JetBrains Mono load from Google Fonts at runtime — no install needed.

```jsx
import StatusTracker from "./status_tracker.jsx";

export default function App() {
  return <StatusTracker />;
}
```

The component is self-contained. State is auto-saved on every change (debounced 500ms) to either:

- `window.storage` if Claude.ai's artifacts API is present, or
- `localStorage` otherwise.

Storage key: `status_tracker_v3`. The first load also tries to import legacy `status_tracker_v2` data once.

### What it does

| Tab | Purpose |
| --- | --- |
| **Teams** (top strip) | One bucket per team — separate priorities, history, archive, webhooks, auto-post schedule. Click a team to switch. **+ Add team** to create more. Click the X next to the team name to delete (only when 2+ teams exist). |
| **Today** | Edit priorities, sub-tasks, notes. Status pill is a dropdown (`TODO / WIP / BLOCKED / DONE`). P-pill cycles `— → P1 → P2 → P3`. Each row also has: a single ticket URL, a list of free-form **external links** (Google Docs/Sheets/Slides auto-iconed, generic URLs supported), an **assignee** (free text — not tied to a registered user), an optional **due date** (overdue / today / soon / later badge, surfaced in `(due YYYY-MM-DD)` exports), and tracked timestamps (created / assigned / done). Top-level sort: priority first (P1 → P2 → P3 → normal), then status. Filter bar covers priority / status / type / due / assignee / free-text search. |
| **Diff** | Shows what changed between today and the last snapshot: new blockers, status flips, additions, removals. "Post diff to Chat" sends the diff to your webhook. |
| **Archive** | Items that were DONE across two consecutive day-rollovers auto-move here. Restore puts them back as WIP. |
| **History** | Date picker over the last 30 daily snapshots — for the active team. Read-only view of any past day. |
| **Settings** | Google Chat webhooks list (multiple, one active), daily auto-post toggle + time, **Send now** button — all scoped to the active team. Each team has its own webhooks and schedule. |

### Snapshot lifecycle

- On every load the component checks `lastSnapshotDate`. If it does not match today:
  1. Deep-copies the current `priorities` into `history[lastSnapshotDate]`.
  2. Auto-archives any item that was DONE in the previous *two* snapshots.
  3. Trims `history` to the most recent 30 entries.
  4. Updates `lastSnapshotDate` to today.
- Snapshots happen client-side, so the browser must be opened at least once on a new day for the rollover to fire.

### Google Chat webhooks

Settings tab → **Google Chat webhooks** → **Add** → paste a webhook URL → give it a name → tick the radio button to mark it active. You can save several (one per Chat space) and switch the active one without re-pasting URLs.

Find the URL: in any Google Chat space → space menu → **Apps & integrations** → **Manage webhooks** → **Add webhook** → copy the URL.

- **Send test to active** — round-trips a one-line test to the active webhook (verifies the URL works).
- Header **Post to Chat** button — posts the full status summary to the active webhook.
- Diff tab → **Post diff to Chat** — posts only what changed since yesterday.

#### Auto-post / Send now

Settings tab → **Auto-post daily summary to Chat** checkbox + time picker. The browser checks the wall clock once per minute and fires once past your target time per day (deduped via `lastAutoPostDate`).

The same panel has a **Send now** button — sends the daily summary right away to the active webhook, no scheduling.

Honest limitation: auto-post only fires while the tab is open. For real cron-style daily posting (no tab needed), copy the Apps Script template shown in the Settings tab into a new Google Apps Script project and run its `setup()` once.

#### Due-date notifications

Settings tab → **Notify when tasks become due**. When toggled on, the browser asks for Notification permission; once granted, any priority or sub-task in this team that crosses its due date will trigger a desktop notification. Same browser-only constraint as auto-post — the tab has to be open. In-memory dedupe is keyed by `(task id, due date)`, so re-scheduling a task lets it ping again but reloading the tab won't replay every old due moment.

### Export formats

- **Copy** → plain text, the original Slides-deck format (numbered list, `@assignee`, status, ticket marker, `[Links: doc, sheet]`, `(done <date>)`).
- **.txt** download → same content as a file named `status-YYYY-MM-DD.txt`.
- **Snapshot** (header) → full-state JSON of every team, including history and archive. Restorable from Settings → "Restore from a backup file". Useful as a manual safety net before risky edits.

### What the Docker setup ships

| File | Purpose |
| --- | --- |
| `Dockerfile` | Multi-stage: node:20-alpine builds the frontend (vite); node:20-slim hosts Express + better-sqlite3 + the built dist/. Runs as the non-root `node` user. |
| `Dockerfile.dev` | Single-stage Vite dev server for fast iteration on the component itself. |
| `docker-compose.yml` | Prod default. Port 8384 → 3000. Named volume `tracker-data` mounted at `/data` for the SQLite file. Read-only root filesystem, dropped capabilities, `no-new-privileges`, healthcheck. Bootstrap admin + session settings passed as runtime env from `.env`. |
| `docker-compose.dev.yml` | Dev variant. Port 5173, bind-mounts `status_tracker.jsx` with `:ro,Z` (SELinux). |
| `.env.example` | Template for runtime config: `BOOTSTRAP_ADMIN_USER`, `BOOTSTRAP_ADMIN_PASS`, `SESSION_SECRET`, `COOKIE_SECURE`. Copy to `.env`. |
| `server/server.js` | Express app: login + session cookies, per-user `/api/state`, static serve, `/health`, login rate-limit, `/api/*` 404, gzip. Tables: `users`, `user_state`, `kv`. |
| `server/scripts/users.js` | CLI: `create / list / delete / passwd`. Reads passwords from stdin or `PASSWORD` env, never argv. |
| `server/scripts/backup.js` | In-container online SQLite backup helper, called by `scripts/backup.sh`. |
| `server/package.json` | `express` + `better-sqlite3` + `cookie-session` + `bcryptjs` + `compression`. |
| `scripts/backup.sh` | Host wrapper: trigger online backup, stream snapshot out via `exec cat` (works with the container's tmpfs `/tmp`). |
| `scaffold/` | Minimal Vite + React + Tailwind harness. Don't edit unless changing build config. |
| `.dockerignore` | Keeps the build context lean. |

The page ships with a strict-ish CSP allowing only Google Fonts and `https://chat.googleapis.com` outbound. SQLite uses WAL mode for safe concurrent reads.

#### Production hardening shipped

- Login rate-limit: 10 failed attempts per IP per 15 min → 429 with `Retry-After`.
- **Webhook proxy with hard rate limit** (`POST /api/chat-post`): per-user 5s min interval, 5 per minute, 100 per day. The frontend never reaches chat.googleapis.com directly — the server is the chokepoint, so any client regression that tries to spam Chat is contained at the proxy.
- URL allowlist for the proxy: only `https://chat.googleapis.com/...`.
- 10s timeout on the upstream POST to Chat.
- Auto-post tick uses a `useRef` data mirror to avoid stale-closure re-fires (prior bug: a 60s `setInterval` captured `lastAutoPostDate` from the original render and kept firing even after a successful post saved today's date).
- gzip via `compression` middleware (~70% size reduction on the JS bundle).
- `/api/*` returns proper JSON 404s instead of falling through to the SPA HTML.
- Resource limits in compose: 256 MB memory, 0.5 CPU. Log rotation: 10 MB × 5 files.
- Bcrypt cost 12 for password hashes, `crypto.timingSafeEqual` for session-cookie comparison.
- Server logs `[security]` warning at startup if the bootstrap password is short or `changeme`.
- Server logs `[webhook]` (success) and `[webhook-rate]` (blocked) so you can audit Chat traffic from the host.
- `cookie-session` flags: `httpOnly`, `sameSite: lax`, `secure` toggled by `COOKIE_SECURE`.
- CSP `connect-src 'self'` (the chat host is no longer needed since the server proxies).

#### Backup / restore

Self-hosted means **your** SQLite. One `rm -rf /data` and you've lost
everything — wire the included online-backup script to host cron the
moment you finish setup. Two lines is the minimum credible setup.

```bash
./scripts/backup.sh                # writes ./backups/tracker-<TS>.db
./scripts/backup.sh /var/backups   # alternate output dir

# restore: stop, drop the snapshot back into the volume, start
docker compose down
docker run --rm \
  -v daypage_tracker-data:/data \
  -v "$PWD/backups:/in:ro" \
  alpine sh -c 'cp /in/tracker-<TS>.db /data/tracker.db && chown 1000:1000 /data/tracker.db'
docker compose up -d
```

The script uses `better-sqlite3`'s online `db.backup()` API — safe to
run while the server is serving requests.

Schedule via host cron:

```cron
# 03:15 daily; retain 30 most recent
15 3 * * * cd /path/to/repo && ./scripts/backup.sh && ls -1t backups/*.db | tail -n +31 | xargs -r rm
```

#### Ship snapshots off-host

Local backups protect against `rm`; off-host backups protect against
the disk dying. Pair the cron line above with one of these:

```bash
# Google Drive (via rclone — set up once with `rclone config`)
rclone copy ./backups gdrive:tracker/

# AWS S3 (with versioning enabled on the bucket — recommended)
aws s3 sync ./backups s3://my-bucket/tracker-backups/

# Off-machine rsync to a known-good host
rsync -avz --delete ./backups/ user@backup-host:/var/backups/tracker/

# Borg or restic for deduplicated encrypted backups
borg create /mnt/borg::tracker-{now} ./backups
```

Whichever you pick, run it from the same cron entry so the local copy
and the remote copy stay in lockstep. Test the restore path at least
once before you trust it.

#### Putting it on the public Internet

The container speaks plain HTTP on 8384. Sit a reverse proxy (Caddy or nginx) in front to terminate TLS, then set `COOKIE_SECURE=true` in `.env` and restart so the auth cookie only flows over HTTPS.

```caddyfile
# Caddyfile (auto-issues TLS via Let's Encrypt)
tracker.example.com {
    reverse_proxy 127.0.0.1:8384
}
```

#### Pre-deploy checklist

- [ ] `.env` set: `BOOTSTRAP_ADMIN_USER`, `BOOTSTRAP_ADMIN_PASS` (≥12 chars, not `changeme`), `COOKIE_SECURE=true` for HTTPS, optional `SESSION_SECRET`.
- [ ] **`TRUST_PROXY_HOPS`** set to the number of trusted proxies in front of the container (0 = none, 1 = Caddy/nginx, 2 = CDN + nginx). Mismatch lets clients spoof `X-Forwarded-For` and bypass the per-IP login rate-limit.
- [ ] TLS proxy in front (Caddy or nginx). Plain HTTP is OK for localhost only.
- [ ] First deploy: `docker compose up -d --build`, watch `docker compose logs -f` for `[security]` warnings.
- [ ] Hit `/health`, `/api/me` unauthed (expect 401), then log in via UI.
- [ ] **Hard-refresh** the tab on every redeploy (`Ctrl+Shift+R`) so the new JS bundle replaces any cached one. Old bundles can carry old bugs even after the server is updated.
- [ ] Schedule `scripts/backup.sh` on host cron (see snippet above).
- [ ] Optional: `docker compose down` once a week to verify volume + sessions survive a clean restart.
- [ ] Watch for `[webhook-rate]` log lines — they indicate a frontend regression trying to spam Chat. Treat as red flag.

```nginx
# nginx
server {
    listen 443 ssl http2;
    server_name tracker.example.com;
    ssl_certificate     /etc/letsencrypt/live/tracker.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tracker.example.com/privkey.pem;
    location / {
        proxy_pass http://127.0.0.1:8384;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## Limitations (read before relying on this for a team)

### Concurrent-edit data loss (last write wins)

State is a per-user JSON blob in SQLite. **Two browser tabs of the same
user editing different priorities simultaneously will silently overwrite
each other** — the later PUT clobbers the earlier. The tracker is built
for one-tab-per-user use. If you keep multiple tabs open, treat them as
read-only mirrors and only edit in one.

There is no per-tab merge or conflict resolution. Adding it would
require operational transforms or per-row timestamps; out of scope for a
self-hosted small-team tool.

### Auto-post is browser-only

The "Auto-post" toggle in Settings only fires while a tab is open. For
true cron-style daily posting that runs even when your browser is
closed, use the **Apps Script template** at the bottom of the Settings
tab (or run any cron job that POSTs the latest `status-YYYY-MM-DD.txt`
output to your webhook URL).

### Single replica only

Login rate-limit + per-user webhook rate-limit state both live in the
single replica's SQLite plus an in-process `Map`. If you ever scale out
horizontally, swap them for Redis or a similar shared store. For a
small self-hosted team this is fine — the assumption is documented in
the relevant code paths.

---

## Tests

```bash
npm install            # at repo root
npm test               # vitest: 191+ unit + server + render tests
npm run typecheck      # tsc --noEmit on the server (JSDoc)
npm run test:coverage  # v8 coverage summary
```

The unit tests cover the pure helpers in `lib/` (markdown render, migrate, diff, sort, snapshot, priority, insights, export). The render tests mount the full `<StatusTracker>` via `tests/render.test.jsx` to catch out-of-scope variable bugs in any tab/view. The server tests use Supertest + an in-memory SQLite per test against the `createApp({ db, sessionSecret, ... })` factory in `server/server.js` — covering login + rate-limit, session cookie, per-user `/api/state` isolation, the chat-proxy allowlist + 5s min-interval, and the JSON 404 fallthrough on `/api/*`.

CI (GitHub Actions, `.github/workflows/ci.yml`) runs install → typecheck → tests → scaffold build on every push and PR.

---

## Why this instead of Slides + manual triage

| Slides + manual | This repo |
| --- | --- |
| Manual numbering, breaks when reordering | Auto-numbered |
| Status = a typed word; nothing enforces it | Pill, four fixed states, color-coded |
| Yesterday's deck = today's deck (manual carry) | Persists, diffs, archives stale items |
| No idea what changed since yesterday | Diff tab, postable to Chat |
| Daily summary written by hand | Copy → paste, or webhook auto-post |

---

## Repo layout

```
status_tracker.jsx        React component — calls /api/state for per-user persistence
lib/                      Pure-JS helpers (constants, util, sort, markdown, migrate, diff, export, api). No React.
scaffold/src/Login.jsx    Login form rendered when /api/me is 401
scaffold/src/App.jsx      Auth gate (Login vs StatusTracker) + ErrorBoundary
server/server.js          Express + SQLite backend (login, sessions, /api/state, rate-limit, gzip)
server/scripts/users.js   CLI for create/list/delete/passwd
server/scripts/backup.js  In-container online SQLite backup helper
server/package.json       express + better-sqlite3 + cookie-session + bcryptjs + compression
scripts/backup.sh         Host wrapper: ./scripts/backup.sh [output-dir]
Dockerfile                Multi-stage: vite build → node prod runtime
Dockerfile.dev            Vite dev server with HMR
docker-compose.yml        Prod (port 8384) — `docker compose up -d`
docker-compose.dev.yml    Dev  (port 5173) — `docker compose -f docker-compose.dev.yml up -d`
.env.example              Runtime auth credentials template
scaffold/                 Minimal Vite + React + Tailwind harness
.gitignore                Keeps node_modules, dist, env files out of git
.dockerignore             Keeps the build context lean
CLAUDE.md                 Notes for AI assistants editing this repo
README.md                 This file
```
