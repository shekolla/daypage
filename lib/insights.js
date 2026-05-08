// Pure helpers powering the Insights tab. No React, no DOM. Operates on
// the same data shape as the rest of the app — every input is plain JSON.
//
// Window math is rolling-N-days, not ISO calendar weeks/months. That keeps
// the velocity strip uniformly populated regardless of when in the week
// the user opens the tab; "this week" never looks empty on a Monday.

import { formatDate, parseAssignees } from "./util.js";
import { priorityRank, sortedPriorities, resolvePriorityDef } from "./priority.js";

// Flatten every row a team owns into a single array. Each row gets a
// `kind` discriminator so callers can decide whether to attribute it to
// "created" (active rows only) or "closed" (active doneAt + archive
// archivedDate, deduped by id later).
export function collectAllRows(team) {
  if (!team || typeof team !== "object") return [];
  const rows = [];
  for (const p of (team.priorities || [])) {
    if (!p) continue;
    rows.push({
      id: p.id,
      title: p.title || "",
      status: p.status || "not_started",
      priority: p.priority || null,
      type: p.type || "",
      assignee: p.assignee || "",
      createdAt: p.createdAt || null,
      doneAt: p.doneAt || null,
      archivedDate: null,
      kind: "priority",
    });
    for (const it of (p.items || [])) {
      if (!it) continue;
      rows.push({
        id: it.id,
        title: it.title || "",
        status: it.status || "not_started",
        priority: null,
        type: it.type || "",
        assignee: it.assignee || "",
        createdAt: it.createdAt || null,
        doneAt: it.doneAt || null,
        archivedDate: null,
        kind: "item",
      });
    }
  }
  for (const a of (team.archive || [])) {
    if (!a) continue;
    rows.push({
      id: a.id,
      title: a.title || "",
      status: a.status || "done",
      priority: a.priority || null,
      type: a.type || "",
      assignee: a.assignee || "",
      createdAt: a.createdAt || null,
      doneAt: a.doneAt || null,
      archivedDate: a.archivedDate || null,
      kind: "archived",
    });
  }
  return rows;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function shiftDate(todayStr, deltaDays) {
  const [y, m, d] = todayStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setTime(dt.getTime() + deltaDays * DAY_MS);
  return formatDate(dt);
}

export function windowRange(window, todayStr) {
  switch (window) {
    case "today":   return { start: todayStr,             end: todayStr };
    case "week":    return { start: shiftDate(todayStr, -6),  end: todayStr };
    case "2weeks":  return { start: shiftDate(todayStr, -13), end: todayStr };
    case "month":   return { start: shiftDate(todayStr, -29), end: todayStr };
    default:        return { start: shiftDate(todayStr, -6),  end: todayStr };
  }
}

export function inRange(dateStr, range) {
  if (!dateStr || !range) return false;
  return dateStr >= range.start && dateStr <= range.end;
}

function isoToDate(iso) {
  if (!iso || typeof iso !== "string") return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return formatDate(d);
}

// Hero metrics. `closed` unions active doneAt + archived archivedDate
// and dedupes by id (a row currently `done` AND `archived` can exist
// briefly during the rollover; counting twice would be wrong).
//
// Snooze is intentionally NOT considered: snooze hides from Today, but
// for load/overload analysis the work still exists.
export function summaryFor(rows, range, priorityList) {
  let created = 0;
  let openTotal = 0;
  let openTopUrgency = 0;
  const closedIds = new Set();
  const openByAssignee = new Map();

  for (const r of rows) {
    if (r.kind !== "archived") {
      const cDate = isoToDate(r.createdAt);
      if (cDate && inRange(cDate, range)) created += 1;
      if (r.status !== "done") {
        openTotal += 1;
        if (r.kind === "priority") {
          const rank = priorityRank(r.priority, priorityList);
          if (rank <= 1) openTopUrgency += 1;
        }
        const names = parseAssignees(r.assignee);
        if (names.length === 0) {
          openByAssignee.set("Unassigned", (openByAssignee.get("Unassigned") || 0) + 1);
        } else {
          for (const name of names) {
            openByAssignee.set(name, (openByAssignee.get(name) || 0) + 1);
          }
        }
      }
      const dDate = isoToDate(r.doneAt);
      if (dDate && inRange(dDate, range) && r.status === "done") closedIds.add(r.id);
    } else {
      if (inRange(r.archivedDate, range)) closedIds.add(r.id);
    }
  }

  const perAssigneeTopline = [...openByAssignee.entries()]
    .filter(([n]) => n !== "Unassigned")
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([name, open]) => ({ name, open }));

  return { created, closed: closedIds.size, openTopUrgency, openTotal, perAssigneeTopline };
}

function enumerateDates(range) {
  const out = [];
  let cursor = range.start;
  // Lexicographic compare on YYYY-MM-DD is stable.
  while (cursor <= range.end) {
    out.push(cursor);
    cursor = shiftDate(cursor, 1);
  }
  return out;
}

export function velocityByDay(rows, range) {
  const buckets = new Map();
  for (const date of enumerateDates(range)) {
    buckets.set(date, { date, created: 0, closed: 0 });
  }
  const counted = new Set();
  for (const r of rows) {
    if (r.kind !== "archived") {
      const cDate = isoToDate(r.createdAt);
      if (cDate && buckets.has(cDate)) buckets.get(cDate).created += 1;
      const dDate = isoToDate(r.doneAt);
      if (dDate && buckets.has(dDate) && r.status === "done") {
        buckets.get(dDate).closed += 1;
        counted.add(r.id);
      }
    } else {
      if (counted.has(r.id)) continue;
      if (buckets.has(r.archivedDate)) {
        buckets.get(r.archivedDate).closed += 1;
        counted.add(r.id);
      }
    }
  }
  return [...buckets.values()];
}

// Pivot by person. `wip`/`blocked` are instantaneous load (ignore window);
// `done` is closed-within-window so the user sees what each person shipped.
export function assigneePivot(rows, range, priorityList) {
  const sortedDefs = sortedPriorities(priorityList);
  const skeleton = () => Object.fromEntries(sortedDefs.map(d => [d.key, { wip: 0, blocked: 0, done: 0 }]));
  // unknown bucket for stale priority keys
  const ensureBucket = (b, key) => {
    if (!b[key]) b[key] = { wip: 0, blocked: 0, done: 0 };
    return b[key];
  };
  const byName = new Map();

  const upsert = (name) => {
    if (!byName.has(name)) byName.set(name, { name, total: 0, byPriorityStatus: skeleton() });
    return byName.get(name);
  };

  const closedIds = new Set();

  // First pass: archived rows contribute to "done" within range.
  for (const r of rows) {
    if (r.kind !== "archived") continue;
    if (!inRange(r.archivedDate, range)) continue;
    const def = resolvePriorityDef(r.priority, priorityList);
    const key = def.unknown ? "__unknown__" : def.key;
    const names = parseAssignees(r.assignee);
    const targets = names.length === 0 ? ["Unassigned"] : names;
    for (const name of targets) {
      const entry = upsert(name);
      ensureBucket(entry.byPriorityStatus, key).done += 1;
      entry.total += 1;
    }
    closedIds.add(r.id);
  }

  // Second pass: active rows. Top-level priorities count toward WIP/BLOCKED
  // (instantaneous load) and DONE (within range). Sub-tasks have no
  // priority field, so they bucket under __unknown__.
  for (const r of rows) {
    if (r.kind === "archived") continue;
    if (closedIds.has(r.id)) continue;
    const def = resolvePriorityDef(r.priority, priorityList);
    const key = def.unknown ? "__unknown__" : def.key;
    const names = parseAssignees(r.assignee);
    const targets = names.length === 0 ? ["Unassigned"] : names;

    if (r.status === "wip") {
      for (const name of targets) {
        const entry = upsert(name);
        ensureBucket(entry.byPriorityStatus, key).wip += 1;
        entry.total += 1;
      }
    } else if (r.status === "blocked") {
      for (const name of targets) {
        const entry = upsert(name);
        ensureBucket(entry.byPriorityStatus, key).blocked += 1;
        entry.total += 1;
      }
    } else if (r.status === "done") {
      const dDate = isoToDate(r.doneAt);
      if (dDate && inRange(dDate, range)) {
        for (const name of targets) {
          const entry = upsert(name);
          ensureBucket(entry.byPriorityStatus, key).done += 1;
          entry.total += 1;
        }
      }
    }
  }

  const out = [...byName.values()].sort((a, b) => {
    if (a.name === "Unassigned") return 1;
    if (b.name === "Unassigned") return -1;
    if (b.total !== a.total) return b.total - a.total;
    return a.name.localeCompare(b.name);
  });
  return out;
}
