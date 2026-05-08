<!--
  Thanks for the PR. Keep it scoped — one logical change per PR.
  Read CONTRIBUTING.md if you haven't yet.
-->

## Summary

<!-- 1–3 sentences. What changed and why. -->

## Linked issues

<!-- Closes #123, refs #456 -->

## Type

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor (no behavior change)
- [ ] Docs / build / CI
- [ ] Other:

## Test plan

<!-- Bulleted checklist. Manual + automated. -->

- [ ] `npm test` passes (225+ tests stay green)
- [ ] `npm run typecheck` clean
- [ ] `npm run build` succeeds
- [ ] Smoke-tested in `docker compose up -d --build` (if server, build, or storage touched)

## Checklist

- [ ] Subject follows `[Tag] message` style
- [ ] No `Co-Authored-By: Claude` trailer
- [ ] No new top-level files unless discussed
- [ ] Schema change → `migrateTeamSettings` updated + idempotency test added
- [ ] New tab/view → "renders without crashing" test in `tests/render.test.jsx`
- [ ] User-visible feature → `HelpView` + CLAUDE.md feature map updated
- [ ] No direct frontend POSTs to `chat.googleapis.com` (must go via `/api/chat-post`)
- [ ] No template-string Tailwind class names (use static maps)
