# CLAUDE.md

Guidance for AI assistants editing this repo. Auto-loaded by Claude Code at session start. Index + rules + debug map — not a complete spec. Use the tools (grep, read, file_search) for the long tail.

## What this repo is

Self-hosted React + Express + SQLite "Daily Status Summary" tracker. Single user logs in, manages multiple **teams**, each team has priorities (with sub-tasks, due dates, snooze, assignees, type tags), Chat webhook posts, due-date notifications, Insights, Archive, History.

```
status_tracker.jsx        Main shell (~1700 lines): state, effects, mutator handlers, view-block JSX glue. The brain.
components/fields.jsx     Inline editor primitives + pill components (Editable, MarkdownText, MarkdownEditor, StatusPill, PriorityPill, TicketField, LinksField, AssigneeField, DueField, SnoozeField, RowMeta, TypeField).
components/today.jsx      FilterBar + FilterChip + AssigneeChip + SavedFiltersBar (chip-style filters with amber active state). PRIORITY_HEX/STATUS_HEX maps for native <option> coloring.
components/views.jsx      Read-only views: HelpView, HistoryView, InsightsView (+ VelocityBars, InsightsCard), DiffSection. INSIGHTS_WINDOWS + WEEKDAY_SHORT helpers.
components/dialogs.jsx    Modals + drawers + Settings: TaskPanel, ShortcutsCheatsheet, UndoToast, ExportMenu, PrioritiesEditor, SettingsView.
lib/                      Pure-JS helpers, no React/DOM/fetch. Imported by status_tracker.jsx, the components/, the server, and tests directly:
                            constants.js  STATUS_*, DEFAULT_PRIORITIES, TW_PRIORITY_PALETTE, COMMON_TIMEZONES, DEFAULT_TEAM_SETTINGS
                            util.js       uid, formatDate, today, parseAssignees, applyTimestamped, dueBucket, isSnoozed, etc.
                            sort.js       sortPriorityRows + sortByStatus (done-to-end + holdOpenIds)
                            priority.js   resolvePriorityDef, sortedPriorities, priorityColorClasses, isTopUrgency
                            migrate.js    migrate, migrateTeamSettings (idempotent), getActiveTeam, getActiveWebhookUrl
                            snapshot.js   rolloverTeam (daily snapshot + auto-archive)
                            insights.js   collectAllRows, windowRange, summaryFor, velocityByDay, assigneePivot
                            notify.js     endOfDayMs (tz-aware), shouldPing, collectOverdueRows, buildDueNotificationMessage
                            export.js     buildExport (txt) + buildMarkdownExport (.md) + inferLinkLabel/Icon
                            markdown.js   renderMarkdown (escape-first XSS guard)
                            api.js        storage shim + postToChat
                            useFocusTrap.js  Tab/Shift+Tab trap for modals (used by ShortcutsCheatsheet + TaskPanel)
server/server.js          Express 5 app: login, sessions, /api/state, /api/chat-post, due-notification cron. Bcrypt + cookie-session.
server/notify.js          runDueNotificationScan + pruneStaleDueNotifications. Walks every user's state, dispatches Chat pings via shared forwardToChatPost helper.
server/scripts/users.js   CLI: create / list / delete / passwd. Reads passwords from stdin/PASSWORD env.
scaffold/                 Vite 7 + React 19 + Tailwind 4 harness. Build pipeline copies status_tracker.jsx + lib/ + components/ in.
scaffold/src/index.css    Tailwind 4 CSS-first: @import "tailwindcss" + @source globs + @layer base border-color reset.
Dockerfile                Multi-stage: node:22-alpine builds frontend → node:22-slim runs Express. Runs as `node` UID 1000.
docker-compose.yml        Prod default. Port 8384 → 3000. Volume tracker-data → /data. read_only FS, dropped caps. TZ=${TZ:-Asia/Kolkata}.
docker-compose.dev.yml    Dev variant. Bind-mounts status_tracker.jsx + lib/ + components/ with :ro,Z (SELinux).
scripts/backup.sh         Online SQLite backup via better-sqlite3 db.backup(). Documented in README "Backups".
.env.example              Template. Includes TZ, BOOTSTRAP_ADMIN_*, COOKIE_SECURE, TRUST_PROXY_HOPS, SESSION_SECRET.
```

### Stack

React 19 · Vite 7 · @vitejs/plugin-react 5.2 · Tailwind 4 (CSS-first via `@tailwindcss/postcss`, no `autoprefixer`) · Vitest 4 + happy-dom 20 · TypeScript 6 (typecheck-only) · lucide-react 1.x · Express 5 · better-sqlite3 12 · bcryptjs 3 · Node 22 LTS in Docker.

`vitest.config.js` (renamed from `vitest.workspace.js` in Vitest 4) holds two `test.projects`: `unit` (happy-dom) + `server` (node).

User-facing setup in `README.md`. No duplicate setup here.

---

## Data shape

```ts
{ teams: Team[], activeTeamId: string }

type Team = {
  id, name, title, subtitle: string,
  priorities: Priority[],
  history: { [YYYY-MM-DD]: Priority[] },   // last 30 days, snapshotted by rolloverTeam
  archive: ArchivedItem[],
  lastSnapshotDate: string | null,
  settings: Settings,
};

type Settings = {
  webhooks: Array<{ id, name, url }>,    // Google Chat webhooks
  activeWebhookId: string | null,
  autoPostEnabled: boolean,
  autoPostHour: number,                  // 0..23 (local time)
  autoPostMinute: number,                // 0..59
  lastAutoPostDate: string | null,
  workTypes: string[],                   // configurable type-tag enum
  notifyOnDue: boolean,                  // Browser + Chat ping when row crosses dueAt
  nagOverdue: boolean,                   // re-ping every nagIntervalHours for still-overdue rows; default true
  nagIntervalHours: number,              // 1..72; default 4
  tz: string,                            // "" = use server default. Whitelist: COMMON_TIMEZONES (lib/constants.js)
  priorities: PriorityDef[],             // per-team customizable urgency tiers (incl. P0)
  savedFilters: SavedFilter[],           // [{ id, name, filters }] — chips above FilterBar
};

type PriorityDef = {
  key, label, color: string,             // color from TW_PRIORITY_PALETTE
  rank: number,                          // lower = higher urgency. "normal" pinned last (rank 99)
  builtin?: boolean,                     // only on "normal" — prevents delete/reorder, label still editable
};

type SavedFilter = { id, name: string, filters: object };

type Priority = {
  id, title: string,
  status: "not_started" | "wip" | "blocked" | "done",
  priority: string,                      // key into team.settings.priorities
  ticket: string,
  items: Item[],
  links?: LinkRef[],
  assignee?: string,                     // free-text, comma-separated; parseAssignees() splits at render+filter
  type?: string,                         // tag from team.settings.workTypes
  description?: string,                  // markdown, edited in TaskPanel
  createdAt?, assignedAt?, doneAt?: string | null,   // ISO 8601
  dueAt?, snoozedUntil?: string | null,  // YYYY-MM-DD; end-of-day in team.settings.tz (or server default)
};
type Item = Omit<Priority, "priority" | "items"> & { notes: Note[] };
type Note = { id, content, date };
type LinkRef = { id, label, url };
type ArchivedItem = Item & { archivedDate: string, parentTitle: string, parentId: string | null };
```

`migrate()` handles legacy v3 single-team blob → wrapped Default team. `migrateTeamSettings()` is idempotent — seeds every settings field, sanitizes user-edited entries, clamps numbers, whitelists `tz`. `STORAGE_KEY = "status_tracker_v3"` — bump only on breaking schema changes; additive go through migration.

---

## Feature → file map (read this first when debugging)

| Feature | Lives in |
|---|---|
| Today list (rows + sub-tasks) | inline JSX in `status_tracker.jsx` (~lines 1200-1500), uses field components from `components/fields.jsx` |
| Filtering (search, priority, status, type, due, snoozed, assignee) | `FilterBar` in `components/today.jsx`. `visibleData` memo in `status_tracker.jsx` does the actual filtering. |
| Saved filter views | `SavedFiltersBar` in `components/today.jsx`. Persisted as `team.settings.savedFilters`. |
| Priority customization (P0 + custom tiers + colors) | `PrioritiesEditor` in `components/dialogs.jsx`. Storage at `team.settings.priorities`. Sort uses `priorityRank` (`lib/priority.js`). |
| Snooze | `SnoozeField` in `components/fields.jsx`. Filter gate via `isSnoozed` (`lib/util.js`) inside `visibleData` memo. |
| Done-sort + 5s reorder hold | `sortPriorityRows`/`sortByStatus` accept `holdOpenIds` Set. `heldDoneIds` state + per-id setTimeout in `StatusTracker`. |
| Undo toast on delete | `UndoToast` in `components/dialogs.jsx`. `queueToast`/`restoreToast` in `StatusTracker`. 8s timer in `toastTimersRef` (Map). |
| Insights tab (velocity bars, hero metrics, assignee pivot) | `InsightsView` in `components/views.jsx`. Pure derivation in `lib/insights.js`. |
| Diff (vs yesterday's snapshot) | inline JSX in `status_tracker.jsx`, uses `DiffSection` from `components/views.jsx`. `diffPriorities` in `lib/diff.js`. |
| Archive (auto + restore) | inline JSX in `status_tracker.jsx`. `rolloverTeam` in `lib/snapshot.js` does the auto-archive. |
| History (last 30 days) | `HistoryView` in `components/views.jsx`. Storage at `team.history`. |
| Help (in-app reference) | `HelpView` in `components/views.jsx`. Triggered from header `Help` button (NOT a tab). |
| Keyboard shortcuts (j/k/x/c//?) | inline keydown effect in `StatusTracker`. `ShortcutsCheatsheet` in `components/dialogs.jsx`. |
| Markdown edit (`@` mention, `/` slash menu, Ctrl+B/I/K) | `MarkdownEditor` in `components/fields.jsx`. Used by `TaskPanel`. |
| Export (Copy / .txt / .md / JSON snapshot) | `ExportMenu` in `components/dialogs.jsx`. Builders in `lib/export.js`. |
| Google Chat post (webhook) | Frontend never POSTs to `chat.googleapis.com` directly. `lib/api.js:postToChat` → `POST /api/chat-post` → `forwardToChatPost` in `server/server.js` (URL allowlist + per-user rate limit). |
| Due-date notifications (browser + Chat) | Client tick: 60s `setInterval` in `StatusTracker`. Server cron: `runDueNotificationScan` in `server/notify.js` (called every 60s in `server.js`). Both use `lib/notify.js` helpers. Persisted dedupe in `due_notifications` SQLite table. |
| Auto-post daily summary | Best-effort browser tick in `StatusTracker`. Apps Script template in `SettingsView` for true cron. Amber callout above the toggle. |
| Timezone | `team.settings.tz` (per-team override) → container `TZ` env var (default `Asia/Kolkata`) → local fallback. `endOfDayMs(yyyymmdd, tz)` in `lib/notify.js`. Settings dropdown picks from `COMMON_TIMEZONES`. |
| Multi-team strip + add/rename/delete | inline JSX + handlers in `StatusTracker`. `addTeam`/`deleteTeam` operate at data level (not `updateTeam`). |
| Task drawer (description, sub-task list) | `TaskPanel` in `components/dialogs.jsx`. Triggered by row's `doc`/`doc+` button → sets `panelTask = { pid, iid }`. |
| Focus trap on modals | `useFocusTrap` in `lib/useFocusTrap.js`. Applied to `ShortcutsCheatsheet` + `TaskPanel`. |

---

## Common debug paths

When a bug shows up, this is where I'd look first:

| Symptom | Likely files |
|---|---|
| Today list shows wrong rows / wrong order | `visibleData` memo + `sortPriorityRows` (`lib/sort.js`) + `isSnoozed` filter in `status_tracker.jsx` |
| A tab renders blank or "Something broke" | `tests/render.test.jsx` for that tab — usually an out-of-scope variable in a view component. Run the existing tab-rendering tests; they cover this class of bug. |
| Filter doesn't match what user expects | `rowMatches` + `dueMatches` + `itemMatches` inside `visibleData` (status_tracker.jsx) — note the parent-rescue logic for sub-task filters and the strict-parent rule for priority filter |
| Priority chip renders as "—" instead of a label | `team.settings.priorities` is missing the key → `resolvePriorityDef` fell to unknown-def. Check migration ran + key matches. |
| Undo toast doesn't fire after delete | `deletePriority`/`deleteItem` capture row BEFORE setData — race fix from earlier. If broken, look at the order of `let snapshot = …` + `updateTeam`. |
| Done row doesn't slide to bottom | `heldDoneIds` Set + 5s timer in `StatusTracker`. `sortPriorityRows` reads `holdOpenIds` to keep held rows in their open-group spot. |
| Chat ping not firing | (1) `team.settings.notifyOnDue === true`? (2) Active webhook URL? (3) Row actually overdue per the team's tz (`endOfDayMs`)? (4) Per-user rate limit not blocking? Check `[webhook-rate]` log warnings. (5) Server cron running? `noNotifyCron: true` opt-out is for tests only. |
| Browser notification permission re-prompt | `notifyOnDue` toggle in `SettingsView` requests permission on click. If denied, toggle stays off and shows `alert()`. |
| Auto-post fires twice / stale | Auto-post uses `dataRef.current` to avoid closure staleness. Dep array is `[loading, autoPostEnabled, autoPostActiveUrl]`. New deps usually wrong — derive via memo and depend on the memo. |
| Snapshot lost / overwritten | `rolloverTeam` (`lib/snapshot.js`) overwrites `history[lastSnapshotDate]` with current priorities at rollover time. If `lastSnapshotDate === today()`, no-op (so seed it to today in tests that don't want rollover). |
| Migration regression after a schema change | `tests/migrate.test.js` is the gate. Idempotency test runs `migrateTeamSettings(migrateTeamSettings({}))` and expects no diff. |
| Build fails: "X is not exported by lucide-react" | lucide-react 1.x renamed some icons. Either rename the import or check the icon list at the top of `status_tracker.jsx` / `components/*.jsx`. |
| Tailwind class doesn't apply | Tailwind 4 JIT only picks up literal class strings. If you see `bg-${color}-300` template-strings, that's the bug — move to a static map (see `lib/priority.js:PRIORITY_COLOR_CLASSES`). |
| Server won't start: "path-to-regexp" error | Express 5 / path-to-regexp v8 rejects bare `*` wildcards. SPA fallback uses a final `app.use((req, res) => …)` instead. |
| Concurrent edits silently overwrite | Known limitation — last write wins per user. Don't paper over. README "Limitations" + this doc are the contract. |

---

## Test setup + fixtures

- `npm test` — runs both `unit` (happy-dom) and `server` (node) projects. Currently 225 tests across 19 files. Should stay green at every commit.
- `npm run typecheck` — `tsc --noEmit` over `server/**/*.js` + JSDoc typedefs.
- `npm run build` — copies status_tracker + lib/ + components/ into scaffold/src/ then `vite build`. Catches bad imports the test suite might miss.

### Where new tests go

| Kind | File pattern | Notes |
|---|---|---|
| Pure-helper unit | `tests/<name>.test.js` | One file per `lib/<name>.js`. Use `describe`/`it`/`expect`. Fast (<100ms). |
| Component render | `tests/render.test.jsx` | Mounts full `<StatusTracker>` via `window.storage` shim. Catches "tab X explodes" bugs that pure-helper tests miss. **Every new tab/view should add a "renders without crashing" test here.** |
| Server integration | `server/tests/<name>.test.js` | Supertest + in-memory SQLite via `makeApp({ db, sessionSecret, ... })`. See `server/tests/_helpers.js`. |

### `mountTracker` pattern (tests/render.test.jsx)

```js
let mockStore = null;
beforeEach(() => {
  mockStore = JSON.stringify(seedState());
  window.storage = {
    get: vi.fn(async () => ({ value: mockStore })),
    set: vi.fn(async (_k, v) => { mockStore = v; }),
  };
});
afterEach(() => {
  cleanup();
  delete window.storage;
});

async function mountTracker() {
  const utils = render(<StatusTracker />);
  await screen.findByPlaceholderText(/Search title/i, {}, { timeout: 3000 });
  return utils;
}
```

The `seedState({ snoozedFuture? })` helper in `tests/render.test.jsx` produces a complete `Data` blob (one team, three priorities, history snapshot, archive entries) that's wrong on purpose to make filters/snooze testable. Extend it when you add a test that needs new fields — don't fork.

### Time-travel in tests

The webhook rate-limit + due-notification cron use `now` as a parameter so tests don't need real-time waits. For the React tick, use `vi.useFakeTimers().setSystemTime(...)` carefully — fake timers also block `Promise` microtasks which deadlocks the `window.storage` shim. Prefer spying on `Date.now` for tests that need a fixed wall clock + working async.

### Editing checklist (before declaring change done)

1. `npm test` — must stay green (225+).
2. `npm run typecheck` — clean.
3. Schema changed? Update `migrateTeamSettings` (idempotent + sanitizing). Update the data-shape `@typedef` in `status_tracker.jsx`. Add a regression test in `tests/migrate.test.js`.
4. New tab added? Add to nav array in `status_tracker.jsx`. Add a "renders without crashing" test. Add a section to `HelpView` (the in-app reference page).
5. New user-facing feature landed? Update `HelpView` and update this CLAUDE.md's feature → file map.
6. Server route added? Update server tests. The `/api/<path>` JSON-404 catch-all must still match every unhandled `/api/*`.
7. Smoke test prod container if you touched server, storage, or build:
   ```bash
   docker compose up -d --build
   curl -s -o /dev/null -w "health    %{http_code}\n" http://localhost:8384/health
   curl -s -o /dev/null -w "anon /me  %{http_code}\n" http://localhost:8384/api/me
   ```
   Expected: `200`, `401`.

---

## Invariants & rules (don't paper over)

### Storage / state
- Single user state JSON blob per row in `user_state(user_id, json)`. Server treats the body as opaque; schema lives client-side.
- **Last write wins per user.** Two tabs of the same user editing concurrently silently overwrite. Documented in README "Limitations" + the section above. Don't add silent retries that mask conflicts.
- Storage shim resolves `window.storage` (Claude artifacts) → `/api/state` → `localStorage` (offline). Always use the shim.
- Every API write mirrors to localStorage. Every API read overwrites localStorage. Schema-versioning bumps `STORAGE_KEY` only on breaking changes.

### React component contract
- Hooks-only. No class components anywhere. No state libraries (Redux/Zustand). `useState` + `update(fn)` is the contract.
- `updateTeam(fn)` is the team-scoped mutator. All CRUD on priorities/sub-tasks/notes/archive routes through it.
- `team` is `useMemo`-ed alias of `getActiveTeam(data)`. Always read `team.X`, never `data.X`.
- New top-level files only when the user asks. Edit in place.

### UI conventions
- Background `#f5f1e8` (warm paper). **Light mode only.** A dark-mode attempt was rolled back. Leftover `.dark` class + `localStorage["status_tracker_theme"]` are purged by a one-time effect in `StatusTracker`.
- Tailwind utility classes only — every class string must be a literal (no `bg-${color}-300` template strings — JIT purges them). Static maps like `PRIORITY_COLOR_CLASSES` are the right pattern.
- Chip-style filters use **amber active** (`bg-amber-100 text-amber-950 border-amber-700`), never pure black on the warm-paper bg.
- Touch targets ≥ 36×36 (one regression test in `tests/render.test.jsx`).
- Modals (`ShortcutsCheatsheet`, `TaskPanel`) trap focus via `useFocusTrap` and carry `role="dialog" aria-modal="true"`.
- Markdown: hand-rolled subset in `lib/markdown.js`. Pipeline is HTML-escape FIRST, then add tags. **That's the only XSS guard** — don't extend without keeping the escape-first ordering. Supported: `` `code` ``, `[text](url)`, bare URL auto-link, `**bold**`, `*italic*`, line breaks.

### Sort + status cascades
- `sortPriorityRows`: priority rank → status; done rows go to the end of the list. `holdOpenIds` Set keeps freshly-done rows in place for the 5s reorder hold.
- `setPriorityStatus(p, "done")` prompts when there are un-done sub-tasks; on confirm cascades DONE down. Confirm runs OUTSIDE the state updater so React StrictMode double-invocation doesn't double-prompt.
- `setItemStatus`: completing the last sub-task auto-promotes the parent. Reopening a sub-task while parent is DONE re-opens parent to BLOCKED (if newStatus === blocked) or WIP — never back to TODO.

### Webhooks (Chat)
- **Frontend never POSTs to `chat.googleapis.com` directly.** All Chat traffic goes through `POST /api/chat-post` → `forwardToChatPost` (server) which enforces URL allowlist (`^https://chat.googleapis.com/`) + per-user rate limit (5s min interval, 5/min, 100/day) + 10s upstream timeout.
- The same `forwardToChatPost` is used by the due-notification cron — keep the rate-limit invariants when refactoring it.
- Don't log webhook URLs (anyone with the URL can post). Log only `user=…`, byte length, upstream status.
- `connect-src 'self'` in CSP enforces no direct frontend Chat traffic. Adding new external hosts → extend CSP **and** the proxy allowlist.

### Snapshot / archive
- `rolloverTeam(team, today, retentionDays)` (`lib/snapshot.js`): captures yesterday's priorities under `history[lastSnapshotDate]`, then auto-archives rows DONE in two consecutive snapshots (~24-48h dwell). Both top-level priorities and sub-tasks archive — top-level get `parentId: null`, sub-tasks get the parent's id.
- Don't reduce dwell to a single rollover without confirming with the user — explicitly `>24h`.
- 5s done-hold sort is separate from this — it's display-only, doesn't affect the archive timing.

### Concurrent-edit risk
Last-write-wins per user. When changing the save path:
- Don't add silent retries that mask conflicts.
- Don't introduce optimistic concurrency without a user-facing UX for resolution.
- The README "Limitations" section IS the contract. Update both README and this file together if behavior changes.

### What NOT to add
- No new state libraries (Redux/Zustand/etc.).
- No new top-level files unless the user asks.
- No backend / sync / cloud code without explicit ask. Backups via host cron, not in-app.
- No emojis in source files. Diff-text intentionally uses `🚨 ➕ 🔄 ➖` because they render in Chat — keep those.
- No `git push --force`, `--no-verify`, or `git rebase -i` without explicit instruction.
- No `Co-Authored-By: Claude` trailers on commits. Commit author for THIS repo is **Sai Kiran** (`shekollasaikiran@gmail.com`) — set as repo-local git config since this is a personal OSS project under github.com/shekolla; the user's work identity (`saikiran@dexur.com`) stays default for other repos.
- Don't switch the markdown subset to a library or contenteditable without explicit ask — the hand-rolled version keeps the bundle small + the auditable HTML surface tiny.

---

## Server / Docker (short version)

- Express 5, better-sqlite3 12 (sync, WAL journal). Single replica. Login rate-limit + webhook rate-limit persist in SQLite (table `rate_limit`, scoped by `("login" | "webhook", key)`).
- Auth: bcryptjs cost 12, cookie-session (httpOnly, sameSite=lax, secure controlled by `COOKIE_SECURE`). Session signing key in env `SESSION_SECRET` or auto-generated + persisted in `kv` table.
- Bootstrap: empty `users` table + `BOOTSTRAP_ADMIN_USER`/`PASS` env → first user created. Once any user exists, the env vars are ignored.
- Container: `node:22-slim` runs as `node` UID 1000, read-only FS + `tmpfs:/tmp`, `cap_drop: ALL`. Healthcheck via inline `node -e fetch(...)`.
- `TZ` env var defaults to `Asia/Kolkata` in `docker-compose.yml`. Per-team override via `team.settings.tz` (whitelisted by `COMMON_TIMEZONES`).
- Due-notification cron: `setInterval(runDueNotificationScan, 60_000)` + hourly `pruneStaleDueNotifications(db, 90)`. `noNotifyCron: true` test option to skip the timer.
- Backups: `scripts/backup.sh` uses `db.backup()` (concurrent-write-safe). Cron-recipe documented in README "Backups". Required setup for any real deployment.

CSP: `connect-src 'self'`, `img-src 'self' data:`, allowlist for Google Fonts. Adding any new external host → extend CSP **and** webhook allowlist. Frontend never connects to anything outside `'self'` — even Chat goes via the proxy.

---

## Cross-tool conventions

- Commit style: `[Tag] message`. Tag from the touched area (`[Tracker]`, `[Server]`, `[Docs]`, `[Tests]`, `[Build]`, `[Refactor]`, etc.). One-line imperative subject. No body unless it actually adds something.
- Author: **Sai Kiran** `shekollasaikiran@gmail.com` (repo-local; verify with `git config user.email`). Don't add `Co-Authored-By: Claude` trailers.
- Auto mode active in this repo means execute, don't over-plan. Plan mode is for big architecture changes only.
- User prefers terse responses. Push back when you disagree — silent compliance is unhelpful. State results + decisions, don't narrate deliberation.
- Token-efficient context: this CLAUDE.md is the index. Use grep/read to dive deeper. Don't dump file contents into chat unless asked.
