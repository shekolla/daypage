// Modals + drawers + the Settings tab body. Everything that opens "on top
// of" or replaces the main row list lives here. Each component is fully
// self-contained — `TaskPanel` and `SettingsView` accept the relevant
// handlers as props from `StatusTracker`.

import { useState, useEffect, useRef } from "react";
import {
  Plus, X, Send, Bell, RotateCcw, ChevronDown, Sparkles,
  DownloadCloud, UploadCloud, FileDown, FileText, Copy, Check,
} from "lucide-react";
import { uid, today, collectTeamAssignees, fmtTimestamp } from "../lib/util.js";
import { getActiveWebhookUrl } from "../lib/migrate.js";
import { postToChat } from "../lib/api.js";
import { TW_PRIORITY_PALETTE, COMMON_TIMEZONES } from "../lib/constants.js";
import { priorityColorClasses } from "../lib/priority.js";
import {
  Editable, MarkdownEditor, StatusPill, PriorityPill, TicketField,
  LinksField, AssigneeField, DueField, TypeField,
} from "./fields.jsx";
import { useFocusTrap } from "../lib/useFocusTrap.js";

export function UndoToast({ toast, onRestore, onDismiss }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 80);
    return () => clearInterval(tick);
  }, []);
  const total = Math.max(1, toast.expiresAt - (toast.createdAt || (toast.expiresAt - 8000)));
  const remaining = Math.max(0, toast.expiresAt - now);
  const pct = Math.max(0, Math.min(100, (remaining / total) * 100));
  const seconds = Math.ceil(remaining / 1000);
  return (
    <div className="bg-stone-900 text-stone-50 border border-stone-700 shadow-lg rounded-sm overflow-hidden">
      <div className="px-3 py-2 text-[12px] flex items-center gap-3">
        <RotateCcw size={12} className="shrink-0 text-stone-400" />
        <span className="flex-1 min-w-0 truncate">
          Deleted <em className="not-italic text-stone-200">{toast.label}</em>
        </span>
        <span className="text-[10px] font-mono text-stone-400 tabular-nums">{seconds}s</span>
        <button
          onClick={onRestore}
          className="text-[11px] font-mono uppercase tracking-wider px-2 py-0.5 border border-stone-500 hover:bg-stone-800"
          title="Undo this delete"
        >
          Undo
        </button>
        <button
          onClick={onDismiss}
          className="text-stone-400 hover:text-white"
          title="Dismiss"
        >
          <X size={12} />
        </button>
      </div>
      <div className="h-0.5 bg-stone-800">
        <div
          className="h-full bg-emerald-500 transition-[width] duration-100 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// Saved filter views. Persisted on team.settings.savedFilters as
// [{id, name, filters}]. Renders as a chip strip above the FilterBar.
// Clicking a chip applies its frozen filter set; × removes the saved view.
// "Save current" prompts for a name and freezes the current filters object.

export function ExportMenu({ copyExport, downloadExport, downloadMarkdownExport, downloadSnapshot, copyState }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items = [
    {
      key: "copy",
      label: copyState === "copied" ? "Copied to clipboard" : "Copy as text",
      Icon: copyState === "copied" ? Check : Copy,
      run: () => { copyExport(); },
    },
    {
      key: "txt",
      label: "Download .txt",
      Icon: FileDown,
      run: () => { downloadExport(); },
      sub: "Plain-text Slides format",
    },
    {
      key: "md",
      label: "Download .md",
      Icon: FileText,
      run: () => { downloadMarkdownExport(); },
      sub: "GitHub-Flavored Markdown — paste into Notion, GitHub, Obsidian",
    },
    {
      key: "snapshot",
      label: "Download JSON snapshot",
      Icon: DownloadCloud,
      run: () => { downloadSnapshot(); },
      sub: "Full-state backup; restorable from Settings",
    },
  ];

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Export and share this team's status"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-stone-900 text-stone-900 hover:bg-stone-900 hover:text-stone-50 transition"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <FileDown size={12} />Export
        <ChevronDown size={11} className="opacity-70" />
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute right-0 top-full mt-1 z-30 bg-white border border-stone-300 shadow-lg rounded-sm py-1 min-w-[230px]"
        >
          {items.map((it) => {
            const ItIcon = it.Icon;
            return (
              <li key={it.key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => { it.run(); setOpen(false); }}
                  className="w-full text-left px-3 py-2 text-[12px] font-mono flex items-start gap-2 hover:bg-stone-100"
                >
                  <ItIcon size={12} className="mt-0.5 shrink-0 text-stone-700" />
                  <span className="flex-1">
                    <span className="block text-stone-800">{it.label}</span>
                    {it.sub && <span className="block text-[10px] text-stone-500 mt-0.5">{it.sub}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Cheatsheet modal triggered by `?`. Lists every keyboard binding so the
// user can discover them without reading source. Click anywhere or press
// Esc to dismiss (Esc dismissal is wired in StatusTracker's keydown effect).

export function ShortcutsCheatsheet({ onClose }) {
  const trapRef = useFocusTrap(true);
  const items = [
    { keys: ["j"],     label: "Focus next priority" },
    { keys: ["k"],     label: "Focus previous priority" },
    { keys: ["x"],     label: "Toggle DONE on focused row" },
    { keys: ["c"],     label: "Create a new priority" },
    { keys: ["/"],     label: "Focus the search input" },
    { keys: ["?"],     label: "Toggle this cheatsheet" },
    { keys: ["Esc"],   label: "Close cheatsheet / dropdown / panel" },
  ];
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-stone-900/30 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div
        ref={trapRef}
        onClick={(e) => e.stopPropagation()}
        className="bg-white border border-stone-300 shadow-xl rounded-sm max-w-md w-full p-5"
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold tracking-[0.2em] uppercase text-stone-700">Keyboard shortcuts</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-900" title="Close">
            <X size={14} />
          </button>
        </div>
        <ul className="space-y-2">
          {items.map((it, i) => (
            <li key={i} className="flex items-center justify-between gap-3 text-[12px]">
              <span className="text-stone-700">{it.label}</span>
              <span className="flex gap-1">
                {it.keys.map((k) => (
                  <kbd key={k} className="px-1.5 py-0.5 text-[11px] font-mono bg-stone-100 border border-stone-300 rounded-sm text-stone-800">{k}</kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[11px] text-stone-500 leading-relaxed">
          Shortcuts only fire while the Today list is focused; typing in any input or textarea is unaffected.
        </p>
      </div>
    </div>
  );
}

// Hex values for the row-priority palette. Used for inline `<option>` text
// colors in the FilterBar dropdowns — Tailwind classes don't apply to
// `<option>` elements (the native dropdown rendering ignores most CSS
// classes); inline `style` on each option is the only reliably-styleable
// surface. Matches the swatch column of `lib/priority.js:PRIORITY_COLOR_CLASSES`.

export function TaskPanel({ team, task, onClose, onSwitchTask, updatePriority, updateItem, setPriorityStatus, setItemStatus }) {
  const { pid, iid } = task;
  const priority = team?.priorities?.find(p => p.id === pid);
  const item = iid ? priority?.items?.find(i => i.id === iid) : null;
  const target = item || priority || null;
  const trapRef = useFocusTrap(!!target);

  useEffect(() => {
    if (!target) { onClose(); return; }
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [target, onClose]);

  if (!target) return null;

  const setField = (fields) => {
    if (item) updateItem(pid, iid, fields);
    else updatePriority(pid, fields);
  };
  const onTitle    = (v) => setField({ title: v });
  const onAssign   = (v) => setField({ assignee: v });
  const onTicket   = (v) => setField({ ticket: v });
  const onType     = (v) => setField({ type: v });
  const onDue      = (v) => setField({ dueAt: v });
  const onDesc     = (v) => setField({ description: v });
  const onStatus   = (v) => {
    if (item) setItemStatus(priority, item, v);
    else setPriorityStatus(priority, v);
  };

  const crumb = item
    ? `${priority?.title || "(untitled)"} › ${item.title || "(untitled sub-task)"}`
    : (priority?.title || "(untitled)");

  return (
    <div
      ref={trapRef}
      role="dialog"
      aria-modal="true"
      aria-label="Task details"
      className="fixed inset-y-0 right-0 z-40 w-full sm:w-[480px] bg-white border-l border-stone-300 shadow-xl flex flex-col"
      style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
    >
      <header className="flex items-start gap-2 px-4 py-3 border-b border-stone-300">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-mono uppercase tracking-widest text-stone-500 mb-1 truncate">
            {crumb}
          </div>
          <div className="text-base font-semibold text-stone-900 break-words">
            <Editable
              value={target.title}
              onChange={onTitle}
              placeholder={item ? "Sub-task" : "What needs doing?"}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Close (Esc)"
          className="text-stone-400 hover:text-stone-900 mt-1 shrink-0"
        >
          <X size={16} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill status={target.status} onChange={onStatus} />
          {!item && (
            <PriorityPill
              priority={priority.priority}
              priorities={team?.settings?.priorities}
              onChange={(v) => updatePriority(pid, { priority: v })}
            />
          )}
          <TypeField
            value={target.type}
            options={team?.settings?.workTypes || []}
            onChange={onType}
          />
        </div>

        <section>
          <div className="text-[10px] font-mono uppercase tracking-widest text-stone-500 mb-1">Assignees</div>
          <AssigneeField
            value={target.assignee}
            createdAt={target.createdAt}
            assignedAt={target.assignedAt}
            doneAt={target.doneAt}
            onChange={onAssign}
          />
        </section>

        <section>
          <div className="text-[10px] font-mono uppercase tracking-widest text-stone-500 mb-1">Ticket</div>
          <TicketField value={target.ticket} onChange={onTicket} />
        </section>

        <section>
          <div className="text-[10px] font-mono uppercase tracking-widest text-stone-500 mb-1">Due</div>
          <DueField value={target.dueAt} status={target.status} onChange={onDue} />
        </section>

        <section>
          <div className="text-[10px] font-mono uppercase tracking-widest text-stone-500 mb-1">Description</div>
          <MarkdownEditor
            value={target.description || ""}
            onChange={onDesc}
            assigneeSuggestions={collectTeamAssignees(team)}
            placeholder="Notes, links, context, decisions… markdown supported."
          />
        </section>

        {!item && Array.isArray(priority?.items) && priority.items.length > 0 && (
          <section>
            <div className="text-[10px] font-mono uppercase tracking-widest text-stone-500 mb-1">
              Sub-tasks ({priority.items.length})
            </div>
            <ul className="space-y-1">
              {priority.items.map((it) => (
                <li key={it.id}>
                  <button
                    type="button"
                    onClick={() => onSwitchTask({ pid: priority.id, iid: it.id })}
                    className="w-full text-left px-2 py-1.5 border border-stone-200 hover:border-stone-900 bg-white text-[12px] flex items-center gap-2"
                  >
                    <StatusPill status={it.status} readOnly size="xs" onChange={() => {}} />
                    <span className={`flex-1 ${it.status === "done" ? "line-through text-stone-500" : ""}`}>
                      {it.title || "(untitled)"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="text-[10px] font-mono text-stone-500 leading-relaxed">
          Created: {target.createdAt ? fmtTimestamp(target.createdAt) : "—"} ·
          Assigned: {target.assignedAt ? fmtTimestamp(target.assignedAt) : "—"} ·
          Done: {target.doneAt ? fmtTimestamp(target.doneAt) : "—"}
        </section>
      </div>
    </div>
  );
}


export function PrioritiesEditor({ team, updateTeam }) {
  const list = team?.settings?.priorities || [];
  const palette = TW_PRIORITY_PALETTE;
  const [openSwatch, setOpenSwatch] = useState(null);
  const dragSrcRef = useRef(null);
  const swatchRef = useRef(null);

  useEffect(() => {
    if (openSwatch == null) return;
    const onDoc = (e) => { if (swatchRef.current && !swatchRef.current.contains(e.target)) setOpenSwatch(null); };
    const onKey = (e) => { if (e.key === "Escape") setOpenSwatch(null); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [openSwatch]);

  // Reordering only touches non-builtin entries; "normal" stays pinned at
  // the end with rank 99. After a drop we re-stamp ranks 0..N-1 by array
  // index so visible order == stored rank.
  const moveTo = (fromIdx, toIdx) => {
    updateTeam(t => {
      const arr = [...(t.settings.priorities || [])];
      const builtinIdx = arr.findIndex(p => p.key === "normal");
      const builtin = builtinIdx >= 0 ? arr.splice(builtinIdx, 1)[0] : null;
      const moved = arr.splice(fromIdx, 1)[0];
      const insertAt = Math.min(Math.max(toIdx, 0), arr.length);
      arr.splice(insertAt, 0, moved);
      arr.forEach((p, i) => { p.rank = i; });
      if (builtin) arr.push({ ...builtin, rank: 99 });
      t.settings.priorities = arr;
    });
  };

  const updateField = (key, fields) => {
    updateTeam(t => {
      const p = (t.settings.priorities || []).find(x => x.key === key);
      if (p) Object.assign(p, fields);
    });
  };

  const removeEntry = (key) => {
    if (key === "normal") return;
    updateTeam(t => {
      t.settings.priorities = (t.settings.priorities || []).filter(p => p.key !== key);
    });
  };

  const addEntry = () => {
    updateTeam(t => {
      const arr = t.settings.priorities || [];
      const builtinIdx = arr.findIndex(p => p.key === "normal");
      const newDef = { key: uid(), label: "New", color: "stone", rank: 99 };
      if (builtinIdx >= 0) {
        // insert before "normal", then re-stamp ranks for non-builtin entries
        const head = arr.slice(0, builtinIdx);
        const tail = arr.slice(builtinIdx);
        const next = [...head, newDef, ...tail];
        next.filter(p => p.key !== "normal").forEach((p, i) => { p.rank = i; });
        t.settings.priorities = next;
      } else {
        arr.push(newDef);
        arr.filter(p => p.key !== "normal").forEach((p, i) => { p.rank = i; });
      }
    });
  };

  const sortable = list.filter(p => p.key !== "normal");
  const builtin = list.find(p => p.key === "normal");

  return (
    <div className="bg-white/60 border border-stone-300 p-4 mt-4">
      <div className="text-[11px] font-mono uppercase tracking-wider text-stone-600 mb-2">Priorities</div>
      <p className="text-[11px] text-stone-500 mb-3 leading-relaxed">
        Configurable per-team urgency tiers. Edit labels, recolor, drag to reorder, or add custom levels. The bottom <em>—</em> entry represents <strong>no priority</strong> and stays pinned. Existing rows whose tier you delete render as <em>—</em> until restored or relinked.
      </p>
      <ul className="space-y-1.5 mb-2">
        {sortable.map((p, idx) => {
          const cls = priorityColorClasses(p.color);
          return (
            <li
              key={p.key}
              draggable
              onDragStart={() => { dragSrcRef.current = idx; }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const from = dragSrcRef.current;
                dragSrcRef.current = null;
                if (from == null || from === idx) return;
                moveTo(from, idx);
              }}
              className="flex items-center gap-2 group"
            >
              <span className="cursor-grab text-stone-400 hover:text-stone-700 select-none px-1" title="Drag to reorder">≡</span>
              <div className="relative" ref={openSwatch === p.key ? swatchRef : null}>
                <button
                  type="button"
                  onClick={() => setOpenSwatch(openSwatch === p.key ? null : p.key)}
                  className={`w-5 h-5 rounded-full ${cls.swatch} border border-stone-400`}
                  title={`Color: ${p.color}`}
                />
                {openSwatch === p.key && (
                  <div className="absolute left-0 top-full mt-1 z-30 bg-white border border-stone-300 shadow-lg rounded-sm p-2 grid grid-cols-7 gap-1 w-[180px]">
                    {palette.map((c) => {
                      const optCls = priorityColorClasses(c);
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() => { updateField(p.key, { color: c }); setOpenSwatch(null); }}
                          className={`w-5 h-5 rounded-full ${optCls.swatch} border ${p.color === c ? "border-stone-900 ring-1 ring-stone-900" : "border-stone-300"} hover:brightness-95`}
                          title={c}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
              <input
                type="text"
                value={p.label}
                onChange={(e) => updateField(p.key, { label: e.target.value })}
                placeholder="label"
                className="flex-1 px-2 py-1 border border-stone-300 text-xs font-mono bg-white outline-none focus:border-stone-900"
              />
              <button
                type="button"
                onClick={() => removeEntry(p.key)}
                title="Remove"
                className="text-stone-400 hover:text-red-600"
              >
                <X size={12} />
              </button>
            </li>
          );
        })}
        {sortable.length === 0 && (
          <li className="text-[11px] text-stone-500">No priorities yet. Add one below.</li>
        )}
        {builtin && (
          <li className="flex items-center gap-2 opacity-90">
            <span className="text-stone-300 select-none px-1" title="Built-in entry — cannot be reordered or removed">·</span>
            <span className={`w-5 h-5 rounded-full ${priorityColorClasses(builtin.color).swatch} border border-stone-300`} title="No-priority slot" />
            <input
              type="text"
              value={builtin.label}
              onChange={(e) => updateField(builtin.key, { label: e.target.value })}
              placeholder="—"
              className="flex-1 px-2 py-1 border border-stone-300 text-xs font-mono bg-white outline-none focus:border-stone-900"
            />
            <span className="text-[10px] font-mono text-stone-400 pr-1">builtin</span>
          </li>
        )}
      </ul>
      <button
        type="button"
        onClick={addEntry}
        className="inline-flex items-center gap-1 text-[11px] font-mono uppercase tracking-wider text-stone-600 hover:text-stone-900"
      >
        <Plus size={11} />Add priority
      </button>
    </div>
  );
}


export function SettingsView({ team, updateTeam, loadExampleData, postNow, postState, downloadSnapshot, restoreFromFile, storageKey = "status_tracker_v3", historyRetentionDays = 30 }) {
  if (!team) return null;
  const s = team.settings;
  const [testState, setTestState] = useState(null);
  const sendingRef = useRef(false);
  const restoreInputRef = useRef(null);

  const activeUrl = getActiveWebhookUrl(s);
  const activeId = s.activeWebhookId;

  const addWebhook = () => updateTeam(t => {
    const id = uid();
    t.settings.webhooks.push({ id, name: "", url: "" });
    if (!t.settings.activeWebhookId) t.settings.activeWebhookId = id;
  });

  const updateWebhook = (id, fields) => updateTeam(t => {
    const wh = t.settings.webhooks.find(w => w.id === id);
    if (wh) Object.assign(wh, fields);
  });

  const deleteWebhook = (id) => updateTeam(t => {
    t.settings.webhooks = t.settings.webhooks.filter(w => w.id !== id);
    if (t.settings.activeWebhookId === id) {
      t.settings.activeWebhookId = t.settings.webhooks[0]?.id || null;
    }
  });

  const setActiveWebhook = (id) => updateTeam(t => { t.settings.activeWebhookId = id; });

  const sendTest = async () => {
    if (sendingRef.current) return;
    if (!activeUrl) return;
    sendingRef.current = true;
    setTestState("posting");
    try {
      await postToChat(activeUrl, `*Status Tracker* test message — _${today()}_\nIf you see this, your webhook works.`);
      setTestState("ok");
    } catch (e) {
      console.error(e);
      setTestState("err");
    } finally {
      sendingRef.current = false;
      setTimeout(() => setTestState(null), 2500);
    }
  };

  return (
    <div className="max-w-xl">
      <h2 className="text-xs font-bold tracking-[0.2em] uppercase text-stone-700 mb-1">▸ Settings</h2>
      <p className="text-[11px] text-stone-500 mb-4">
        Settings below are scoped to team <strong>{team.name}</strong>. Each team has its own webhooks and auto-post schedule.
      </p>

      {/* ---- saved webhooks ---- */}
      <div className="bg-white/60 border border-stone-300 p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <label className="block text-[11px] font-mono uppercase tracking-wider text-stone-600">
            Google Chat webhooks
          </label>
          <button
            onClick={addWebhook}
            className="inline-flex items-center gap-1 text-[11px] font-mono uppercase tracking-wider text-stone-600 hover:text-stone-900"
            title="Add another webhook"
          >
            <Plus size={11} />Add
          </button>
        </div>

        {s.webhooks.length === 0 ? (
          <p className="text-[11px] text-stone-500 leading-relaxed">
            No webhooks saved. Click <strong>Add</strong> to paste a Google Chat incoming-webhook URL. Find it under
            space → <em>Apps & integrations</em> → <em>Manage webhooks</em>.
          </p>
        ) : (
          <ul className="space-y-2">
            {s.webhooks.map(wh => {
              const isActive = wh.id === activeId;
              return (
                <li
                  key={wh.id}
                  className={`border ${isActive ? "border-stone-900" : "border-stone-200"} bg-white p-2`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <input
                      type="radio"
                      name="active-webhook"
                      checked={isActive}
                      onChange={() => setActiveWebhook(wh.id)}
                      title="Use as active webhook"
                      className="cursor-pointer"
                    />
                    <input
                      type="text"
                      value={wh.name}
                      onChange={(e) => updateWebhook(wh.id, { name: e.target.value })}
                      placeholder="Name (e.g., #team-status)"
                      className="flex-1 px-2 py-1 border border-stone-300 text-xs font-mono bg-white outline-none focus:border-stone-900"
                    />
                    {isActive && (
                      <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-700 px-1.5 py-0.5 bg-emerald-100 border border-emerald-200">
                        Active
                      </span>
                    )}
                    <button
                      onClick={() => deleteWebhook(wh.id)}
                      title="Delete this webhook"
                      className="text-stone-400 hover:text-red-600"
                    >
                      <X size={12} />
                    </button>
                  </div>
                  <input
                    type="url"
                    value={wh.url}
                    onChange={(e) => updateWebhook(wh.id, { url: e.target.value.trim() })}
                    placeholder="https://chat.googleapis.com/v1/spaces/.../messages?key=...&token=..."
                    className="w-full px-2 py-1 border border-stone-300 text-[11px] font-mono bg-white outline-none focus:border-stone-900"
                  />
                </li>
              );
            })}
          </ul>
        )}

        <button
          onClick={sendTest}
          disabled={!activeUrl || testState === "posting"}
          className={`mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider transition ${testState === "ok" ? "bg-emerald-700 text-white" : testState === "err" ? "bg-red-700 text-white" : "bg-stone-900 text-white hover:bg-stone-700 disabled:bg-stone-300 disabled:text-stone-500"}`}
        >
          <Send size={12} />
          {testState === "posting" ? "Sending…" : testState === "ok" ? "Sent" : testState === "err" ? "Failed (check console)" : "Send test to active"}
        </button>
      </div>

      {/* ---- timezone ---- */}
      <div className="bg-white/60 border border-stone-300 p-4 mb-4">
        <label className="flex items-center gap-2 mb-2">
          <span className="text-sm font-mono">Timezone</span>
        </label>
        <select
          value={s.tz || ""}
          onChange={(e) => updateTeam(t => { t.settings.tz = e.target.value; })}
          className="w-full max-w-md px-2 py-1.5 border border-stone-400 bg-white text-xs font-mono"
          title="Used for due-date math (overdue checks, Chat ping timing)"
        >
          {COMMON_TIMEZONES.map((tz) => (
            <option key={tz.key} value={tz.key}>{tz.label}</option>
          ))}
        </select>
        <p className="text-[11px] text-stone-500 mt-2 leading-relaxed">
          Controls when a row counts as "overdue" for this team and when due-date Chat pings fire. <em>Use server default</em> falls back to the container's <code>TZ</code> env var (set in <code>docker-compose.yml</code>). If your team is in a different region from the server host, override here.
        </p>
      </div>

      {/* ---- auto-post ---- */}
      <div className="bg-white/60 border border-stone-300 p-4 mb-4">
        <div className="bg-amber-50 border border-amber-300 px-3 py-2 mb-3 text-[12px] text-amber-900 leading-relaxed">
          <strong>Browser-only.</strong> This toggle fires only while a tab is open — close the browser, no post. For real cron-style daily posting that runs even when your laptop is asleep, see the <a href="#apps-script-template" className="underline decoration-dotted hover:text-amber-700">Apps Script template</a> at the bottom of this page.
        </div>
        <label className="flex items-center gap-2 mb-3 cursor-pointer">
          <input
            type="checkbox"
            checked={s.autoPostEnabled}
            onChange={(e) => updateTeam(t => { t.settings.autoPostEnabled = e.target.checked; })}
          />
          <span className="text-sm font-mono">Auto-post daily summary to Chat</span>
        </label>
        <div className="flex items-center gap-2 text-xs font-mono text-stone-600">
          <span>at</span>
          <input
            type="number" min="0" max="23"
            value={s.autoPostHour}
            onChange={(e) => updateTeam(t => { t.settings.autoPostHour = Math.max(0, Math.min(23, +e.target.value || 0)); })}
            className="w-14 px-2 py-1 border border-stone-400 bg-white text-center"
          />
          <span>:</span>
          <input
            type="number" min="0" max="59"
            value={String(s.autoPostMinute).padStart(2, "0")}
            onChange={(e) => updateTeam(t => { t.settings.autoPostMinute = Math.max(0, Math.min(59, +e.target.value || 0)); })}
            className="w-14 px-2 py-1 border border-stone-400 bg-white text-center"
          />
          <span className="text-stone-500">(local time)</span>
        </div>

        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <button
            onClick={postNow}
            disabled={!activeUrl || postState === "posting"}
            title={activeUrl ? "Send the daily summary to the active webhook now" : "Add a webhook first"}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider transition ${postState === "error" ? "bg-red-700 text-white" : postState === "posted" ? "bg-emerald-700 text-white" : "bg-blue-700 text-white hover:bg-blue-800 disabled:bg-stone-300 disabled:text-stone-500"}`}
          >
            <Send size={12} />
            {postState === "posting" ? "Sending…" : postState === "posted" ? "Sent" : postState === "error" ? "Failed" : "Send now"}
          </button>
          <span className="text-[11px] text-stone-500">
            uses the active webhook
          </span>
        </div>

      </div>

      {/* ---- due-date notifications ---- */}
      <div className="bg-white/60 border border-stone-300 p-4 mb-4">
        <label className="flex items-center gap-2 mb-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!!s.notifyOnDue}
            onChange={async (e) => {
              const want = e.target.checked;
              if (want && typeof Notification !== "undefined" && Notification.permission !== "granted") {
                try {
                  const result = await Notification.requestPermission();
                  if (result !== "granted") {
                    alert("Notifications are blocked in this browser. Enable them in site settings, then toggle this on again.");
                    return;
                  }
                } catch {
                  return;
                }
              }
              updateTeam(t => { t.settings.notifyOnDue = want; });
            }}
          />
          <span className="text-sm font-mono inline-flex items-center gap-1.5">
            <Bell size={13} />Notify when tasks become due
          </span>
        </label>
        <p className="text-[11px] text-stone-500 leading-relaxed mb-3">
          Browser notification when a priority or sub-task crosses its due date in this team. If a Chat webhook is configured, the same ping is also posted there as a combined message — works even when this tab is closed (server-side scheduler).
        </p>

        <label className="flex items-center gap-2 mb-2 cursor-pointer">
          <input
            type="checkbox"
            checked={s.nagOverdue !== false}
            onChange={(e) => updateTeam(t => { t.settings.nagOverdue = e.target.checked; })}
            disabled={!s.notifyOnDue}
          />
          <span className={`text-sm font-mono inline-flex items-center gap-1.5 ${!s.notifyOnDue ? "text-stone-400" : ""}`}>
            <Bell size={13} />Also nag every {s.nagIntervalHours || 4}h for items still overdue
          </span>
        </label>
        <div className={`flex items-center gap-2 text-xs font-mono ml-6 ${!s.notifyOnDue ? "text-stone-400" : "text-stone-600"}`}>
          <span>interval (hours)</span>
          <input
            type="number" min="1" max="72"
            value={s.nagIntervalHours || 4}
            onChange={(e) => updateTeam(t => {
              const v = Math.max(1, Math.min(72, +e.target.value || 4));
              t.settings.nagIntervalHours = v;
            })}
            disabled={!s.notifyOnDue}
            className="w-14 px-2 py-1 border border-stone-400 bg-white text-center disabled:opacity-50"
          />
        </div>
        <p className={`text-[11px] mt-2 leading-relaxed ${!s.notifyOnDue ? "text-stone-400" : "text-stone-500"}`}>
          Fires re-pings (browser + Chat) for each row still overdue + still open. Disable to ping only at the original due moment.
        </p>
      </div>

      <details id="apps-script-template" className="bg-white/60 border border-stone-300 p-4 text-xs font-mono">
        <summary className="cursor-pointer text-stone-700">Apps Script template for true daily auto-post (no tab needed)</summary>
        <pre className="mt-3 text-[11px] bg-stone-900 text-stone-100 p-3 overflow-x-auto leading-relaxed whitespace-pre-wrap">{`// daily_post_to_chat.gs — runs even when your browser is closed.
// Setup: Apps Script (script.google.com) → New project → paste below.
//   Script Properties: WEBHOOK_URL = your Google Chat webhook
//                      MESSAGE_URL = a public URL serving plain-text status
// Run setup() once. It will install a daily 8:30am trigger.

const WEBHOOK_PROP = 'WEBHOOK_URL';
const MESSAGE_URL_PROP = 'MESSAGE_URL';

function setup() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('postDaily').timeBased().atHour(8).nearMinute(30).everyDays(1).create();
}

function postDaily() {
  const props = PropertiesService.getScriptProperties();
  const webhook = props.getProperty(WEBHOOK_PROP);
  const msgUrl = props.getProperty(MESSAGE_URL_PROP);
  if (!webhook) throw new Error('WEBHOOK_URL not set');

  const text = msgUrl
    ? UrlFetchApp.fetch(msgUrl).getContentText()
    : 'Daily check-in: please update the tracker.';

  UrlFetchApp.fetch(webhook, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ text })
  });
}`}</pre>
      </details>

      <PrioritiesEditor team={team} updateTeam={updateTeam} />

      <div className="bg-white/60 border border-stone-300 p-4 mt-4">
        <div className="text-[11px] font-mono uppercase tracking-wider text-stone-600 mb-2">Work types</div>
        <p className="text-[11px] text-stone-500 mb-3 leading-relaxed">
          Configurable per-team enum. Available on every task as the optional <strong>type</strong> tag and as a filter on the Today list. Removing a type does <em>not</em> clear it from existing tasks — old labels just stop appearing in the dropdown.
        </p>
        <ul className="space-y-1.5 mb-2">
          {(s.workTypes || []).map((t, idx) => (
            <li key={`${t}-${idx}`} className="flex items-center gap-2">
              <input
                type="text"
                value={t}
                onChange={(e) => {
                  const next = [...(s.workTypes || [])];
                  next[idx] = e.target.value;
                  updateTeam(team => { team.settings.workTypes = next.map(x => (x || "").trim()).filter(Boolean); });
                }}
                placeholder="type label"
                className="flex-1 px-2 py-1 border border-stone-300 text-xs font-mono bg-white outline-none focus:border-stone-900"
              />
              <button
                type="button"
                onClick={() => updateTeam(team => {
                  team.settings.workTypes = (team.settings.workTypes || []).filter((_, i) => i !== idx);
                })}
                title="Remove"
                className="text-stone-400 hover:text-red-600"
              >
                <X size={12} />
              </button>
            </li>
          ))}
          {(s.workTypes || []).length === 0 && (
            <li className="text-[11px] text-stone-500">No work types yet. Add some below.</li>
          )}
        </ul>
        <button
          type="button"
          onClick={() => updateTeam(team => {
            const list = team.settings.workTypes || [];
            team.settings.workTypes = [...list, ""];
          })}
          className="inline-flex items-center gap-1 text-[11px] font-mono uppercase tracking-wider text-stone-600 hover:text-stone-900"
        >
          <Plus size={11} />Add type
        </button>
      </div>

      <div className="bg-white/60 border border-stone-300 p-4 mt-4">
        <div className="text-[11px] font-mono uppercase tracking-wider text-stone-600 mb-2">Example data</div>
        <p className="text-[11px] text-stone-500 mb-3 leading-relaxed">
          Loads a sample dataset (10 priorities, sub-tasks, blockers, completed items) modeled after a real Daily Status Summary deck — useful for demos or for seeing the layout populated.
        </p>
        <button onClick={loadExampleData}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider border border-stone-700 text-stone-700 hover:bg-stone-700 hover:text-white transition">
          <Sparkles size={12} />
          {team.priorities.length > 0 ? "Replace with example data" : "Load example data"}
        </button>
      </div>

      <div className="bg-white/60 border border-stone-300 p-4 mt-4">
        <div className="text-[11px] font-mono uppercase tracking-wider text-stone-600 mb-2">Snapshot &amp; restore</div>
        <p className="text-[11px] text-stone-500 mb-3 leading-relaxed">
          <strong>Snapshot</strong> downloads a full-state JSON backup of every team in your account
          (priorities, history, archive, webhooks). The same file can be used to <strong>Restore</strong>
          if anything goes wrong — restore is destructive and replaces all teams in your account.
        </p>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <button
            onClick={downloadSnapshot}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider bg-stone-900 text-white hover:bg-stone-700 transition"
          >
            <DownloadCloud size={12} />Download snapshot
          </button>
        </div>
        <div className="border-t border-stone-200 pt-3">
          <div className="text-[11px] font-mono uppercase tracking-wider text-red-700 mb-2">
            ⚠ Restore from a backup file
          </div>
          <p className="text-[11px] text-stone-500 mb-2 leading-relaxed">
            Replaces ALL teams and data with the contents of the chosen JSON file. You'll be asked to confirm with a count summary before anything is replaced.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={restoreInputRef}
              type="file"
              accept="application/json"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) restoreFromFile(f);
                if (restoreInputRef.current) restoreInputRef.current.value = "";
              }}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => restoreInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider border border-red-700 text-red-700 hover:bg-red-700 hover:text-white transition"
            >
              <UploadCloud size={12} />Choose backup file…
            </button>
            <span className="text-[11px] text-stone-500">
              Tip: download a fresh snapshot first if you want a rollback path.
            </span>
          </div>
        </div>
      </div>

      <div className="mt-6 text-[11px] text-stone-500 font-mono">
        <p>Storage key: <code className="bg-stone-200 px-1">{storageKey}</code> · team id: <code className="bg-stone-200 px-1">{team.id}</code></p>
        <p>History retained: last {historyRetentionDays} days · last snapshot for this team: {team.lastSnapshotDate || "never"}</p>
        <p>Last auto-post for this team: {team.settings.lastAutoPostDate || "never"}</p>
      </div>
    </div>
  );
}
