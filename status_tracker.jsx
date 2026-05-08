import { useState, useEffect, useRef, useMemo } from "react";
import {
  Plus, X, ChevronRight, ChevronDown, Trash2, Send, Calendar,
  GitCompare, RotateCcw, ArrowRight, Sparkles, LogOut,
  Settings as SettingsIcon, Archive as ArchiveIcon, Users as UsersIcon,
  History as HistoryIcon, FileText, Loader2, CheckCircle2, Clock, HelpCircle,
} from "lucide-react";

import {
  uid, formatDate, today, nowIso, fmtTimestamp,
  parseAssignees, applyTimestamped, collectTeamAssignees, filterMentionMatches,
  dueBucket, formatDueRelative, isDueNotifiable, isSnoozed,
} from "./lib/util.js";
import { sortByStatus, sortPriorityRows } from "./lib/sort.js";
import { renderMarkdown } from "./lib/markdown.js";
import {
  newTeam, createDefaultData, migrate, getActiveTeam, getActiveWebhookUrl,
  buildExampleTeam,
} from "./lib/migrate.js";
import { diffPriorities, diffIsEmpty, buildDiffText } from "./lib/diff.js";
import {
  inferLinkLabel, inferLinkIcon, exportLinkSummary, buildExport, buildMarkdownExport,
} from "./lib/export.js";
import { storage, postToChat } from "./lib/api.js";
import { rolloverTeam } from "./lib/snapshot.js";
import {
  resolvePriorityDef,
  isTopUrgency,
  sortedPriorities as sortedPriorityList,
  priorityColorClasses,
} from "./lib/priority.js";
import { TW_PRIORITY_PALETTE } from "./lib/constants.js";
import {
  collectAllRows,
  windowRange,
  summaryFor,
  velocityByDay,
  assigneePivot,
} from "./lib/insights.js";
import {
  collectOverdueRows,
  shouldPing,
  buildDueNotificationMessage,
} from "./lib/notify.js";

// Component primitives + view bodies live in ./components/. Each file is
// self-contained and importable by tests directly. status_tracker.jsx is
// the shell — owns state, effects, mutator handlers, and the per-view
// JSX glue.
import {
  STATUSES,
  Editable, MarkdownText, MarkdownEditor,
  StatusPill, PriorityPill, TicketField, LinksField,
  AssigneeField, DueField, SnoozeField, RowMeta, TypeField,
} from "./components/fields.jsx";
import { FilterBar, SavedFiltersBar } from "./components/today.jsx";
import {
  HelpView, HistoryView, InsightsView, DiffSection,
} from "./components/views.jsx";
import {
  TaskPanel, ShortcutsCheatsheet, UndoToast, ExportMenu,
  PrioritiesEditor, SettingsView,
} from "./components/dialogs.jsx";

const STORAGE_KEY = "status_tracker_v3";
const HISTORY_RETENTION_DAYS = 30;

/**
 * Shared data shapes. Documentation-only — `tsc --noEmit` does not check this
 * file; see tsconfig.json. Kept here so editors can surface autocomplete and
 * future refactors have a single source of truth.
 *
 * @typedef {"not_started" | "wip" | "blocked" | "done"} Status
 * @typedef {"normal" | "p1" | "p2" | "p3"} PriorityTag
 *
 * @typedef {{ id: string, label: string, url: string }} LinkRef
 * @typedef {{ id: string, content: string, date: string }} Note
 *
 * @typedef Item
 * @property {string} id
 * @property {string} title
 * @property {Status} status
 * @property {string} [ticket]
 * @property {LinkRef[]} [links]
 * @property {string} [assignee]
 * @property {string} [type]
 * @property {string} [description]
 * @property {string} [createdAt]
 * @property {string|null} [assignedAt]
 * @property {string|null} [doneAt]
 * @property {string|null} [dueAt]
 * @property {Note[]} notes
 *
 * @typedef Priority
 * @property {string} id
 * @property {string} title
 * @property {Status} status
 * @property {PriorityTag} priority
 * @property {string} [ticket]
 * @property {LinkRef[]} [links]
 * @property {string} [assignee]
 * @property {string} [type]
 * @property {string} [description]
 * @property {string} [createdAt]
 * @property {string|null} [assignedAt]
 * @property {string|null} [doneAt]
 * @property {string|null} [dueAt]
 * @property {Item[]} items
 *
 * @typedef {Item & { archivedDate: string, parentTitle: string, parentId: string }} ArchivedItem
 *
 * @typedef Webhook
 * @property {string} id
 * @property {string} name
 * @property {string} url
 *
 * @typedef Settings
 * @property {Webhook[]} webhooks
 * @property {string|null} activeWebhookId
 * @property {boolean} autoPostEnabled
 * @property {number} autoPostHour
 * @property {number} autoPostMinute
 * @property {string|null} lastAutoPostDate
 * @property {string[]} workTypes
 *
 * @typedef Team
 * @property {string} id
 * @property {string} name
 * @property {string} title
 * @property {string} subtitle
 * @property {Priority[]} priorities
 * @property {Object<string, Priority[]>} history
 * @property {ArchivedItem[]} archive
 * @property {string|null} lastSnapshotDate
 * @property {Settings} settings
 *
 * @typedef Data
 * @property {Team[]} teams
 * @property {string} activeTeamId
 */

const yesterday = () => {
  const d = new Date(); d.setDate(d.getDate() - 1); return formatDate(d);
};

const DEFAULT_DATA = createDefaultData();

// =====================  MAIN  =====================
export default function StatusTracker({ user = null, onLogout = null } = {}) {
  const [data, setData] = useState(DEFAULT_DATA);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(new Set());
  const [view, setView] = useState("today");
  const [panelTask, setPanelTask] = useState(null); // { pid, iid: string|null } | null
  const [historyDate, setHistoryDate] = useState(yesterday());
  const [copyState, setCopyState] = useState(null);
  const [postState, setPostState] = useState(null);
  const [focusedRowId, setFocusedRowId] = useState(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [insightsWindow, setInsightsWindow] = useState("week");
  const toastTimersRef = useRef(new Map());
  const searchInputRef = useRef(null);

  // When a row flips to DONE we hold it in its open-group sort position
  // for a few seconds. Prevents the row from sliding to the bottom the
  // instant the user (or a teammate watching the screen) ticks the
  // checkbox — the visible "I just marked X done" beat is preserved
  // before the auto-reorder happens.
  const HOLD_DONE_MS = 5000;
  const [heldDoneIds, setHeldDoneIds] = useState(() => new Set());
  const heldDoneTimersRef = useRef(new Map());
  const holdDone = (id) => {
    setHeldDoneIds(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    const old = heldDoneTimersRef.current.get(id);
    if (old) clearTimeout(old);
    const timer = setTimeout(() => {
      setHeldDoneIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      heldDoneTimersRef.current.delete(id);
    }, HOLD_DONE_MS);
    heldDoneTimersRef.current.set(id, timer);
  };
  const releaseHold = (id) => {
    const timer = heldDoneTimersRef.current.get(id);
    if (timer) clearTimeout(timer);
    heldDoneTimersRef.current.delete(id);
    setHeldDoneIds(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  // One-time cleanup for users who toggled the (now-removed) dark mode in
  // an earlier build. Drops the .dark class + the persisted theme key so
  // the page renders light immediately without a flicker.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.remove("dark");
    try { window.localStorage.removeItem("status_tracker_theme"); } catch {}
  }, []);
  // Sync guard against double-fire of webhook posts. State-based disabled
  // props are async and do not block rapid clicks within a single tick;
  // a ref check runs synchronously before the fetch is issued.
  const postingRef = useRef(false);

  // Mirror of `data` for setInterval callbacks. The auto-post tick runs
  // on a 60s timer; without this, its closure would capture a stale
  // lastAutoPostDate and re-fire every minute even after a successful post.
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  // fonts
  useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=JetBrains+Mono:wght@400;500;600&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }, []);

  // load (with one-time v2 → v3 import if v3 is empty)
  useEffect(() => {
    (async () => {
      try {
        const v3 = await storage.get(STORAGE_KEY);
        if (v3?.value) {
          setData(migrate(JSON.parse(v3.value)));
        } else {
          const v2 = await storage.get("status_tracker_v2");
          if (v2?.value) setData(migrate(JSON.parse(v2.value)));
        }
      } catch (e) { /* fresh start */ }
      setLoading(false);
    })();
  }, []);

  // save (debounced)
  useEffect(() => {
    if (loading) return;
    const t = setTimeout(() => {
      storage.set(STORAGE_KEY, JSON.stringify(data)).catch(console.error);
    }, 500);
    return () => clearTimeout(t);
  }, [data, loading]);

  const update = (fn) => setData(prev => {
    const copy = JSON.parse(JSON.stringify(prev));
    fn(copy);
    return copy;
  });

  // active team — single source of truth for everything below
  const team = useMemo(() => getActiveTeam(data) || data.teams?.[0], [data]);

  const updateTeam = (fn) => update(d => {
    const t = d.teams.find(x => x.id === d.activeTeamId) || d.teams[0];
    if (t) fn(t);
  });

  // ----- team management -----
  // Capture prompt() / alert() side-effects OUTSIDE the setState updater.
  // React 18 StrictMode double-invokes updaters in dev, so any `prompt`
  // or `alert` reachable from the updater would fire twice.
  const addTeam = (suggestedName) => {
    const fallbackName = `Team ${data.teams.length + 1}`;
    const raw = suggestedName ?? prompt("Team name", fallbackName);
    const name = (raw || "").trim();
    if (!name) return;
    if (data.teams.some(t => t.name.toLowerCase() === name.toLowerCase())) {
      alert(`A team named "${name}" already exists.`);
      return;
    }
    update(d => {
      const t = newTeam(name);
      d.teams.push(t);
      d.activeTeamId = t.id;
    });
  };

  const renameTeam = (id, name) => {
    const trimmed = (name || "").trim();
    if (!trimmed) return;
    if (data.teams.some(x => x.id !== id && x.name.toLowerCase() === trimmed.toLowerCase())) {
      alert(`A team named "${trimmed}" already exists.`);
      return;
    }
    update(d => {
      const t = d.teams.find(x => x.id === id);
      if (t) t.name = trimmed;
    });
  };

  const deleteTeam = (id) => {
    const target = data.teams.find(t => t.id === id);
    if (!target) return;
    if (data.teams.length <= 1) {
      alert("Cannot delete the only team. Add another team first, or rename this one.");
      return;
    }
    if (!confirm(`Delete team "${target.name}" and all of its priorities, archive, and history? This cannot be undone.`)) {
      return;
    }
    update(d => {
      d.teams = d.teams.filter(t => t.id !== id);
      if (d.activeTeamId === id) d.activeTeamId = d.teams[0].id;
    });
  };

  const switchTeam = (id) => update(d => {
    if (d.teams.find(t => t.id === id)) d.activeTeamId = id;
  });

  // snapshot on day-change + auto-archive done>24h. Runs for every team
  // so a team you haven't opened today still rolls over its history.
  useEffect(() => {
    if (loading) return;
    const t = today();
    let needsUpdate = false;
    for (const tm of data.teams) {
      if (tm.lastSnapshotDate !== t) { needsUpdate = true; break; }
    }
    if (!needsUpdate) return;

    update(d => {
      for (const tm of d.teams) {
        rolloverTeam(tm, t, HISTORY_RETENTION_DAYS);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, data.teams.map(t => t.lastSnapshotDate).join("|")]);

  // best-effort daily auto-post (only fires when tab open). Loops over
  // every team that has auto-post enabled, fires at most one team per
  // tick so the per-user webhook rate limit never sees a burst.
  //
  // Reads via dataRef.current so the 60s setInterval never carries a
  // stale `lastAutoPostDate` — the prior bug was a closure-staleness
  // re-fire. Don't add unrelated deps to this effect.
  useEffect(() => {
    if (loading) return;

    const tick = async () => {
      if (postingRef.current) return;
      const cur = dataRef.current;
      const t = today();
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();

      for (const tm of (cur.teams || [])) {
        if (!tm.settings.autoPostEnabled) continue;
        if (tm.settings.lastAutoPostDate === t) continue;
        const url = getActiveWebhookUrl(tm.settings);
        if (!url) continue;
        const targetMin = tm.settings.autoPostHour * 60 + tm.settings.autoPostMinute;
        if (nowMin < targetMin) continue;

        postingRef.current = true;
        try {
          const text = `*${tm.title}* — _${t}_\n\n${buildExport(tm)}`;
          await postToChat(url, text);
          update(d => {
            const target = d.teams.find(x => x.id === tm.id);
            if (target) target.settings.lastAutoPostDate = t;
          });
        } catch (e) {
          console.error(`auto-post failed for team "${tm.name}":`, e);
        } finally {
          postingRef.current = false;
        }
        // only one team per tick — next minute will pick up the next eligible team
        return;
      }
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [loading]);

  // ----- due-date notifications (browser + Chat, opt-in per team) -----
  //
  // Augments the browser Notification API with an optional Chat post via
  // each team's active webhook. Same trigger rules: tab open, permission
  // granted (browser only), settings.notifyOnDue is true. Chat post needs
  // an active webhook; missing webhook silently skips Chat.
  //
  // Dedupe keyed by `${taskId}|${dueAt}` -> { firstSentAt, lastSentAt }.
  // In-memory: lost on refresh. Server cron handles cross-session dedupe
  // via SQLite (see server/notify.js). Nag re-pings every nagIntervalHours
  // for rows still overdue + open.
  const notifiedRef = useRef(new Map());
  useEffect(() => {
    if (loading) return;
    if (typeof window === "undefined") return;

    const fireBrowserNotification = (tm, row, now) => {
      if (typeof Notification === "undefined") return;
      if (Notification.permission !== "granted") return;
      const title = row.parentTitle
        ? `Due now: ${row.parentTitle} › ${row.title || "(untitled sub-task)"}`
        : `Due now: ${row.title || "(untitled)"}`;
      try {
        new Notification(title, {
          body: `${tm.name} · ${formatDueRelative(row.dueAt, now)}`,
          tag:  `${row.id}|${row.dueAt}`,
        });
      } catch (e) {
        console.warn("notification failed:", e);
      }
    };

    const tick = () => {
      const cur = dataRef.current;
      const now = new Date();
      const nowIso = now.toISOString();

      for (const tm of (cur.teams || [])) {
        if (!tm.settings?.notifyOnDue) continue;
        const tz = tm.settings?.tz || "";
        const overdue = collectOverdueRows(tm, now, tm.settings?.priorities, tz);
        if (overdue.length === 0) continue;

        // Decide which rows fire this tick (first-time vs nag) using the
        // in-memory notifiedRef. Group by kind so the Chat post wording is
        // accurate ("X items due" vs "X items still overdue").
        const firstRows = [];
        const nagRows = [];
        for (const row of overdue) {
          const key = `${row.id}|${row.dueAt}`;
          const last = notifiedRef.current.get(key)?.lastSentAt || null;
          const decision = shouldPing({
            row,
            now,
            lastSentAt: last,
            nagOverdue: tm.settings?.nagOverdue !== false,
            nagIntervalHours: tm.settings?.nagIntervalHours || 4,
            tz,
          });
          if (decision === "first") firstRows.push(row);
          else if (decision === "nag") nagRows.push(row);
        }

        // Browser pops one OS notification per row — they auto-coalesce
        // by the `tag` key so the user doesn't get hammered after a long
        // break.
        for (const row of [...firstRows, ...nagRows]) {
          fireBrowserNotification(tm, row, now);
        }

        // Chat ping: one combined post per kind. Only fires if the team
        // has an active webhook configured.
        const webhookUrl = getActiveWebhookUrl(tm.settings);
        if (webhookUrl) {
          if (firstRows.length > 0) {
            const text = buildDueNotificationMessage(firstRows, tm.name, "first");
            postToChat(webhookUrl, text).catch(err => console.warn("[notify-chat] first failed:", err?.message || err));
          }
          if (nagRows.length > 0) {
            const text = buildDueNotificationMessage(nagRows, tm.name, "nag");
            postToChat(webhookUrl, text).catch(err => console.warn("[notify-chat] nag failed:", err?.message || err));
          }
        }

        // Update dedupe so the next tick respects the cooldown.
        for (const row of [...firstRows, ...nagRows]) {
          const key = `${row.id}|${row.dueAt}`;
          const prev = notifiedRef.current.get(key);
          notifiedRef.current.set(key, {
            firstSentAt: prev?.firstSentAt || nowIso,
            lastSentAt: nowIso,
          });
        }
      }
    };

    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [loading]);

  // ----- CRUD (all scoped to active team) -----
  // applyTimestamped, sortByStatus, sortPriorityRows are module-scoped so they
  // can be unit-tested. Used here as imports from the same file.
  const addPriority = () => updateTeam(t => {
    t.priorities.push({
      id: uid(), title: "", status: "not_started", priority: "normal",
      ticket: "", items: [], links: [],
      assignee: "", type: "", description: "",
      createdAt: nowIso(), assignedAt: null, doneAt: null, dueAt: null, snoozedUntil: null,
    });
  });
  const updatePriority = (pid, fields) => updateTeam(t => {
    const p = t.priorities.find(x => x.id === pid);
    if (p) Object.assign(p, applyTimestamped(p, fields));
  });
  // Soft-delete: capture the row + its index before removing, then push an
  // 8-second undo toast. The Restore button splices the row back at its
  // original index. The auto-remove timer is held in a ref so Restore can
  // cancel it without racing the React state update. `expiresAt` is read
  // by the toast UI to render a countdown bar.
  const TOAST_DURATION_MS = 8000;
  const queueToast = (toast) => {
    const stamp = Date.now();
    const enriched = { ...toast, createdAt: stamp, expiresAt: stamp + TOAST_DURATION_MS };
    setToasts(prev => [...prev.slice(-3), enriched]);
    const timer = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== enriched.id));
      toastTimersRef.current.delete(enriched.id);
    }, TOAST_DURATION_MS);
    toastTimersRef.current.set(enriched.id, timer);
  };
  const dismissToast = (toastId) => {
    const timer = toastTimersRef.current.get(toastId);
    if (timer) { clearTimeout(timer); toastTimersRef.current.delete(toastId); }
    setToasts(prev => prev.filter(t => t.id !== toastId));
  };
  const deletePriority = (pid) => {
    // Capture the row + index from current state BEFORE the setData call.
    // React 18+ defers setState updater functions until commit, so capturing
    // inside `updateTeam(fn => …)` would race the toast push (`if (snapshot)`
    // would run first against an unset variable).
    const liveTeam = getActiveTeam(data) || data.teams?.[0];
    const idx = liveTeam?.priorities.findIndex(x => x.id === pid) ?? -1;
    if (idx === -1) return;
    const record = liveTeam.priorities[idx];
    updateTeam(t => {
      t.priorities = t.priorities.filter(x => x.id !== pid);
    });
    queueToast({
      id: uid(),
      kind: "priority",
      label: record.title || "(untitled priority)",
      idx,
      record,
    });
  };
  const addItem = (pid) => updateTeam(t => {
    const p = t.priorities.find(x => x.id === pid);
    if (p) p.items.push({
      id: uid(), title: "", status: "not_started",
      ticket: "", notes: [], links: [],
      assignee: "", type: "", description: "",
      createdAt: nowIso(), assignedAt: null, doneAt: null, dueAt: null, snoozedUntil: null,
    });
  });
  const updateItem = (pid, iid, fields) => updateTeam(t => {
    const p = t.priorities.find(x => x.id === pid);
    const i = p?.items.find(x => x.id === iid);
    if (i) Object.assign(i, applyTimestamped(i, fields));
  });
  const deleteItem = (pid, iid) => {
    // See deletePriority for why the snapshot is captured before setData.
    const liveTeam = getActiveTeam(data) || data.teams?.[0];
    const p = liveTeam?.priorities.find(x => x.id === pid);
    if (!p) return;
    const idx = p.items.findIndex(x => x.id === iid);
    if (idx === -1) return;
    const record = p.items[idx];
    const parentTitle = p.title;
    updateTeam(t => {
      const tp = t.priorities.find(x => x.id === pid);
      if (tp) tp.items = tp.items.filter(x => x.id !== iid);
    });
    queueToast({
      id: uid(),
      kind: "item",
      label: record.title || "(untitled sub-task)",
      idx,
      pid,
      parentTitle,
      record,
    });
  };
  const restoreToast = (toast) => {
    updateTeam(t => {
      if (toast.kind === "priority") {
        const idx = Math.min(toast.idx, t.priorities.length);
        t.priorities.splice(idx, 0, toast.record);
      } else if (toast.kind === "item") {
        const p = t.priorities.find(x => x.id === toast.pid);
        if (!p) {
          // parent was deleted too; restore as a top-level priority instead
          t.priorities.push({
            id: uid(),
            title: toast.parentTitle || "Restored",
            status: "wip",
            priority: "normal",
            ticket: "",
            items: [toast.record],
            links: [],
            assignee: "",
            type: "",
            description: "",
            createdAt: nowIso(),
            assignedAt: null,
            doneAt: null,
            dueAt: null,
          });
          return;
        }
        const idx = Math.min(toast.idx, p.items.length);
        p.items.splice(idx, 0, toast.record);
      }
    });
    dismissToast(toast.id);
  };
  const addNote = (pid, iid) => updateTeam(t => {
    const p = t.priorities.find(x => x.id === pid);
    const i = p?.items.find(x => x.id === iid);
    if (i) i.notes.push({ id: uid(), content: "", date: today() });
  });
  const updateNote = (pid, iid, nid, fields) => updateTeam(t => {
    const p = t.priorities.find(x => x.id === pid);
    const i = p?.items.find(x => x.id === iid);
    const n = i?.notes.find(x => x.id === nid);
    if (n) Object.assign(n, fields);
  });
  const deleteNote = (pid, iid, nid) => updateTeam(t => {
    const p = t.priorities.find(x => x.id === pid);
    const i = p?.items.find(x => x.id === iid);
    if (i) i.notes = i.notes.filter(x => x.id !== nid);
  });

  // ----- cascade-aware status transitions -----
  //
  // setPriorityStatus: when a priority moves to DONE while it still
  // has un-done sub-tasks, ask before applying. On confirm, cascade
  // DONE down to every sub-task in the same atomic state update so we
  // emit only one /api/state PUT.
  //
  // setItemStatus: when a sub-task moves to DONE and that completes
  // every sub-task under its parent, auto-promote the parent to DONE.
  // No prompt for this direction — completion bubbling is implicit.
  const setPriorityStatus = (p, newStatus) => {
    if (newStatus === "done" && p.status !== "done") {
      const undone = (p.items || []).filter(it => it.status !== "done");
      if (undone.length > 0) {
        const ok = confirm(
          `Mark "${p.title || "this priority"}" as DONE?\n\n` +
          `This will also mark ${undone.length} sub-task${undone.length === 1 ? "" : "s"} as DONE.`
        );
        if (!ok) return;
      }
    }
    if (newStatus === "done" && p.status !== "done") holdDone(p.id);
    if (newStatus !== "done" && p.status === "done") releaseHold(p.id);
    updateTeam(t => {
      const tp = t.priorities.find(x => x.id === p.id);
      if (!tp) return;
      if (newStatus === "done" && tp.status !== "done") {
        tp.items.forEach(ti => {
          if (ti.status !== "done") {
            holdDone(ti.id);
            Object.assign(ti, applyTimestamped(ti, { status: "done" }));
          }
        });
      }
      Object.assign(tp, applyTimestamped(tp, { status: newStatus }));
    });
  };

  const setItemStatus = (p, it, newStatus) => {
    if (newStatus === "done" && it.status !== "done") holdDone(it.id);
    if (newStatus !== "done" && it.status === "done") releaseHold(it.id);
    updateTeam(t => {
      const tp = t.priorities.find(x => x.id === p.id);
      if (!tp) return;
      const ti = tp.items.find(x => x.id === it.id);
      if (!ti) return;
      Object.assign(ti, applyTimestamped(ti, { status: newStatus }));
      // auto-promote parent when every sub-task is done
      if (newStatus === "done" && tp.status !== "done") {
        const allDone = tp.items.length > 0 && tp.items.every(x => x.status === "done");
        if (allDone) {
          holdDone(tp.id);
          Object.assign(tp, applyTimestamped(tp, { status: "done" }));
        }
      }
      // reverse cascade: sub-task moved OUT of done while parent was DONE.
      // Reopen parent so the list reflects that work is in progress again.
      // Mirror blocked status if that's what the sub-task became (so a
      // newly-blocked sub-task lights up the parent banner). Otherwise
      // parent goes to WIP — never back to TODO, since some history is
      // already done. `applyTimestamped` clears `doneAt` for us.
      if (newStatus !== "done" && tp.status === "done") {
        const reopenStatus = newStatus === "blocked" ? "blocked" : "wip";
        Object.assign(tp, applyTimestamped(tp, { status: reopenStatus }));
      }
    });
  };

  // Link mutators. iid = null targets the priority; iid = <id> targets a sub-task.
  const linksTarget = (t, pid, iid) => {
    const p = t.priorities.find(x => x.id === pid);
    if (!p) return null;
    const target = iid == null ? p : p.items.find(x => x.id === iid);
    if (!target) return null;
    if (!Array.isArray(target.links)) target.links = [];
    return target;
  };
  const addLink = (pid, iid) => updateTeam(t => {
    const target = linksTarget(t, pid, iid);
    if (target) target.links.push({ id: uid(), label: "", url: "" });
  });
  const updateLink = (pid, iid, lid, fields) => updateTeam(t => {
    const target = linksTarget(t, pid, iid);
    const link = target?.links.find(l => l.id === lid);
    if (link) Object.assign(link, fields);
  });
  const deleteLink = (pid, iid, lid) => updateTeam(t => {
    const target = linksTarget(t, pid, iid);
    if (target) target.links = target.links.filter(l => l.id !== lid);
  });

  const toggleCollapsed = (pid) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid); else next.add(pid);
      return next;
    });
  };

  const restoreFromArchive = (archivedId) => updateTeam(t => {
    const idx = t.archive.findIndex(a => a.id === archivedId);
    if (idx === -1) return;
    const a = t.archive[idx];
    if (a.parentId == null) {
      // top-level priority: push back as a priority, reusing the original id
      // so any still-archived sub-tasks could later restore under the same parent.
      t.priorities.push({
        id: a.id,
        title: a.title,
        status: "wip",
        priority: a.priority || "normal",
        ticket: a.ticket || "",
        items: [],
        links: a.links || [],
        assignee: a.assignee || "",
        type: a.type || "",
        description: a.description || "",
        createdAt: a.createdAt,
        assignedAt: a.assignedAt || null,
        doneAt: null,
        dueAt: a.dueAt || null,
      });
    } else {
      let parent = t.priorities.find(p => p.id === a.parentId);
      if (!parent) {
        parent = { id: uid(), title: a.parentTitle || "Restored", status: "not_started", priority: "normal", ticket: "", items: [] };
        t.priorities.push(parent);
      }
      parent.items.push({ id: a.id, title: a.title, status: "wip", ticket: a.ticket || "", notes: a.notes || [] });
    }
    t.archive.splice(idx, 1);
  });

  const purgeArchive = () => {
    if (!confirm("Permanently delete all archived items in this team? This cannot be undone.")) return;
    updateTeam(t => { t.archive = []; });
  };

  const loadExampleData = () => {
    if (team?.priorities?.length > 0 &&
        !confirm("Replace this team's data with the example dataset? This cannot be undone.")) {
      return;
    }
    updateTeam(t => {
      const ex = buildExampleTeam(t.name);
      t.title = ex.title;
      t.subtitle = ex.subtitle;
      t.priorities = ex.priorities;
    });
    setView("today");
  };

  // export & post (active team)
  const exportText = () => buildExport(team || { title: "", priorities: [] });
  const copyExport = async () => {
    try { await navigator.clipboard.writeText(exportText()); setCopyState("copied"); }
    catch { setCopyState("error"); }
    setTimeout(() => setCopyState(null), 1500);
  };
  const downloadExport = () => {
    const blob = new Blob([exportText()], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `status-${today()}.txt`; a.click();
    URL.revokeObjectURL(url);
  };
  const downloadMarkdownExport = () => {
    const md = buildMarkdownExport(team || { title: "", priorities: [] });
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `status-${today()}.md`; a.click();
    URL.revokeObjectURL(url);
  };

  // Manual snapshot — full-state JSON download. Restore in Settings.
  const downloadSnapshot = () => {
    const payload = JSON.stringify(data, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.href = url; a.download = `tracker-backup-${ts}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const restoreFromFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => alert("Could not read that file.");
    reader.onload = () => {
      let parsed;
      try { parsed = JSON.parse(reader.result); }
      catch { alert("That file is not valid JSON."); return; }
      let migrated;
      try { migrated = migrate(parsed); }
      catch { alert("That JSON does not match the tracker schema."); return; }
      const teamCount = migrated.teams?.length || 0;
      const priorityCount = (migrated.teams || []).reduce((n, t) => n + (t.priorities?.length || 0), 0);
      if (!confirm(
        `Replace ALL teams and data with the contents of this backup?\n\n` +
        `Backup contains ${teamCount} team(s) and ${priorityCount} total priorities.\n\n` +
        `This cannot be undone (consider taking a Snapshot first).`
      )) return;
      setData(migrated);
      setView("today");
    };
    reader.readAsText(file);
  };
  const postNow = async () => {
    if (postingRef.current) return;
    if (!team) return;
    const url = getActiveWebhookUrl(team.settings);
    if (!url) { setView("settings"); return; }
    postingRef.current = true;
    setPostState("posting");
    try {
      const text = `*${team.title}* — _${today()}_\n\n${exportText()}`;
      await postToChat(url, text);
      setPostState("posted");
    } catch (e) {
      console.error(e);
      setPostState("error");
    } finally {
      postingRef.current = false;
      setTimeout(() => setPostState(null), 2000);
    }
  };
  const postDiff = async () => {
    if (postingRef.current) return;
    if (!team) return;
    const url = getActiveWebhookUrl(team.settings);
    if (!url) { setView("settings"); return; }
    postingRef.current = true;
    setPostState("posting");
    try {
      const histKeys = Object.keys(team.history).sort();
      const prevKey = histKeys[histKeys.length - 1];
      const prev = prevKey ? team.history[prevKey] : null;
      const d = diffPriorities(prev, team.priorities);
      const text = `*${team.title}* — _changes since ${prevKey || "start"}_\n\n${buildDiffText(d)}`;
      await postToChat(url, text);
      setPostState("posted");
    } catch (e) {
      console.error(e);
      setPostState("error");
    } finally {
      postingRef.current = false;
      setTimeout(() => setPostState(null), 2000);
    }
  };

  // sortByStatus + sortPriorityRows are imported from the module scope above.
  const sortedPriorities = useMemo(
    () => sortPriorityRows(team?.priorities || [], team?.settings?.priorities, heldDoneIds),
    [team?.priorities, team?.settings?.priorities, heldDoneIds]
  );

  // ----- filter state (per-tab, in-memory only) -----
  const EMPTY_FILTERS = { priority: "", status: "", type: "", assignee: "", search: "", due: "", snoozed: "" };
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const filtersActive =
    filters.priority || filters.status || filters.type || filters.due || filters.snoozed ||
    (filters.assignee || "").trim() || (filters.search || "").trim();

  // The `due` filter accepts: overdue | today | week | any | none
  function dueMatches(row) {
    if (!filters.due) return true;
    const b = dueBucket(row.dueAt, row.status);
    switch (filters.due) {
      case "overdue": return b === "overdue";
      case "today":   return b === "today";
      // "this week" includes overdue + today + soon (<=6 days) — what's
      // actionable now, not what's pretty
      case "week":    return b === "overdue" || b === "today" || b === "soon";
      case "any":     return Boolean(row.dueAt);
      case "none":    return !row.dueAt;
      default:        return true;
    }
  }

  function rowMatches(row, isPriority) {
    if (filters.priority && isPriority && row.priority !== filters.priority) return false;
    if (filters.status && row.status !== filters.status) return false;
    if (filters.type && (row.type || "") !== filters.type) return false;
    if (!dueMatches(row)) return false;
    const a = (filters.assignee || "").trim().toLowerCase();
    if (a) {
      const names = parseAssignees(row.assignee).map(n => n.toLowerCase());
      if (!names.some(n => n.includes(a))) return false;
    }
    const q = (filters.search || "").trim().toLowerCase();
    if (q) {
      const hay = [
        row.title || "",
        row.description || "",
        row.assignee || "",
        ...(Array.isArray(row.notes) ? row.notes.map(n => n.content || "") : []),
      ].join("\n").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  // Returns { priorities: filteredPriorityRows, hidden: count } where each
  // row may also carry _filteredItems (subset of items shown). The rule:
  //   - parent passes → keep all matching items, OR all items if no item-level filter would change them
  //   - parent fails BUT some sub-task passes → keep parent with only the matching items
  //   - parent fails AND no sub-task passes → drop entirely
  const visibleData = useMemo(() => {
    const todayStr = today();
    // Snooze gate runs before any other filter. Default behavior hides
    // snoozed rows; setting filters.snoozed = "show" includes them and
    // "only" surfaces just the snoozed rows.
    const snoozeGate = (row) => {
      const snoozed = isSnoozed(row, todayStr);
      if (filters.snoozed === "only") return snoozed;
      if (filters.snoozed === "show") return true;
      return !snoozed;
    };
    if (!filtersActive) {
      const visible = sortedPriorities.filter(snoozeGate);
      return { rows: visible, hidden: sortedPriorities.length - visible.length };
    }
    let hidden = 0;
    const rows = [];

    // Item-level matcher uses every active filter EXCEPT priority (items
    // have no priority field). The priority filter is enforced strictly
    // at the parent level — a sub-task can never "rescue" a parent whose
    // own priority doesn't match the priority filter.
    const itemMatches = (it) => {
      if (filters.status && it.status !== filters.status) return false;
      if (filters.type && (it.type || "") !== filters.type) return false;
      if (!dueMatches(it)) return false;
      const a = (filters.assignee || "").trim().toLowerCase();
      if (a) {
        const names = parseAssignees(it.assignee).map(n => n.toLowerCase());
        if (!names.some(n => n.includes(a))) return false;
      }
      const q = (filters.search || "").trim().toLowerCase();
      if (q) {
        const hay = [
          it.title || "",
          it.description || "",
          it.assignee || "",
          ...(Array.isArray(it.notes) ? it.notes.map(n => n.content || "") : []),
        ].join("\n").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    };

    for (const p of sortedPriorities) {
      if (!snoozeGate(p)) {
        hidden += 1;
        continue;
      }
      // Strict priority-level gate: if the priority filter is set and the
      // parent's own priority doesn't match, drop the row regardless of
      // sub-task matches.
      if (filters.priority && p.priority !== filters.priority) {
        hidden += 1;
        continue;
      }
      const parentMatch = rowMatches(p, true);
      const itemFiltersActive = filters.status || filters.type || filters.due ||
        (filters.assignee || "").trim() || (filters.search || "").trim();
      const matchingItems = (p.items || []).filter(itemMatches);

      if (parentMatch && !itemFiltersActive) {
        rows.push(p);
      } else if (parentMatch) {
        // parent passes — show every sub-task it has, ignoring item-level filters
        rows.push(p);
      } else if (matchingItems.length > 0) {
        // parent itself doesn't match, but sub-tasks do — show parent with only matching items
        rows.push({ ...p, items: matchingItems, _filtered: true });
      } else {
        hidden += 1;
      }
    }
    return { rows, hidden };
  }, [sortedPriorities, filters, filtersActive]);

  // Keyboard shortcuts. j/k navigate visible rows; x toggles done on the
  // focused row; c creates a new top-level priority; / focuses search;
  // ? toggles the cheatsheet. Skipped while a text input has focus so we
  // don't hijack the user's typing.
  const shortcutCtxRef = useRef({});
  useEffect(() => {
    shortcutCtxRef.current = {
      rows: visibleData.rows,
      focusedRowId,
      view,
    };
  });
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target?.tagName || "").toLowerCase();
      const isEditable = tag === "input" || tag === "textarea" || tag === "select" || e.target?.isContentEditable;
      if (isEditable) return;
      const ctx = shortcutCtxRef.current;
      if (e.key === "?") {
        e.preventDefault();
        setShortcutsOpen(o => !o);
        return;
      }
      if (e.key === "Escape") {
        if (shortcutsOpen) { setShortcutsOpen(false); return; }
      }
      if (ctx.view !== "today") return;
      if (e.key === "/") {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (e.key === "j" || e.key === "k") {
        const rows = ctx.rows || [];
        if (rows.length === 0) return;
        const idx = rows.findIndex(r => r.id === ctx.focusedRowId);
        const next = e.key === "j"
          ? (idx < 0 ? 0 : Math.min(idx + 1, rows.length - 1))
          : (idx <= 0 ? 0 : idx - 1);
        setFocusedRowId(rows[next].id);
        e.preventDefault();
        return;
      }
      if (e.key === "x") {
        const rows = ctx.rows || [];
        const row = rows.find(r => r.id === ctx.focusedRowId);
        if (!row) return;
        setPriorityStatus(row, row.status === "done" ? "wip" : "done");
        e.preventDefault();
        return;
      }
      if (e.key === "c") {
        addPriority();
        e.preventDefault();
        return;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortcutsOpen]);

  // diff vs last snapshot (active team)
  const diff = useMemo(() => {
    if (!team) return null;
    const histKeys = Object.keys(team.history).sort();
    const lastDate = histKeys[histKeys.length - 1];
    if (!lastDate) return null;
    return { date: lastDate, ...diffPriorities(team.history[lastDate], team.priorities) };
  }, [team?.history, team?.priorities]);

  // stats (active team)
  const stats = (team?.priorities || []).reduce((acc, p) => {
    acc.total += 1;
    acc[p.status] = (acc[p.status] || 0) + 1;
    p.items.forEach(i => {
      acc.subtotal += 1;
      acc[`sub_${i.status}`] = (acc[`sub_${i.status}`] || 0) + 1;
    });
    return acc;
  }, { total: 0, subtotal: 0 });

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f1e8]">
        <Loader2 className="animate-spin text-stone-600" size={24} />
      </div>
    );
  }

  return (
    <div
      className="min-h-screen px-4 sm:px-6 py-8 sm:py-10 bg-[#f5f1e8] text-stone-900"
      style={{
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        backgroundImage: "radial-gradient(circle at 1px 1px, rgba(60,40,20,0.06) 1px, transparent 0)",
        backgroundSize: "24px 24px",
      }}
    >
      <div className="max-w-4xl mx-auto">

        {/* Team selector */}
        <nav className="flex flex-wrap gap-1 mb-3 items-center">
          {data.teams.map(t => {
            const active = t.id === data.activeTeamId;
            return (
              <button
                key={t.id}
                onClick={() => switchTeam(t.id)}
                title={active ? `Active team — ${t.priorities.length} priorities` : `Switch to ${t.name}`}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider border transition ${active ? "border-stone-900 bg-stone-900 text-stone-50" : "border-stone-400 text-stone-600 hover:border-stone-900 hover:text-stone-900 bg-white/40"}`}
              >
                <UsersIcon size={12} />
                {t.name}
                <span className="text-[10px] opacity-70 ml-1">{t.priorities.length}</span>
              </button>
            );
          })}
          <button
            onClick={() => addTeam()}
            title="Create a new team"
            className="inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-mono uppercase tracking-wider border-2 border-dashed border-stone-400 text-stone-500 hover:border-stone-900 hover:text-stone-900 transition"
          >
            <Plus size={12} />Add team
          </button>
        </nav>

        {/* Header */}
        <header className="mb-6 pb-5 border-b-2 border-stone-900">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-mono uppercase tracking-widest text-stone-500">Team</span>
                <Editable
                  value={team?.name || ""}
                  onChange={(v) => team && renameTeam(team.id, v)}
                  placeholder="Team name"
                  className="text-[11px] font-mono uppercase tracking-wider text-stone-900"
                />
                {data.teams.length > 1 && (
                  <button
                    onClick={() => team && deleteTeam(team.id)}
                    title={`Delete team "${team?.name || ""}"`}
                    className="text-stone-300 hover:text-red-600 transition"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              <h1
                className="text-3xl sm:text-4xl font-bold text-stone-900 leading-tight break-words"
                style={{ fontFamily: "'Fraunces', serif", fontVariationSettings: "'opsz' 144" }}
              >
                <Editable
                  value={team?.title || ""}
                  onChange={(v) => updateTeam(t => { t.title = v; })}
                  placeholder="Title"
                />
              </h1>
              <p className="text-xs text-stone-500 mt-1 tracking-widest uppercase">
                {today()} ·{" "}
                <Editable
                  value={team?.subtitle || ""}
                  onChange={(v) => updateTeam(t => { t.subtitle = v; })}
                  placeholder="Subtitle"
                />
                {user ? <> · <span className="text-stone-700">{user}</span></> : null}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={postNow}
                title="Post current status to Google Chat"
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider transition ${postState === "error" ? "bg-red-700 text-white" : postState === "posted" ? "bg-emerald-700 text-white" : "bg-blue-700 text-white hover:bg-blue-800"}`}
              >
                <Send size={12} />
                {postState === "posting" ? "Posting…" : postState === "posted" ? "Posted" : postState === "error" ? "Failed" : "Post to Chat"}
              </button>
              <ExportMenu
                copyExport={copyExport}
                downloadExport={downloadExport}
                downloadMarkdownExport={downloadMarkdownExport}
                downloadSnapshot={downloadSnapshot}
                copyState={copyState}
              />
              <button
                onClick={() => setView("help")}
                title="Help — feature reference"
                aria-label="Help"
                className="inline-flex items-center justify-center w-9 h-9 text-stone-600 border border-stone-400 hover:border-stone-900 hover:text-stone-900 transition"
              >
                <HelpCircle size={14} />
              </button>
              {onLogout && (
                <button
                  onClick={onLogout}
                  title="Sign out"
                  aria-label="Sign out"
                  className="inline-flex items-center justify-center w-9 h-9 text-stone-600 border border-stone-400 hover:border-stone-900 hover:text-stone-900 transition"
                >
                  <LogOut size={14} />
                </button>
              )}
            </div>
          </div>

          {stats.total > 0 && (
            <div className="mt-4 flex flex-wrap gap-3 text-[11px] font-mono text-stone-600">
              <span>{stats.total} priorities</span>
              <span>·</span>
              <span>{stats.subtotal} sub-items</span>
              {stats.wip ? <><span>·</span><span className="text-amber-800">{stats.wip} WIP</span></> : null}
              {stats.blocked ? <><span>·</span><span className="text-red-800">{stats.blocked} blocked</span></> : null}
              {stats.done ? <><span>·</span><span className="text-emerald-800">{stats.done} done</span></> : null}
              {team?.archive?.length > 0 ? <><span>·</span><span className="text-stone-500">{team.archive.length} archived</span></> : null}
            </div>
          )}
        </header>

        {/* Tabs */}
        <nav className="flex gap-1 mb-5 border-b border-stone-300 overflow-x-auto">
          {[
            { id: "today",    label: "Today",                                            Icon: Calendar },
            { id: "diff",     label: `Diff${diff ? ` (vs ${diff.date})` : ""}`,          Icon: GitCompare },
            { id: "archive",  label: `Archive (${team?.archive?.length || 0})`,          Icon: ArchiveIcon },
            { id: "history",  label: "History",                                          Icon: HistoryIcon },
            { id: "insights", label: "Insights",                                         Icon: Sparkles },
            { id: "settings", label: "Settings",                                         Icon: SettingsIcon },
          ].map(tab => (
            <button key={tab.id}
              onClick={() => setView(tab.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-2.5 min-h-9 text-[11px] font-mono uppercase tracking-wider border-b-2 transition whitespace-nowrap -mb-px ${view === tab.id ? "border-stone-900 text-stone-900" : "border-transparent text-stone-500 hover:text-stone-900"}`}>
              <tab.Icon size={12} />
              {tab.label}
            </button>
          ))}
        </nav>

        {/* ============ TODAY ============ */}
        {view === "today" && (
          <>
            <h2 className="text-xs font-bold tracking-[0.2em] uppercase text-stone-700 mb-3">
              ▸ Team Priorities / Ongoing Works
            </h2>

            <SavedFiltersBar
              saved={team?.settings?.savedFilters || []}
              currentFilters={filters}
              filtersActive={filtersActive}
              onApply={(f) => setFilters({ ...EMPTY_FILTERS, ...f })}
              onSave={(name) => updateTeam(t => {
                t.settings.savedFilters = [
                  ...(t.settings.savedFilters || []),
                  { id: uid(), name, filters: { ...filters } },
                ];
              })}
              onRemove={(id) => updateTeam(t => {
                t.settings.savedFilters = (t.settings.savedFilters || []).filter(f => f.id !== id);
              })}
            />

            <FilterBar
              filters={filters}
              setFilters={setFilters}
              workTypes={team?.settings?.workTypes || []}
              priorities={team?.settings?.priorities}
              total={team?.priorities?.length || 0}
              shown={visibleData.rows.length}
              hidden={visibleData.hidden}
              onClear={() => setFilters(EMPTY_FILTERS)}
              searchInputRef={searchInputRef}
            />

            <div className="space-y-2">
              {visibleData.rows.map((p, i) => {
                const isCollapsed = collapsed.has(p.id);
                const priorityList = team?.settings?.priorities;
                const pDef = resolvePriorityDef(p.priority, priorityList);
                const pCls = priorityColorClasses(pDef.color);
                const isTop = isTopUrgency(p.priority, priorityList);
                const isHi  = !isTop && !pDef.unknown && pDef.rank === 1;
                const isBlocked = p.status === "blocked";
                const rowBorder = isBlocked
                  ? "border-red-400 border-l-4"
                  : isTop
                    ? `${pCls.rowBorder} border-l-8 shadow-sm`
                    : isHi
                      ? `${pCls.rowBorder} border-l-4`
                      : "border-stone-300";
                const rowBg = isBlocked
                  ? "bg-red-50/60"
                  : isTop
                    ? pCls.rowBg
                    : isHi
                      ? pCls.rowBg
                      : "";
                const isFocused = focusedRowId === p.id;
                return (
                  <div
                    key={p.id}
                    onMouseDown={() => setFocusedRowId(p.id)}
                    className={`group bg-white/60 border ${rowBorder} ${p.status === "done" ? "opacity-60" : ""} ${isFocused ? "ring-2 ring-stone-500 ring-offset-1" : ""}`}
                  >
                    <div className={`px-3 py-2 ${rowBg}`}>
                      {/* Top row: title + status + delete. Title gets full width. */}
                      <div className="flex items-start gap-2">
                        <button onClick={() => toggleCollapsed(p.id)} className="text-stone-400 hover:text-stone-700 mt-0.5 shrink-0">
                          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                        </button>
                        <span className="font-mono text-stone-500 text-sm font-medium pt-0.5 select-none w-5 shrink-0">{i + 1}.</span>
                        <PriorityPill priority={p.priority} onChange={(v) => updatePriority(p.id, { priority: v })} priorities={priorityList} />
                        <div className={`flex-1 min-w-0 text-sm leading-snug pt-0.5 break-words ${p.status === "done" ? "line-through text-stone-500" : "text-stone-900"}`}>
                          <Editable value={p.title} onChange={(v) => updatePriority(p.id, { title: v })} placeholder="What needs doing?" markdown />
                        </div>
                        <StatusPill status={p.status} onChange={(v) => setPriorityStatus(p, v)} />
                        <button
                          onClick={() => deletePriority(p.id)}
                          className="inline-flex items-center justify-center w-9 h-9 text-stone-300 hover:text-red-600 opacity-0 group-hover:opacity-100 transition shrink-0"
                          title="Delete"
                          aria-label="Delete priority"
                        >
                          <X size={14} />
                        </button>
                      </div>
                      {/* Meta row: ticket, links, assignee, dates — wraps freely. */}
                      <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1 pl-10 text-[11px]">
                        <TicketField value={p.ticket} onChange={(v) => updatePriority(p.id, { ticket: v })} />
                        <LinksField
                          links={p.links || []}
                          onAdd={() => addLink(p.id, null)}
                          onUpdate={(lid, fields) => updateLink(p.id, null, lid, fields)}
                          onDelete={(lid) => deleteLink(p.id, null, lid)}
                        />
                        <TypeField
                          value={p.type}
                          options={team?.settings?.workTypes || []}
                          onChange={(v) => updatePriority(p.id, { type: v })}
                        />
                        <DueField
                          value={p.dueAt}
                          status={p.status}
                          onChange={(v) => updatePriority(p.id, { dueAt: v })}
                        />
                        <SnoozeField
                          value={p.snoozedUntil}
                          onChange={(v) => updatePriority(p.id, { snoozedUntil: v })}
                        />
                        <AssigneeField
                          value={p.assignee}
                          createdAt={p.createdAt}
                          assignedAt={p.assignedAt}
                          doneAt={p.doneAt}
                          onChange={(v) => updatePriority(p.id, { assignee: v })}
                        />
                        <button
                          type="button"
                          onClick={() => setPanelTask({ pid: p.id, iid: null })}
                          title={(p.description || "").trim() ? "Open description" : "Add a description"}
                          className={`inline-flex items-center gap-1 text-[11px] font-mono ${(p.description || "").trim() ? "text-stone-700 hover:text-stone-900" : "text-stone-400 hover:text-stone-700"}`}
                        >
                          <FileText size={11} />
                          {(p.description || "").trim() ? "doc" : "doc+"}
                        </button>
                        <RowMeta
                          createdAt={p.createdAt}
                          assignedAt={p.assignedAt}
                          doneAt={p.doneAt}
                          status={p.status}
                        />
                      </div>
                    </div>

                    {!isCollapsed && (
                      <div className="border-t border-stone-200 bg-stone-50/40">
                        {sortByStatus(p.items, heldDoneIds).map((it, j) => (
                          <div key={it.id} className="group/item">
                            <div className={`px-3 py-1.5 pl-10 border-b border-stone-100 ${it.status === "done" ? "opacity-60" : ""} ${it.status === "blocked" ? "bg-red-50/40" : ""}`}>
                              {/* Top row: number + title + status + actions */}
                              <div className="flex items-start gap-2">
                                <span className="font-mono text-stone-400 text-xs pt-0.5 select-none w-8 shrink-0">{i + 1}.{j + 1}</span>
                                <div className={`flex-1 min-w-0 text-[13px] leading-snug pt-0.5 break-words ${it.status === "done" ? "line-through text-stone-500" : "text-stone-800"}`}>
                                  <Editable value={it.title} onChange={(v) => updateItem(p.id, it.id, { title: v })} placeholder="Sub-task" markdown />
                                </div>
                                <StatusPill status={it.status} onChange={(v) => setItemStatus(p, it, v)} size="xs" />
                                <button onClick={() => addNote(p.id, it.id)} className="text-stone-300 hover:text-stone-700 opacity-0 group-hover/item:opacity-100 transition shrink-0" title="Add note">
                                  <Plus size={12} />
                                </button>
                                <button
                                  onClick={() => deleteItem(p.id, it.id)}
                                  className="inline-flex items-center justify-center w-9 h-9 text-stone-300 hover:text-red-600 opacity-0 group-hover/item:opacity-100 transition shrink-0"
                                  title="Delete"
                                  aria-label="Delete sub-task"
                                >
                                  <X size={12} />
                                </button>
                              </div>
                              {/* Meta row: ticket, links, assignee, dates */}
                              <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1 pl-10 text-[11px]">
                                <TicketField value={it.ticket} onChange={(v) => updateItem(p.id, it.id, { ticket: v })} />
                                <LinksField
                                  links={it.links || []}
                                  onAdd={() => addLink(p.id, it.id)}
                                  onUpdate={(lid, fields) => updateLink(p.id, it.id, lid, fields)}
                                  onDelete={(lid) => deleteLink(p.id, it.id, lid)}
                                />
                                <TypeField
                                  value={it.type}
                                  options={team?.settings?.workTypes || []}
                                  onChange={(v) => updateItem(p.id, it.id, { type: v })}
                                />
                                <DueField
                                  value={it.dueAt}
                                  status={it.status}
                                  onChange={(v) => updateItem(p.id, it.id, { dueAt: v })}
                                />
                                <SnoozeField
                                  value={it.snoozedUntil}
                                  onChange={(v) => updateItem(p.id, it.id, { snoozedUntil: v })}
                                />
                                <AssigneeField
                                  value={it.assignee}
                                  createdAt={it.createdAt}
                                  assignedAt={it.assignedAt}
                                  doneAt={it.doneAt}
                                  onChange={(v) => updateItem(p.id, it.id, { assignee: v })}
                                />
                                <button
                                  type="button"
                                  onClick={() => setPanelTask({ pid: p.id, iid: it.id })}
                                  title={(it.description || "").trim() ? "Open description" : "Add a description"}
                                  className={`inline-flex items-center gap-1 text-[11px] font-mono ${(it.description || "").trim() ? "text-stone-700 hover:text-stone-900" : "text-stone-400 hover:text-stone-700"}`}
                                >
                                  <FileText size={11} />
                                  {(it.description || "").trim() ? "doc" : "doc+"}
                                </button>
                                <RowMeta
                                  createdAt={it.createdAt}
                                  assignedAt={it.assignedAt}
                                  doneAt={it.doneAt}
                                  status={it.status}
                                />
                              </div>
                            </div>

                            {it.notes.map((n, k) => (
                              <div key={n.id} className="group/note flex items-start gap-2 px-3 py-1 pl-16 text-[12px] text-stone-600 border-b border-stone-100/60">
                                <span className="font-mono text-stone-400 select-none w-12 shrink-0">{i + 1}.{j + 1}.{k + 1}</span>
                                <div className="flex-1">
                                  <Editable value={n.content} onChange={(v) => updateNote(p.id, it.id, n.id, { content: v })} placeholder="Note…" markdown />
                                </div>
                                <span className="text-[10px] text-stone-400 font-mono inline-flex items-center gap-0.5">
                                  <Clock size={9} />{n.date}
                                </span>
                                <button onClick={() => deleteNote(p.id, it.id, n.id)} className="text-stone-300 hover:text-red-600 opacity-0 group-hover/note:opacity-100 transition">
                                  <X size={11} />
                                </button>
                              </div>
                            ))}
                          </div>
                        ))}

                        <button onClick={() => addItem(p.id)}
                          className="w-full text-left px-3 py-1.5 pl-10 text-[11px] font-mono text-stone-400 hover:text-stone-900 hover:bg-stone-100/60 transition uppercase tracking-wider">
                          + Add sub-task
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {(team?.priorities?.length || 0) === 0 && (
                <div className="text-center py-12 px-4 border-2 border-dashed border-stone-300 space-y-3">
                  <p className="text-stone-400 text-sm">
                    No priorities yet. Add your first one below — or load a sample dataset to see the layout in action.
                  </p>
                  <button
                    onClick={loadExampleData}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-stone-700 text-stone-700 hover:bg-stone-700 hover:text-white transition"
                  >
                    <Sparkles size={12} />
                    Load example data
                  </button>
                </div>
              )}

              <button onClick={addPriority}
                className="w-full mt-2 px-4 py-3 border-2 border-dashed border-stone-400 text-stone-500 hover:border-stone-900 hover:text-stone-900 hover:bg-white/60 transition text-xs font-mono uppercase tracking-widest inline-flex items-center justify-center gap-2">
                <Plus size={14} />New Priority
              </button>
            </div>
          </>
        )}

        {/* ============ DIFF ============ */}
        {view === "diff" && (
          <div>
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 className="text-xs font-bold tracking-[0.2em] uppercase text-stone-700">
                ▸ Changes since {diff?.date || "—"}
              </h2>
              {diff && !diffIsEmpty(diff) && (
                <button onClick={postDiff}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider bg-blue-700 text-white hover:bg-blue-800 transition">
                  <Send size={12} />Post diff to Chat
                </button>
              )}
            </div>
            {!diff && (
              <div className="text-stone-400 text-sm py-8 text-center border-2 border-dashed border-stone-300">
                <p>No previous snapshot yet. Diff appears tomorrow after your first day.</p>
              </div>
            )}
            {diff && diffIsEmpty(diff) && (
              <div className="text-stone-400 text-sm py-8 text-center border-2 border-dashed border-stone-300">
                <p>No changes since {diff.date}.</p>
              </div>
            )}
            {diff && !diffIsEmpty(diff) && (
              <div className="space-y-4 text-sm">
                {diff.newBlockers.length > 0 && (
                  <DiffSection title="🚨 New Blockers" color="red">
                    {diff.newBlockers.map((b, i) => (
                      <li key={i}><strong>{b.p.title}</strong>{b.it ? <> → {b.it.title}</> : null}</li>
                    ))}
                  </DiffSection>
                )}
                {diff.addedPriorities.length > 0 && (
                  <DiffSection title="➕ New Priorities" color="emerald">
                    {diff.addedPriorities.map((p) => <li key={p.id}>{p.title || "(untitled)"}</li>)}
                  </DiffSection>
                )}
                {diff.statusFlips.length > 0 && (
                  <DiffSection title="🔄 Status Changes (Priorities)" color="blue">
                    {diff.statusFlips.map((f, i) => (
                      <li key={i}>
                        <strong>{f.p.title}</strong>: {STATUSES[f.from].label} <ArrowRight size={11} className="inline" /> {STATUSES[f.to].label}
                      </li>
                    ))}
                  </DiffSection>
                )}
                {diff.itemStatusFlips.length > 0 && (
                  <DiffSection title="🔄 Status Changes (Sub-tasks)" color="blue">
                    {diff.itemStatusFlips.map((f, i) => (
                      <li key={i}>
                        {f.p.title} → <strong>{f.it.title}</strong>: {STATUSES[f.from].label} <ArrowRight size={11} className="inline" /> {STATUSES[f.to].label}
                      </li>
                    ))}
                  </DiffSection>
                )}
                {diff.addedItems.length > 0 && (
                  <DiffSection title="➕ New Sub-tasks" color="emerald">
                    {diff.addedItems.map(({ p, it }) => (
                      <li key={it.id}>{p.title} → {it.title || "(untitled)"}</li>
                    ))}
                  </DiffSection>
                )}
                {(diff.removedPriorities.length + diff.removedItems.length) > 0 && (
                  <DiffSection title="➖ Removed" color="stone">
                    {diff.removedPriorities.map(p => <li key={p.id}>{p.title}</li>)}
                    {diff.removedItems.map(({ p, it }) => <li key={it.id}>{p.title} → {it.title}</li>)}
                  </DiffSection>
                )}
              </div>
            )}
          </div>
        )}

        {/* ============ ARCHIVE ============ */}
        {view === "archive" && (
          <div>
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 className="text-xs font-bold tracking-[0.2em] uppercase text-stone-700">
                ▸ Archive ({team?.archive?.length || 0})
              </h2>
              {(team?.archive?.length || 0) > 0 && (
                <button onClick={purgeArchive}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider border border-red-700 text-red-700 hover:bg-red-700 hover:text-white transition">
                  <Trash2 size={12} />Purge all
                </button>
              )}
            </div>
            {(team?.archive?.length || 0) === 0 ? (
              <div className="text-stone-400 text-sm py-8 text-center border-2 border-dashed border-stone-300">
                <p>Empty. Items marked DONE for {">"}24h auto-archive here.</p>
              </div>
            ) : (
              <div className="space-y-1">
                {[...(team?.archive || [])].reverse().map((a) => (
                  <div key={a.id + a.archivedDate} className="bg-white/60 border border-stone-300 px-3 py-2 flex items-start gap-2 group">
                    <CheckCircle2 size={14} className="text-emerald-700 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-stone-800 truncate">{a.title}</div>
                      <div className="text-[11px] text-stone-500 font-mono">
                        {a.parentTitle ? <>from <em>{a.parentTitle}</em> · </> : null}
                        archived {a.archivedDate}
                      </div>
                    </div>
                    {a.ticket && (
                      <a href={a.ticket} target="_blank" rel="noreferrer"
                        className="text-xs font-mono text-blue-700 underline decoration-dotted">
                        ticket
                      </a>
                    )}
                    <button onClick={() => restoreFromArchive(a.id)}
                      title="Restore to active list"
                      className="text-stone-400 hover:text-stone-900 opacity-0 group-hover:opacity-100 transition inline-flex items-center gap-1 text-[11px] font-mono uppercase">
                      <RotateCcw size={11} />Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ============ HISTORY ============ */}
        {view === "history" && (
          <HistoryView
            history={team?.history || {}}
            priorities={team?.settings?.priorities}
            historyDate={historyDate}
            setHistoryDate={setHistoryDate}
          />
        )}

        {/* ============ INSIGHTS ============ */}
        {view === "insights" && (
          <InsightsView
            team={team}
            window={insightsWindow}
            setWindow={setInsightsWindow}
          />
        )}

        {/* ============ SETTINGS ============ */}
        {view === "settings" && (
          <SettingsView
            team={team}
            updateTeam={updateTeam}
            loadExampleData={loadExampleData}
            postNow={postNow}
            postState={postState}
            downloadSnapshot={downloadSnapshot}
            restoreFromFile={restoreFromFile}
            storageKey={STORAGE_KEY}
            historyRetentionDays={HISTORY_RETENTION_DAYS}
          />
        )}

        {/* ============ HELP ============ */}
        {view === "help" && (
          <HelpView onOpenShortcuts={() => setShortcutsOpen(true)} />
        )}

        <footer className="mt-12 pt-4 border-t border-stone-300 text-[10px] font-mono text-stone-400 uppercase tracking-widest flex justify-between flex-wrap gap-2">
          <span>auto-saves locally</span>
          <span>sorted by P1 → P2 → P3 → normal, then by status · done {">"}24h auto-archives</span>
        </footer>
      </div>

      {shortcutsOpen && (
        <ShortcutsCheatsheet onClose={() => setShortcutsOpen(false)} />
      )}

      {toasts.length > 0 && (
        <div className="fixed bottom-4 left-4 z-40 space-y-2 max-w-sm">
          {toasts.map((t) => (
            <UndoToast
              key={t.id}
              toast={t}
              onRestore={() => restoreToast(t)}
              onDismiss={() => dismissToast(t.id)}
            />
          ))}
        </div>
      )}

      {panelTask && (
        <TaskPanel
          team={team}
          task={panelTask}
          onClose={() => setPanelTask(null)}
          onSwitchTask={(next) => setPanelTask(next)}
          updatePriority={updatePriority}
          updateItem={updateItem}
          setPriorityStatus={setPriorityStatus}
          setItemStatus={setItemStatus}
          addLink={addLink}
          updateLink={updateLink}
          deleteLink={deleteLink}
        />
      )}
    </div>
  );
}

// =====================  SUB-VIEWS  =====================

// Filter bar for the Today list. State + filtering live in StatusTracker;
// this is a presentational component that mirrors `filters` and reports
// changes back via `setFilters`.
// Single "oops" toast with a live countdown bar so the user can see how
// long the restore window is open. Re-renders every ~80ms while the toast
// is live, then stops when expiresAt passes (the parent removes it).
