// Shared pure utilities. No React, no DOM, no fetch — safe to import from
// anywhere (including Node tests).

export const uid = () => Math.random().toString(36).slice(2, 10);

export const formatDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const today = () => formatDate(new Date());

export const nowIso = () => new Date().toISOString();

export const fmtTimestamp = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return formatDate(d);
};

// ----- due dates -----
// Stored as a `YYYY-MM-DD` string (or null). "Due" means "by end of that day"
// in the user's local timezone — i.e. the bucket flips from `today` to
// `overdue` at local midnight. Time-of-day precision is intentionally absent;
// add it later only if asked.
const DUE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDueDate(s) {
  if (!s || typeof s !== "string" || !DUE_DATE_RE.test(s)) return null;
  // End-of-day local: 23:59:59.999 on the given date
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d, 23, 59, 59, 999);
  if (isNaN(dt.getTime())) return null;
  return dt;
}

// Bucket the row into one of: overdue, today, soon (≤6 days), later, none.
// `done` (or any unknown status) collapses to "none" so finished work never
// shows as overdue.
export function dueBucket(dueAt, status, now = new Date()) {
  if (!dueAt) return "none";
  if (status === "done") return "none";
  const due = parseDueDate(dueAt);
  if (!due) return "none";
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfToday   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate(), 0, 0, 0, 0);
  if (due.getTime() < startOfToday.getTime()) return "overdue";
  if (dueDay.getTime() === startOfToday.getTime()) return "today";
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((dueDay.getTime() - startOfToday.getTime()) / dayMs);
  if (diffDays <= 6) return "soon";
  return "later";
}

export function formatDueRelative(dueAt, now = new Date(), status = null) {
  if (!dueAt) return "";
  const due = parseDueDate(dueAt);
  if (!due) return "";
  // Done rows: drop the "overdue / due today" framing — the work is closed
  // and we don't want to keep nagging. Show a neutral date instead so the
  // user can still see *when* it was meant to land (useful for retros).
  if (status === "done") return `due ${dueAt}`;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate(), 0, 0, 0, 0);
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((dueDay.getTime() - startOfToday.getTime()) / dayMs);
  if (diffDays === 0)  return "due today";
  if (diffDays === 1)  return "due tomorrow";
  if (diffDays === -1) return "1d overdue";
  if (diffDays < 0)    return `${-diffDays}d overdue`;
  if (diffDays <= 6)   return `due in ${diffDays}d`;
  return `due ${dueAt}`;
}

// Snooze hides a row from the Today list until the given date passes. Stored
// as YYYY-MM-DD (or null). isSnoozed returns true while today is on or
// before the snooze date — i.e. "snooze until Friday" hides the row through
// Friday and surfaces it again on Saturday morning.
export function isSnoozed(row, todayStr = null) {
  if (!row || typeof row !== "object") return false;
  const until = row.snoozedUntil;
  if (!until || typeof until !== "string") return false;
  const t = todayStr || (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  // Lexicographic compare works because both strings are YYYY-MM-DD.
  return until >= t;
}

// True iff a row crossed its due moment in the last `windowMs` and is not done.
// Used by the notification tick to find rows worth pinging right now without
// re-firing for tasks the user already missed by hours/days.
export function isDueNotifiable(dueAt, status, now = new Date(), windowMs = 60 * 60 * 1000) {
  if (!dueAt || status === "done") return false;
  const due = parseDueDate(dueAt);
  if (!due) return false;
  const t = now.getTime();
  return due.getTime() <= t && t - due.getTime() <= windowMs;
}

// Free-text assignee parsed as comma-separated names. Storage stays a single
// string so old data round-trips; we only split for render + filter.
export function parseAssignees(s) {
  if (!s || typeof s !== "string") return [];
  return s.split(",").map(t => t.trim()).filter(Boolean);
}

// applyTimestamped layers createdAt/assignedAt/doneAt on top of incoming
// `fields` using the `existing` record's prior values to detect transitions.
// Pure function (uses nowIso() but otherwise no side effects).
export function applyTimestamped(existing, fields) {
  const out = { ...fields };
  if (Object.prototype.hasOwnProperty.call(out, "assignee")) {
    const newAssignee = (out.assignee || "").trim();
    const oldAssignee = (existing.assignee || "").trim();
    out.assignee = newAssignee;
    if (newAssignee && newAssignee !== oldAssignee) out.assignedAt = nowIso();
    if (!newAssignee && oldAssignee) out.assignedAt = null;
  }
  if (Object.prototype.hasOwnProperty.call(out, "status")) {
    if (out.status === "done" && existing.status !== "done") out.doneAt = nowIso();
    if (out.status !== "done" && existing.status === "done") out.doneAt = null;
  }
  return out;
}

export function collectTeamAssignees(team) {
  if (!team) return [];
  const seen = new Set();
  const out = [];
  const add = (s) => {
    for (const n of parseAssignees(s)) {
      const k = n.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(n);
    }
  };
  for (const p of (team.priorities || [])) {
    add(p.assignee);
    for (const it of (p.items || [])) add(it.assignee);
  }
  return out;
}

export function filterMentionMatches(suggestions, query) {
  const q = (query || "").toLowerCase();
  const seen = new Set();
  const out = [];
  for (const s of suggestions) {
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    if (!q || k.startsWith(q) || k.includes(q)) out.push(s);
  }
  return out;
}
