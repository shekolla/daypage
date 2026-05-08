// Pure helpers for due-date notification dispatch. No React, no DOM, no
// fetch. Used by the client tick (status_tracker.jsx) and the server cron
// (server/notify.js) to decide *when* to ping and *what* to say.

const HOUR_MS = 60 * 60 * 1000;

// Convert YYYY-MM-DD into the UTC ms for end-of-day in `tz`. When `tz`
// is empty, falls back to the runner's local time — matches both the
// browser-local view and the server container's TZ env var.
//
// Approach: ask Intl what the named tz's offset is at noon-UTC of that
// day, then build an ISO string with that offset and let Date.parse do
// the math. Robust across DST and non-half-hour offsets like Kolkata.
export function endOfDayMs(yyyymmdd, tz) {
  if (!yyyymmdd || typeof yyyymmdd !== "string") return NaN;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyymmdd);
  if (!m) return NaN;
  const [, y, mo, d] = m;
  if (!tz) {
    return new Date(+y, +mo - 1, +d, 23, 59, 59, 999).getTime();
  }
  try {
    const probe = new Date(Date.UTC(+y, +mo - 1, +d, 12, 0, 0));
    const fmt = new Intl.DateTimeFormat("en", { timeZone: tz, timeZoneName: "longOffset" });
    const parts = fmt.formatToParts(probe);
    const tzName = parts.find((p) => p.type === "timeZoneName")?.value || "GMT+00:00";
    const off = /GMT([+-−])(\d{2}):(\d{2})/.exec(tzName);
    if (!off) return new Date(`${yyyymmdd}T23:59:59.999Z`).getTime();
    const sign = off[1] === "-" || off[1] === "−" ? "-" : "+";
    const iso = `${yyyymmdd}T23:59:59.999${sign}${off[2]}:${off[3]}`;
    return new Date(iso).getTime();
  } catch {
    // Unknown tz / Intl unavailable → safe fallback.
    return new Date(+y, +mo - 1, +d, 23, 59, 59, 999).getTime();
  }
}

// Decide whether to send a notification for a single row at this tick.
// Returns "first" | "nag" | null. `tz` is optional — empty string means
// "use the runner's local time" (browser local in the React tick, the
// container's TZ env in the server cron).
export function shouldPing({ row, now, lastSentAt, nagOverdue, nagIntervalHours, tz = "" }) {
  if (!row) return null;
  if (row.status === "done") return null;
  if (!isOverdue(row.dueAt, now, tz)) return null;
  if (!lastSentAt) return "first";
  if (!nagOverdue) return null;
  const lastMs = new Date(lastSentAt).getTime();
  if (isNaN(lastMs)) return "first";
  const interval = Math.max(1, +nagIntervalHours || 4) * HOUR_MS;
  if (now.getTime() - lastMs >= interval) return "nag";
  return null;
}

// A row is overdue when *now* is past the end of its dueAt day in the
// chosen timezone. `tz=""` falls back to runner's local time.
function isOverdue(dueAt, now, tz = "") {
  const eod = endOfDayMs(dueAt, tz);
  if (!Number.isFinite(eod)) return false;
  return now.getTime() > eod;
}

// Build the combined Chat message body. `kind="nag"` swaps "items due"
// for "items still overdue".
export function buildDueNotificationMessage(rows, teamName, kind = "first") {
  if (!Array.isArray(rows) || rows.length === 0) return "";
  const verb = kind === "nag" ? "still overdue" : "due";
  const headline = `*${rows.length} item${rows.length === 1 ? "" : "s"} ${verb}*${teamName ? ` — ${teamName}` : ""}`;
  const bullets = rows.map((r) => {
    const titleText = r.title || "(untitled)";
    const linked = r.ticket ? `[${titleText}](${r.ticket})` : titleText;
    const tags = [];
    if (r.priorityLabel) tags.push(r.priorityLabel);
    if (r.parentTitle) tags.push(`under: ${r.parentTitle}`);
    if (r.dueAt) tags.push(`due ${r.dueAt}`);
    const suffix = tags.length > 0 ? ` — ${tags.join(" · ")}` : "";
    return `• ${linked}${suffix}`;
  });
  // Chat caps message bodies near 4096 chars. Truncate with `…and N more`
  // so a huge backlog doesn't drop the whole post.
  const HARD_LIMIT = 3800;
  const lines = [headline, ...bullets];
  let total = lines.join("\n").length;
  if (total > HARD_LIMIT) {
    const kept = [headline];
    let acc = headline.length;
    let truncated = 0;
    for (const b of bullets) {
      if (acc + b.length + 1 > HARD_LIMIT - 32) { truncated += 1; continue; }
      kept.push(b);
      acc += b.length + 1;
    }
    if (truncated > 0) kept.push(`• …and ${truncated} more`);
    return kept.join("\n");
  }
  return lines.join("\n");
}

// Walk a team and return the open rows whose dueAt is past *now*. Caller
// decides which ones to actually ping based on dedupe state. Sub-tasks
// come back with parentTitle set. `tz` defaults to team.settings.tz so
// callers can omit it.
export function collectOverdueRows(team, now, priorityList, tz) {
  const out = [];
  if (!team) return out;
  const effectiveTz = tz != null ? tz : (team.settings?.tz || "");
  for (const p of (team.priorities || [])) {
    if (!p) continue;
    if (isOverdue(p.dueAt, now, effectiveTz) && p.status !== "done") {
      out.push({
        id: p.id,
        title: p.title,
        dueAt: p.dueAt,
        status: p.status,
        ticket: p.ticket || "",
        priorityLabel: priorityLabelFor(p.priority, priorityList),
        parentTitle: null,
        kind: "priority",
      });
    }
    for (const it of (p.items || [])) {
      if (!it) continue;
      if (isOverdue(it.dueAt, now, effectiveTz) && it.status !== "done") {
        out.push({
          id: it.id,
          title: it.title,
          dueAt: it.dueAt,
          status: it.status,
          ticket: it.ticket || "",
          priorityLabel: null,
          parentTitle: p.title || "",
          kind: "item",
        });
      }
    }
  }
  return out;
}

function priorityLabelFor(key, priorityList) {
  if (!key || key === "normal") return null;
  if (!Array.isArray(priorityList)) return key.toUpperCase();
  const def = priorityList.find((p) => p.key === key);
  return def?.label || key.toUpperCase();
}
