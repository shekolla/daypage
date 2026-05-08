# Contributing to daypage

Thanks for taking the time. daypage is a small, opinionated tool — most contributions land best when they fit the existing shape rather than expand it. Please read this whole file before opening a non-trivial PR.

## TL;DR

- **Bugs:** open an issue with reproduction steps. PR welcome.
- **Small features:** open an issue first to discuss scope. Then PR.
- **Big features / new abstractions:** open a discussion before writing code. The bar is "would I want this on by default in my own daily use?"
- **Style / refactor PRs:** generally not accepted unless they fix a real readability or correctness problem.

## Local dev

```bash
# Clone and install
git clone https://github.com/shekolla/daypage
cd daypage
npm install
(cd scaffold && npm install)
(cd server && npm install)

# Run the test suite (Vitest 4)
npm test                 # all unit + server + render tests
npm run test:watch       # re-run on change
npm run typecheck        # tsc --noEmit over server JSDoc
npm run build            # builds the production bundle

# Run the dev frontend (Vite HMR, no backend)
docker compose -f docker-compose.dev.yml up

# Run the full prod stack locally
cp .env.example .env
docker compose up -d --build
# → http://localhost:8384
```

## Architecture in 60 seconds

Read [`CLAUDE.md`](./CLAUDE.md) — that's the index. It has:

- The file-tree map (where everything lives)
- A **Feature → file map** (which file owns each feature)
- **Common debug paths** (symptom → likely files)
- Test setup + the `mountTracker` pattern
- Invariants you must not break (storage shape, sort rules, webhook chokepoint, etc.)

If you skip CLAUDE.md and start grepping, you'll spend 10× more time finding things.

## Commit style

```
[Tag] short imperative message
```

- **Tag** = functional area. Reuse one from `git log --oneline -50`. Common tags: `[Tracker]`, `[Server]`, `[Refactor]`, `[Tests]`, `[Build]`, `[Docs]`, `[Bug]`, `[Repo]`, `[Insights]`, `[Priority]`.
- **Message** = imperative, sentence case, under 70 chars, no period. ✅ "Fix snooze gate when filter is empty" — ❌ "Updated tests and added docs and fixed bug".
- **No `Co-Authored-By:` trailers.** Authorship belongs to the human who wrote the change.
- **Never** force-push, `--no-verify`, or `git rebase -i` shared branches. If a hook fails, fix the underlying issue.

## Test discipline

Every change should ship with a test if there's a sensible one.

| Kind | Where | When |
|---|---|---|
| Pure helper change in `lib/` | `tests/<name>.test.js` | Always — pure helpers are easy to test |
| New tab / view component | `tests/render.test.jsx` "renders without crashing" test | **Required** — this catches the out-of-scope-variable class of bug |
| New server endpoint | `server/tests/<name>.test.js` via Supertest | Always |
| New schema field | `tests/migrate.test.js` (idempotency + sanitization) | Always — migration is forever |
| UI tweak (colors, layout) | Skip if behavior unchanged; smoke-test manually | OK to skip |

Tests must stay green at every commit. CI runs `npm test` + `npm run typecheck` + `npm run build`.

## What we won't merge (no exceptions)

- **A new state library.** No Redux, Zustand, Jotai, etc. `useState` + `update(fn)` is the contract.
- **A markdown library or contenteditable swap.** The hand-rolled subset in `lib/markdown.js` is intentional — it keeps the auditable HTML surface tiny and the bundle small. The escape-first pipeline is the only XSS guard.
- **Direct frontend POSTs to `chat.googleapis.com`.** Every Chat post must go through the `/api/chat-post` proxy. The URL allowlist + per-user rate limit are security-critical chokepoints.
- **Optimistic concurrency / silent retries on `/api/state`.** Last-write-wins is a documented limitation. See [README "Limitations"](./README.md) and CLAUDE.md "Concurrent-edit risk" — don't paper over.
- **Class strings built from template literals.** Tailwind 4 JIT only picks up literal class strings; `bg-${color}-300` gets purged. Use a static map (see `lib/priority.js:PRIORITY_COLOR_CLASSES`).
- **Emojis in source files.** The diff text uses a few intentionally because they render in Chat — that's the only exception.

## What we like

- Bug fixes with a test that fails before the fix and passes after.
- Performance improvements with measurable numbers.
- Documentation tightening — CLAUDE.md / README accuracy.
- Migration safety improvements (`migrateTeamSettings` regression tests).
- New touch-target / a11y fixes that respect the existing 36 px floor.

## What we'd discuss before merging

- New top-level features (a new tab, a new stat, a new export format). Open an issue first — let's talk about whether it's part of the product.
- Backend additions (Postgres support, OAuth, etc.). The single-replica SQLite design is intentional. A real case can change minds, but not casually.
- Major dep upgrades (e.g. React 20, Tailwind 5 when those ship). Worth testing carefully across the bind-mount + HMR + CSS-first pipeline before landing.

## Releasing (maintainer notes)

```bash
# 1. Bump version in root + scaffold + server package.json
# 2. Tag and push
git tag v1.2.0
git push origin v1.2.0
# → GitHub Action `release.yml` builds + pushes ghcr.io/shekolla/daypage:v1.2.0
```

CHANGELOG.md isn't maintained yet — the git tag list is the changelog. If we get more contributors we'll add one.

## Code of conduct

Be decent. Disagreements about technical choices are fine; insults aren't. If something feels off, email the maintainer (`shekollasaikiran@gmail.com`) and we'll sort it out without ceremony.

## Questions

Open a [discussion](https://github.com/shekolla/daypage/discussions) or an issue. Don't email maintainers about non-security questions — discussions are public for a reason.
