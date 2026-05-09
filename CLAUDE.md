# CLAUDE.md

Index + invariants for AI assistants. Self-hosted React + Express + SQLite "Daily Status Summary" tracker. Single user logs in, manages multiple **teams**, each with priorities (sub-tasks, due dates, snooze, assignees, type tags), Chat webhook posts, due-date notifications, Insights/Archive/History.

Stack: see `package.json` (root + `scaffold/` + `server/`). Data shape: `@typedef Data` in `status_tracker.jsx`. Storage key `status_tracker_v3` — bump only on breaking schema; additive go through `migrate()` / `migrateTeamSettings()` (`lib/migrate.js`, idempotent + sanitizing).

## File map

```
status_tracker.jsx        Shell (~1700L): state, effects, mutators, view JSX glue.
components/fields.jsx     Inline editors + pills: Editable, MarkdownEditor, StatusPill, PriorityPill, TicketField, LinksField, AssigneeField, DueField, SnoozeField, RowMeta, TypeField.
components/today.jsx      FilterBar + chips + SavedFiltersBar. PRIORITY_HEX/STATUS_HEX maps for native <option>.
components/views.jsx      HelpView, HistoryView, InsightsView (+VelocityBars, InsightsCard), DiffSection.
components/dialogs.jsx    TaskPanel, ShortcutsCheatsheet, UndoToast, ExportMenu, PrioritiesEditor, SettingsView.
lib/                      Pure JS, no React/DOM/fetch:
  constants.js              STATUS_*, DEFAULT_PRIORITIES, TW_PRIORITY_PALETTE, COMMON_TIMEZONES, DEFAULT_TEAM_SETTINGS
  util.js                   uid, formatDate, today, parseAssignees, applyTimestamped, dueBucket, isSnoozed
  sort.js                   sortPriorityRows, sortByStatus (done-to-end + holdOpenIds)
  priority.js               resolvePriorityDef, sortedPriorities, priorityColorClasses, isTopUrgency
  migrate.js                migrate, migrateTeamSettings, getActiveTeam, getActiveWebhookUrl
  snapshot.js               rolloverTeam (daily snapshot + auto-archive)
  insights.js               collectAllRows, windowRange, summaryFor, velocityByDay, assigneePivot
  notify.js                 endOfDayMs (tz-aware), shouldPing, collectOverdueRows, buildDueNotificationMessage
  export.js                 buildExport (txt) + buildMarkdownExport (md) + inferLinkLabel/Icon
  markdown.js               renderMarkdown (escape-first XSS guard)
  api.js                    storage shim + postToChat
  useFocusTrap.js           Tab/Shift+Tab trap (ShortcutsCheatsheet + TaskPanel)
  diff.js                   diffPriorities
server/server.js          Express 5: login, sessions, /api/state, /api/chat-post, due-notification cron.
server/notify.js          runDueNotificationScan + pruneStaleDueNotifications. Uses forwardToChatPost.
server/scripts/users.js   CLI: create/list/delete/passwd. Reads passwords from stdin/PASSWORD env.
scaffold/                 Vite 7 + React 19 + Tailwind 4 harness. Build copies status_tracker.jsx + lib/ + components/ in.
Dockerfile, docker-compose*.yml, scripts/backup.sh   Prod port 8384→3000, named volume tracker-data:/data, tmpfs /tmp, read_only root, runs as node UID 1000.
```

## Feature → file map

| Feature | Lives in |
|---|---|
| Today rows + sub-tasks | inline JSX in `status_tracker.jsx`, fields from `components/fields.jsx` |
| Filtering (search, priority, status, type, due, snoozed, assignee) | `FilterBar` (`today.jsx`). `visibleData` memo in `status_tracker.jsx` does the work. |
| Saved filter views | `SavedFiltersBar` (`today.jsx`). Persisted as `team.settings.savedFilters`. |
| Priority customization (P0 + custom tiers + colors) | `PrioritiesEditor` (`dialogs.jsx`). Storage `team.settings.priorities`. Sort via `priorityRank` (`lib/priority.js`). |
| Snooze | `SnoozeField` (`fields.jsx`). Filter gate via `isSnoozed` (`lib/util.js`) inside `visibleData`. |
| Done-sort + 5s reorder hold | `sortPriorityRows`/`sortByStatus` accept `holdOpenIds`. `heldDoneIds` state + per-id setTimeout in `StatusTracker`. |
| Undo toast on delete | `UndoToast` (`dialogs.jsx`). `queueToast`/`restoreToast` in StatusTracker. 8s timer in `toastTimersRef`. |
| Insights tab | `InsightsView` (`views.jsx`). Pure derivation in `lib/insights.js`. |
| Diff vs yesterday | inline JSX, uses `DiffSection` (`views.jsx`). `diffPriorities` in `lib/diff.js`. |
| Archive (auto + restore) | inline JSX in StatusTracker. `rolloverTeam` (`lib/snapshot.js`) auto-archives. |
| History (last 30 days) | `HistoryView` (`views.jsx`). Storage `team.history`. |
| Help | `HelpView` (`views.jsx`). Header `Help` button (NOT a tab). |
| Keyboard shortcuts (j/k/x/c/?) | inline keydown in StatusTracker. `ShortcutsCheatsheet` (`dialogs.jsx`). |
| Markdown edit (`@` mention, `/` slash menu, Ctrl+B/I/K) | `MarkdownEditor` (`fields.jsx`). Used by `TaskPanel`. |
| Export (Copy / .txt / .md / JSON) | `ExportMenu` (`dialogs.jsx`). Builders in `lib/export.js`. |
| Google Chat post | `lib/api.js:postToChat` → `POST /api/chat-post` → `forwardToChatPost` (server.js). URL allowlist + per-user rate limit. |
| Due-date notifications | Client 60s tick in StatusTracker. Server cron: `runDueNotificationScan` every 60s. Both use `lib/notify.js`. SQLite `due_notifications` table for dedupe. |
| Auto-post daily summary | Best-effort browser tick in StatusTracker. Apps Script template in `SettingsView`. |
| Timezone | `team.settings.tz` → container `TZ` (default `Asia/Kolkata`) → local. `endOfDayMs(yyyymmdd, tz)` in `lib/notify.js`. |
| Multi-team strip | inline JSX + handlers in StatusTracker. `addTeam`/`deleteTeam` operate at data level (not via `updateTeam`). |
| Task drawer | `TaskPanel` (`dialogs.jsx`). Triggered by row's `doc`/`doc+` button → `panelTask = { pid, iid }`. |
| Focus trap | `useFocusTrap` (`lib/useFocusTrap.js`). On `ShortcutsCheatsheet` + `TaskPanel`. |

## Debug paths

| Symptom | Look at |
|---|---|
| Today list wrong rows / order | `visibleData` memo + `sortPriorityRows` + `isSnoozed` filter in `status_tracker.jsx` |
| Tab renders blank / "Something broke" | `tests/render.test.jsx` — usually out-of-scope variable in a view component |
| Filter doesn't match | `rowMatches` + `dueMatches` + `itemMatches` in `visibleData`. Note parent-rescue for sub-task filters, strict-parent rule for priority filter. |
| Priority chip renders as "—" | `team.settings.priorities` missing key → `resolvePriorityDef` fell to unknown-def. Check migration ran. |
| Undo toast doesn't fire on delete | `deletePriority`/`deleteItem` must capture row BEFORE `setData`. Race fix from earlier. |
| Done row doesn't slide to bottom | `heldDoneIds` Set + 5s timer. `sortPriorityRows` reads `holdOpenIds`. |
| Chat ping not firing | (1) `team.settings.notifyOnDue` true? (2) Active webhook URL? (3) Row overdue per team's tz (`endOfDayMs`)? (4) Per-user rate limit (`[webhook-rate]` log)? (5) Server cron running (not `noNotifyCron: true`)? |
| Auto-post fires twice / stale | Auto-post uses `dataRef.current` to dodge closure staleness. Deps `[loading, autoPostEnabled, autoPostActiveUrl]`. New deps usually wrong — derive via memo, depend on memo. |
| Snapshot lost / overwritten | `rolloverTeam` overwrites `history[lastSnapshotDate]` at rollover. If `lastSnapshotDate === today()` → no-op (seed it for tests that don't want rollover). |
| Migration regression | `tests/migrate.test.js`. Idempotency: `migrateTeamSettings(migrateTeamSettings({}))` expects no diff. |
| "X is not exported by lucide-react" | lucide-react 1.x renamed icons. Rename or check imports at top of files. |
| Tailwind class doesn't apply | Tailwind 4 JIT only picks up literal class strings. No `bg-${x}-300` template strings. Use static maps (`PRIORITY_COLOR_CLASSES`). |
| Server `path-to-regexp` error | Express 5 / path-to-regexp v8 rejects bare `*`. SPA fallback uses final `app.use((req, res) => …)`. |
| Tests fail "slice is not valid mach-o file" on macOS | `cd server && npm rebuild better-sqlite3`. Native binding shipped for Linux/Docker; rebuild for darwin. |
| Codecov badge "unknown" | No `CODECOV_TOKEN` secret on the repo. CI uploads with token length 0; `fail_ci_if_error: false` swallows the error. Add the secret via `gh secret set CODECOV_TOKEN`. |
| Concurrent edits silently overwrite | Known: last write wins per user. README "Limitations" + this doc are the contract — don't paper over. |

## Invariants (don't paper over)

**Storage / state**
- One state JSON blob per row in `user_state(user_id, json)`. Server treats body as opaque; schema is client-side.
- **Last write wins per user.** Two tabs editing concurrently silently overwrite. Don't add silent retries.
- Storage shim: `window.storage` → `/api/state` → `localStorage`. Always use the shim. Every write mirrors to localStorage; every read overwrites it.

**React contract**
- Hooks-only. No class components. No state libraries. `useState` + `update(fn)` is the contract.
- `updateTeam(fn)` is the team-scoped mutator. All CRUD on priorities/sub-tasks/notes/archive routes through it.
- `team` is `useMemo` of `getActiveTeam(data)`. Always read `team.X`, never `data.X`.

**UI**
- Background `#f5f1e8` (warm paper). **Light mode only.** Dark mode was rolled back; one-time effect in StatusTracker purges leftover `.dark` + `localStorage["status_tracker_theme"]`.
- Tailwind utility classes only. Every class string a literal — no `bg-${color}-300`. Static maps (`PRIORITY_COLOR_CLASSES`) are the pattern.
- Chip filters use **amber active** (`bg-amber-100 text-amber-950 border-amber-700`), never pure black on warm-paper bg.
- Touch targets ≥ 36×36 (regression in `tests/render.test.jsx`).
- Modals trap focus via `useFocusTrap`, carry `role="dialog" aria-modal="true"`.
- Markdown: hand-rolled subset in `lib/markdown.js`. Pipeline is HTML-escape FIRST, then add tags. **That's the only XSS guard** — keep escape-first ordering. Supports `` `code` ``, `[text](url)`, bare URL auto-link, `**bold**`, `*italic*`, line breaks. Don't switch to a library or contenteditable without explicit ask.

**Sort + status cascades**
- `sortPriorityRows`: priority rank → status; done rows go to end. `holdOpenIds` keeps freshly-done rows in place for 5s.
- `setPriorityStatus(p, "done")` prompts when sub-tasks aren't done; on confirm cascades DONE down. Confirm runs OUTSIDE state updater (StrictMode double-invoke).
- `setItemStatus`: completing the last sub-task auto-promotes parent. Reopening a sub-task while parent is DONE re-opens parent to BLOCKED (if `newStatus === blocked`) or WIP — never back to TODO.

**Webhooks (Chat)**
- **Frontend never POSTs `chat.googleapis.com` directly.** Always `POST /api/chat-post` → `forwardToChatPost` (server.js): allowlist `^https://chat.googleapis.com/` + per-user rate limit (5s min, 5/min, 100/day) + 10s upstream timeout.
- Same `forwardToChatPost` is used by the due-notification cron — preserve rate-limit invariants when refactoring.
- Don't log webhook URLs. Log `user=…`, byte length, upstream status only.
- CSP `connect-src 'self'` enforces no direct frontend Chat traffic. New external host → extend CSP **and** the proxy allowlist.

**Snapshot / archive**
- `rolloverTeam(team, today, retentionDays)` (`lib/snapshot.js`): captures yesterday's priorities at `history[lastSnapshotDate]`, then auto-archives rows DONE in two consecutive snapshots (~24-48h dwell). Top-level get `parentId: null`, sub-tasks get parent's id.
- Don't reduce dwell to a single rollover without explicit ask — `>24h` is the contract.
- 5s done-hold is display-only, separate from archive timing.

## Server / Docker

- Express 5 + better-sqlite3 12 (sync, WAL). Single replica. Login + webhook rate-limits persist in SQLite (`rate_limit` table).
- Auth: bcryptjs cost 12, cookie-session (httpOnly, sameSite=lax, secure controlled by `COOKIE_SECURE`). Session signing key in `SESSION_SECRET` or auto-generated + persisted in `kv` table.
- Bootstrap: empty `users` + `BOOTSTRAP_ADMIN_USER`/`PASS` env → first user. Once any user exists, env vars ignored.
- Container: `node:22-slim`, runs as `node` UID 1000, `read_only: true` root + `tmpfs:/tmp` + named volume `tracker-data:/data` (writable; holds `.db`/`.db-wal`/`.db-shm`).
- All env (`HOST_PORT`, `PORT`, `DB_PATH`, `STATIC_DIR`, `NODE_ENV`, `BOOTSTRAP_ADMIN_*`, `SESSION_SECRET`, `COOKIE_SECURE`, `TRUST_PROXY_HOPS`, `TZ`) sourced via `${VAR:-default}` in `docker-compose.yml`. Documented in `.env.example`.
- Dev compose bind-mounts `status_tracker.jsx`, `lib/`, `components/` for HMR. Vite at port 5173.
- Due-notification cron: `setInterval(runDueNotificationScan, 60_000)` + hourly `pruneStaleDueNotifications(db, 90)`. `noNotifyCron: true` test-only.
- Backups: `scripts/backup.sh` uses `db.backup()` (concurrent-safe). Cron recipe in README. Required for any real deployment.

## Editing checklist

1. `npm test` green (225+ tests, 19 files). On macOS first run may need `cd server && npm rebuild better-sqlite3`.
2. `npm run typecheck` clean.
3. Schema changed? Update `migrateTeamSettings` (idempotent + sanitizing). Update `@typedef` in `status_tracker.jsx`. Add regression in `tests/migrate.test.js`.
4. New tab? Add to nav array in `status_tracker.jsx`. Add "renders without crashing" test to `tests/render.test.jsx`. Add section to `HelpView`.
5. New user-facing feature? Update `HelpView` and the feature → file map above.
6. Server route? Update `server/tests/<name>.test.js`. The `/api/<path>` JSON-404 catch-all must still match every unhandled `/api/*`.
7. Touched server / storage / build? Smoke prod container:
   ```
   docker compose up -d --build
   curl -s -o /dev/null -w "%{http_code}" http://localhost:8384/health     # → 200
   curl -s -o /dev/null -w "%{http_code}" http://localhost:8384/api/me     # → 401
   ```

### Tests

- `tests/<name>.test.js` for pure helpers (one per `lib/<name>.js`). Fast.
- `tests/render.test.jsx` mounts full `<StatusTracker>` via `window.storage` shim. Use `mountTracker()` + `seedState({ snoozedFuture? })`. Every new tab/view must add a "renders without crashing" test here.
- `server/tests/<name>.test.js` uses Supertest + in-memory SQLite via `makeApp({ db, sessionSecret, ... })`. See `server/tests/_helpers.js`.
- Time-travel: webhook rate-limit + cron take `now` as a parameter — no real-time waits. For React tick, prefer `Date.now` spies over `vi.useFakeTimers` (fake timers deadlock the storage shim's microtasks).

## Don't add

- New state libraries (Redux/Zustand/etc.).
- New top-level files unless asked. Edit in place.
- Backend / sync / cloud code without explicit ask. Backups via host cron, not in-app.
- Emojis in source. Diff-text intentionally uses `🚨 ➕ 🔄 ➖` (renders in Chat) — keep those.
- `git push --force`, `--no-verify`, or `git rebase -i` without explicit instruction.
- `Co-Authored-By: Claude` on commits. Author for THIS repo is **Sai Kiran Shekolla** `shekollasaikiran@gmail.com` (set as repo-local git config).
- Markdown library or contenteditable without explicit ask — hand-rolled keeps bundle small + auditable HTML surface tiny.

## Conventions

- Commits: `[Tag] message`, one-line imperative. Tags from log: `[Tracker]`, `[Server]`, `[Docs]`, `[Tests]`, `[Build]`, `[CI]`, `[Refactor]`, `[Deps]`, `[UI]`, `[Fix]`, `[Meta]`, etc. `docker-compose*.yml` / `Dockerfile*` / `.github/**` → `[CI]`.
- Auto mode = execute, don't over-plan. Plan mode for architecture changes only.
- Terse responses. Push back when you disagree — silent compliance is unhelpful.
- This file is the index. Use grep/read to dive deeper. Don't dump file contents into chat unless asked.
