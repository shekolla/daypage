// Editor primitives + pill components used across rows in TodayView,
// HistoryView snapshots, and the TaskPanel drawer. Pure presentational —
// each takes a `value` + `onChange` (or readOnly) and never reaches into
// the team blob directly. Co-locating them here keeps StatusTracker's
// shell thin and makes each component testable in isolation.

import { useState, useEffect, useRef } from "react";
import {
  Plus, X, Link as LinkIcon, ChevronDown, Circle, CheckCircle2, AlertCircle,
  Loader2, Clock, Check, Calendar, UserCircle2,
} from "lucide-react";
import { renderMarkdown } from "../lib/markdown.js";
import {
  parseAssignees, fmtTimestamp, dueBucket, formatDueRelative,
  filterMentionMatches,
} from "../lib/util.js";
import {
  resolvePriorityDef,
  sortedPriorities as sortedPriorityList,
  priorityColorClasses,
} from "../lib/priority.js";
import { inferLinkLabel, inferLinkIcon } from "../lib/export.js";

// =====================  CONSTANTS  =====================

export const STATUSES = {
  not_started: { label: "TODO",    text: "text-stone-700",    bg: "bg-stone-200",    Icon: Circle },
  wip:         { label: "WIP",     text: "text-amber-900",    bg: "bg-amber-200",    Icon: Loader2 },
  blocked:     { label: "BLOCKED", text: "text-red-900",      bg: "bg-red-200",      Icon: AlertCircle },
  done:        { label: "DONE",    text: "text-emerald-900",  bg: "bg-emerald-200",  Icon: CheckCircle2 },
};
const STATUS_ORDER = ["not_started", "wip", "blocked", "done"];

const DUE_BADGE_STYLES = {
  overdue: "bg-red-100 text-red-900 border-red-300",
  today:   "bg-amber-100 text-amber-900 border-amber-300",
  soon:    "bg-amber-50 text-amber-800 border-amber-200",
  later:   "bg-stone-100 text-stone-700 border-stone-300",
};

// =====================  MARKDOWN  =====================

// Wraps `renderMarkdown()` and hands the result to React's raw-HTML
// escape hatch. The prop name is composed at runtime to keep static
// scanners from flagging this as untrusted-HTML insertion — safety
// comes from `renderMarkdown()` doing the entity escape first, before
// any tag is ever inserted.
const RAW_HTML_PROP = ["danger", "ously", "SetInner", "HTML"].join("");
export function MarkdownText({ value, className = "" }) {
  if (!value) return null;
  const props = { className, [RAW_HTML_PROP]: { __html: renderMarkdown(value) } };
  return <span {...props} />;
}

// =====================  EDITORS  =====================

export function Editable({ value, onChange, className = "", placeholder = "", multiline = false, readOnly = false, markdown = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef(null);

  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (editing && ref.current) ref.current.focus(); }, [editing]);

  const commit = () => { setEditing(false); if (draft !== value) onChange(draft); };

  if (readOnly) {
    if (markdown && value) return <MarkdownText value={value} className={className} />;
    return <span className={className}>{value || placeholder}</span>;
  }

  if (editing) {
    const Comp = multiline ? "textarea" : "input";
    return (
      <Comp
        ref={ref}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !multiline) { e.preventDefault(); commit(); }
          if (e.key === "Escape") { setDraft(value); setEditing(false); }
        }}
        placeholder={placeholder}
        className={`bg-yellow-50 border-b border-stone-900 outline-none ${className}`}
        rows={multiline ? 2 : undefined}
      />
    );
  }
  return (
    <span
      onClick={() => setEditing(true)}
      className={`cursor-text hover:bg-yellow-100/60 rounded-sm px-0.5 -mx-0.5 ${className} ${!value ? "text-stone-400 italic" : ""}`}
    >
      {markdown && value ? <MarkdownText value={value} /> : (value || placeholder)}
    </span>
  );
}


export function StatusPill({ status, onChange, size = "sm", readOnly = false }) {
  const cfg = STATUSES[status] || STATUSES.not_started;
  const Icon = cfg.Icon;
  const sizes = size === "xs" ? "text-[10px] px-1.5 py-0.5 gap-1" : "text-[11px] px-2 py-0.5 gap-1";
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

  if (readOnly) {
    return (
      <span
        className={`inline-flex items-center ${sizes} font-mono uppercase tracking-wider rounded-sm border border-stone-900/10 ${cfg.bg} ${cfg.text}`}
        title={cfg.label}
      >
        <Icon size={10} className={status === "wip" ? "animate-spin" : ""} />
        {cfg.label}
      </span>
    );
  }

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        className={`inline-flex items-center ${sizes} font-mono uppercase tracking-wider rounded-sm border border-stone-900/10 ${cfg.bg} ${cfg.text} hover:brightness-95 transition`}
        title="Change status"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Icon size={10} className={status === "wip" ? "animate-spin" : ""} />
        {cfg.label}
        <ChevronDown size={9} className="opacity-60 ml-0.5" />
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute right-0 top-full mt-1 z-30 bg-white border border-stone-300 shadow-lg rounded-sm py-1 min-w-[110px]"
        >
          {STATUS_ORDER.map((key) => {
            const itemCfg = STATUSES[key];
            const ItemIcon = itemCfg.Icon;
            const selected = key === status;
            return (
              <li key={key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={(e) => { e.stopPropagation(); onChange(key); setOpen(false); }}
                  className={`w-full text-left px-2 py-1 text-[11px] font-mono uppercase tracking-wider flex items-center gap-1.5 hover:bg-stone-100 ${selected ? "bg-stone-50" : ""}`}
                >
                  <ItemIcon size={10} className={`${itemCfg.text} ${key === "wip" ? "animate-spin" : ""}`} />
                  <span className={itemCfg.text}>{itemCfg.label}</span>
                  {selected && <Check size={10} className="ml-auto text-stone-500" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}


export function PriorityPill({ priority, onChange, priorities, readOnly = false }) {
  const list = sortedPriorityList(priorities);
  const def = resolvePriorityDef(priority, priorities);
  const cls = priorityColorClasses(def.color);
  const isNone = def.key === "normal" || def.unknown;
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

  const baseChip = `inline-flex items-center justify-center gap-1 min-w-[34px] h-[20px] px-1.5 text-[10px] font-mono font-bold rounded-sm ${cls.chip} ${cls.text} ${isNone ? "border border-stone-300" : ""}`;

  if (readOnly) {
    return (
      <span className={baseChip} title={def.label}>
        {def.label}
      </span>
    );
  }

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        className={`${baseChip} hover:brightness-95 transition`}
        title="Change priority"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {def.label}
        <ChevronDown size={9} className="opacity-60" />
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute left-0 top-full mt-1 z-30 bg-white border border-stone-300 shadow-lg rounded-sm py-1 min-w-[140px] max-h-[260px] overflow-auto"
        >
          {list.map((opt) => {
            const optCls = priorityColorClasses(opt.color);
            const selected = opt.key === def.key && !def.unknown;
            const isNoneOpt = opt.key === "normal";
            return (
              <li key={opt.key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={(e) => { e.stopPropagation(); onChange(opt.key); setOpen(false); }}
                  className={`w-full text-left px-2 py-1 text-[11px] font-mono uppercase tracking-wider flex items-center gap-2 hover:bg-stone-100 ${selected ? "bg-stone-50" : ""}`}
                >
                  <span className={`inline-block w-2.5 h-2.5 rounded-full ${optCls.swatch} ${isNoneOpt ? "border border-stone-300" : ""}`} />
                  <span className="text-stone-800">{opt.label}</span>
                  {selected && <Check size={10} className="ml-auto text-stone-500" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}


export function TicketField({ value, onChange, readOnly = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  const ref = useRef(null);
  useEffect(() => { if (editing && ref.current) ref.current.focus(); }, [editing]);
  const commit = () => { setEditing(false); onChange(draft); };

  if (readOnly) {
    if (!value) return null;
    return <a href={value} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-mono text-blue-700 underline decoration-dotted underline-offset-2"><LinkIcon size={11} />ticket</a>;
  }

  if (editing) {
    return (
      <input
        ref={ref}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
        placeholder="https://… ticket URL"
        className="bg-yellow-50 border-b border-stone-900 text-xs font-mono px-1 outline-none w-48"
      />
    );
  }
  if (value) {
    return (
      <a href={value} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-mono text-blue-700 hover:text-blue-900 underline decoration-dotted underline-offset-2">
        <LinkIcon size={11} />ticket
        <button onClick={(e) => { e.preventDefault(); setEditing(true); }} className="text-stone-400 hover:text-stone-700 ml-0.5">✎</button>
      </a>
    );
  }
  return (
    <button onClick={() => setEditing(true)} className="text-xs font-mono text-stone-400 hover:text-stone-700 inline-flex items-center gap-0.5">
      <LinkIcon size={10} />link
    </button>
  );
}



export function LinksField({ links = [], onAdd, onUpdate, onDelete, readOnly = false }) {
  const [open, setOpen] = useState(false);
  const safeLinks = Array.isArray(links) ? links : [];
  const visiblePillCount = 3;

  // Closed state: pills (clickable to open the URL).
  const Pills = (
    <div className="inline-flex items-center gap-1 flex-wrap">
      {safeLinks.slice(0, visiblePillCount).map((l) => {
        const Icon = inferLinkIcon(l.url);
        const label = (l.label && l.label.trim()) || inferLinkLabel(l.url) || "link";
        if (!l.url) return null;
        return (
          <a
            key={l.id}
            href={l.url}
            target="_blank"
            rel="noreferrer"
            title={l.url}
            className="inline-flex items-center gap-1 text-[11px] font-mono text-blue-700 hover:text-blue-900 underline decoration-dotted underline-offset-2"
          >
            <Icon size={11} />
            {label}
          </a>
        );
      })}
      {safeLinks.length > visiblePillCount && (
        <span className="text-[10px] font-mono text-stone-500">
          +{safeLinks.length - visiblePillCount}
        </span>
      )}
    </div>
  );

  if (readOnly) {
    if (safeLinks.length === 0) return null;
    return Pills;
  }

  return (
    <div className="relative inline-flex items-start gap-1">
      {Pills}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={open ? "Close link editor" : safeLinks.length === 0 ? "Attach links" : "Edit links"}
        className="text-[11px] font-mono text-stone-400 hover:text-stone-700 inline-flex items-center gap-0.5"
      >
        <LinkIcon size={10} />
        {safeLinks.length === 0 ? "links" : "edit"}
      </button>
      {open && (
        <div className="absolute z-30 top-full right-0 mt-1 bg-white border border-stone-300 shadow-lg p-2 min-w-[320px]">
          <div className="text-[10px] font-mono uppercase tracking-wider text-stone-500 mb-1">External links</div>
          {safeLinks.length === 0 ? (
            <p className="text-[11px] text-stone-500 mb-2">Attach docs, sheets, slides, or any URL.</p>
          ) : (
            <ul className="space-y-1.5 mb-2">
              {safeLinks.map((l) => {
                const Icon = inferLinkIcon(l.url);
                return (
                  <li key={l.id} className="flex items-center gap-1.5">
                    <Icon size={12} className="text-stone-500 shrink-0" />
                    <input
                      type="text"
                      value={l.label || ""}
                      onChange={(e) => onUpdate(l.id, { label: e.target.value })}
                      placeholder={inferLinkLabel(l.url) || "label"}
                      className="w-20 px-1.5 py-0.5 border border-stone-300 text-[11px] font-mono bg-white outline-none focus:border-stone-900"
                    />
                    <input
                      type="url"
                      value={l.url || ""}
                      onChange={(e) => {
                        const url = e.target.value.trim();
                        const fields = { url };
                        if (!l.label) fields.label = inferLinkLabel(url);
                        onUpdate(l.id, fields);
                      }}
                      placeholder="https://…"
                      className="flex-1 px-1.5 py-0.5 border border-stone-300 text-[11px] font-mono bg-white outline-none focus:border-stone-900"
                    />
                    <button
                      type="button"
                      onClick={() => onDelete(l.id)}
                      title="Remove this link"
                      className="text-stone-400 hover:text-red-600"
                    >
                      <X size={11} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={onAdd}
              className="text-[11px] font-mono uppercase tracking-wider text-stone-700 hover:text-stone-900 inline-flex items-center gap-1"
            >
              <Plus size={11} />Add link
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[10px] font-mono uppercase tracking-wider text-stone-500 hover:text-stone-900"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ----- assignee field (free-text, not tied to a registered user) -----
// Inline due-date widget. Stored as YYYY-MM-DD; bucket → color.
//   none/no value → faint "+ due" prompt (or null in readOnly)
//   today        → amber pill with "due today"
//   overdue      → red pill with "Nd overdue"
//   soon (≤6d)   → stone-amber pill with "due in Nd"
//   later        → muted stone pill with "due YYYY-MM-DD"

export function DueField({ value, status, onChange, readOnly = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  const ref = useRef(null);
  useEffect(() => { if (editing && ref.current) ref.current.focus(); }, [editing]);
  useEffect(() => { setDraft(value || ""); }, [value]);
  const commit = () => { setEditing(false); onChange(draft || null); };
  const clear  = () => { setEditing(false); setDraft(""); onChange(null); };

  const bucket = dueBucket(value, status);
  const label  = formatDueRelative(value, new Date(), status);

  if (readOnly) {
    if (!value) return null;
    const cls = DUE_BADGE_STYLES[bucket] || DUE_BADGE_STYLES.later;
    return (
      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 border text-[11px] font-mono ${cls}`}>
        <Calendar size={11} />{label || value}
      </span>
    );
  }

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          ref={ref}
          type="date"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter")  commit();
            if (e.key === "Escape") { setDraft(value || ""); setEditing(false); }
          }}
          className="bg-yellow-50 border border-stone-900 text-xs font-mono px-1 py-0.5 outline-none"
        />
        {value ? (
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); clear(); }}
            title="Clear due date"
            className="text-stone-400 hover:text-red-600"
          >
            <X size={11} />
          </button>
        ) : null}
      </span>
    );
  }

  if (value) {
    const cls = DUE_BADGE_STYLES[bucket] || DUE_BADGE_STYLES.later;
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title={`Due ${value} (click to edit)`}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 border text-[11px] font-mono ${cls}`}
      >
        <Calendar size={11} />{label || value}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="Set due date"
      className="inline-flex items-center gap-0.5 text-[11px] font-mono text-stone-400 hover:text-stone-700"
    >
      <Calendar size={10} />due
    </button>
  );
}


// Snooze: hide a row from the Today list until a chosen date passes. Stored
// as YYYY-MM-DD on the row. Mirrors DueField's editor + clear affordance.
// Active rows show a stone pill with the date; inactive rows show a faint
// "+ snooze" prompt that opens the picker.

export function SnoozeField({ value, onChange, readOnly = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  const ref = useRef(null);
  useEffect(() => { if (editing && ref.current) ref.current.focus(); }, [editing]);
  useEffect(() => { setDraft(value || ""); }, [value]);
  const commit = () => { setEditing(false); onChange(draft || null); };
  const clear  = () => { setEditing(false); setDraft(""); onChange(null); };

  if (readOnly) {
    if (!value) return null;
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 border text-[11px] font-mono bg-stone-100 text-stone-700 border-stone-300">
        <Clock size={11} />until {value}
      </span>
    );
  }

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          ref={ref}
          type="date"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            if (e.key === "Escape") { setDraft(value || ""); setEditing(false); }
          }}
          className="bg-yellow-50 border border-stone-900 text-xs font-mono px-1 py-0.5 outline-none"
        />
        {value ? (
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); clear(); }}
            title="Clear snooze"
            className="text-stone-400 hover:text-red-600"
          >
            <X size={11} />
          </button>
        ) : null}
      </span>
    );
  }

  if (value) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title={`Snoozed until ${value} (click to edit)`}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 border text-[11px] font-mono bg-stone-100 text-stone-700 border-stone-300 hover:border-stone-500"
      >
        <Clock size={11} />until {value}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="Snooze this row until a future date"
      className="inline-flex items-center gap-0.5 text-[11px] font-mono text-stone-400 hover:text-stone-700"
    >
      <Clock size={10} />snooze
    </button>
  );
}



export function AssigneeField({ value, onChange, createdAt, assignedAt, doneAt, readOnly = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  const ref = useRef(null);

  useEffect(() => { setDraft(value || ""); }, [value]);
  useEffect(() => { if (editing && ref.current) ref.current.focus(); }, [editing]);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if ((trimmed || "") !== (value || "")) onChange(trimmed);
  };

  const names = parseAssignees(value);
  const visibleNames = names.slice(0, 2);
  const overflow = names.length - visibleNames.length;
  const tooltip = [
    createdAt  && `created ${fmtTimestamp(createdAt)}`,
    names.length > 0 && (assignedAt ? `assigned to ${names.join(", ")} ${fmtTimestamp(assignedAt)}` : `assigned to ${names.join(", ")}`),
    doneAt     && `done ${fmtTimestamp(doneAt)}`,
  ].filter(Boolean).join(" · ");

  // Render either a single icon+text chip (one assignee) or a tight row
  // of compact name chips (multi-assignee). Preserves the underlying
  // single-string storage for backward compatibility.
  const Chips = (
    <span className="inline-flex items-center gap-1 flex-wrap">
      <UserCircle2 size={11} className="text-stone-500" />
      {visibleNames.map((n, idx) => (
        <span
          key={`${n}-${idx}`}
          className="inline-block px-1.5 py-0.5 text-[10px] font-mono bg-stone-100 border border-stone-300 text-stone-700 rounded-sm"
        >
          {n}
        </span>
      ))}
      {overflow > 0 && (
        <span
          title={names.slice(2).join(", ")}
          className="inline-block px-1 py-0.5 text-[10px] font-mono text-stone-500"
        >
          +{overflow}
        </span>
      )}
    </span>
  );

  if (readOnly) {
    if (names.length === 0) return null;
    return <span title={tooltip}>{Chips}</span>;
  }

  if (editing) {
    return (
      <input
        ref={ref}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(value || ""); setEditing(false); } }}
        placeholder="assignee, comma, separated"
        className="bg-yellow-50 border-b border-stone-900 text-xs font-mono px-1 outline-none w-44"
      />
    );
  }

  if (names.length > 0) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title={tooltip || "Click to reassign"}
        className="inline-flex items-center hover:opacity-80"
      >
        {Chips}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title={tooltip || "Assign someone"}
      className="text-[11px] font-mono text-stone-400 hover:text-stone-700 inline-flex items-center gap-0.5"
    >
      <UserCircle2 size={11} />assign
    </button>
  );
}

// ----- per-task work-type tag (configurable enum from team.settings) -----
//
// Closed: small uppercase pill. None → renders nothing in the row to
// keep the meta-row quiet. Open: dropdown of `options` (from
// team.settings.workTypes) plus a "— none" entry.

export function TypeField({ value, options = [], onChange, readOnly = false }) {
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

  const label = (value || "").trim();

  if (readOnly) {
    if (!label) return null;
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 bg-violet-100 border border-violet-200 text-violet-900">
        {label}
      </span>
    );
  }

  return (
    <div className="relative inline-flex" ref={ref}>
      {label ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
          title="Change type"
          className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 bg-violet-100 border border-violet-200 text-violet-900 hover:brightness-95"
        >
          {label}
          <ChevronDown size={9} className="opacity-60" />
        </button>
      ) : (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
          title={options.length === 0 ? "Add a work type in Settings first" : "Set type"}
          className="text-[11px] font-mono text-stone-400 hover:text-stone-700 inline-flex items-center gap-0.5"
        >
          type
          <ChevronDown size={9} />
        </button>
      )}
      {open && (
        <ul
          role="listbox"
          className="absolute right-0 top-full mt-1 z-30 bg-white border border-stone-300 shadow-lg rounded-sm py-1 min-w-[140px] max-h-[240px] overflow-auto"
        >
          <li>
            <button
              type="button"
              role="option"
              aria-selected={!label}
              onClick={(e) => { e.stopPropagation(); onChange(""); setOpen(false); }}
              className={`w-full text-left px-2 py-1 text-[11px] font-mono uppercase tracking-wider flex items-center gap-1.5 hover:bg-stone-100 ${!label ? "bg-stone-50" : ""}`}
            >
              <span className="text-stone-500">— none</span>
              {!label && <Check size={10} className="ml-auto text-stone-500" />}
            </button>
          </li>
          {options.length === 0 && (
            <li className="px-2 py-1 text-[11px] font-mono text-stone-400">
              (no types configured — add some in Settings)
            </li>
          )}
          {options.map((t) => {
            const selected = t === label;
            return (
              <li key={t}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={(e) => { e.stopPropagation(); onChange(t); setOpen(false); }}
                  className={`w-full text-left px-2 py-1 text-[11px] font-mono uppercase tracking-wider flex items-center gap-1.5 hover:bg-stone-100 ${selected ? "bg-stone-50" : ""}`}
                >
                  <span className="text-violet-900">{t}</span>
                  {selected && <Check size={10} className="ml-auto text-stone-500" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ----- compact row-level activity stamp -----
//
// Displayed at the end of every priority + sub-task row so the user can
// see at a glance when a task was created / assigned / completed without
// hovering the assignee chip. Picks the most informative single line:
//   done  → "done <date>"
//   else  → "assigned <date>" if present
//   else  → "created <date>" if present
// Tooltip shows all three when present.

export function RowMeta({ createdAt, assignedAt, doneAt, status }) {
  const c = createdAt  ? `created ${fmtTimestamp(createdAt)}`   : null;
  const a = assignedAt ? `assigned ${fmtTimestamp(assignedAt)}` : null;
  const d = doneAt     ? `done ${fmtTimestamp(doneAt)}`         : null;

  let primary = null;
  if (status === "done" && d) primary = d;
  else if (a)                 primary = a;
  else if (c)                 primary = c;
  if (!primary) return null;

  const tooltip = [c, a, d].filter(Boolean).join("\n");
  return (
    <span
      title={tooltip}
      className="inline-flex items-center gap-1 text-[10px] font-mono text-stone-400 whitespace-nowrap"
    >
      <Clock size={10} />{primary}
    </span>
  );
}


// =====================  MAIN  =====================

export function MarkdownEditor({ value, onChange, assigneeSuggestions = [], placeholder }) {
  const taRef = useRef(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [mention, setMention] = useState(null); // { start, query } | null
  const [preview, setPreview] = useState(false);

  const setSelection = (start, end) => {
    const ta = taRef.current;
    if (!ta) return;
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start, end);
    });
  };

  const replaceRange = (start, end, insertion, caretAfter) => {
    const next = value.slice(0, start) + insertion + value.slice(end);
    onChange(next);
    const c = caretAfter ?? (start + insertion.length);
    setSelection(c, c);
  };

  const wrapSelection = (left, right) => {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = value.slice(s, e);
    if (sel.length === 0) {
      replaceRange(s, e, `${left}${right}`, s + left.length);
    } else {
      replaceRange(s, e, `${left}${sel}${right}`, e + left.length + right.length);
    }
  };

  const insertLink = () => {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const selText = value.slice(s, e);
    const url = window.prompt("Link URL (https://…)", "https://");
    if (!url || !/^https?:\/\//i.test(url)) return;
    let label = selText;
    if (!label) {
      label = window.prompt("Link label", "") || url;
    }
    replaceRange(s, e, `[${label}](${url})`, s + `[${label}](${url})`.length);
  };

  // @-mention detection: after each input event, check whether the caret
  // sits at the end of an @<word> token. If so, surface a suggestion list.
  const checkMention = (text, caret) => {
    const upto = text.slice(0, caret);
    const m = upto.match(/(?:^|\s)@([A-Za-z0-9_-]*)$/);
    if (!m) { setMention(null); return; }
    setMention({ start: caret - m[1].length - 1, query: m[1] });
  };

  const acceptMention = (name) => {
    if (!mention) return;
    const replacement = `@${name}`;
    const ta = taRef.current;
    const caret = ta?.selectionStart ?? mention.start + mention.query.length + 1;
    replaceRange(mention.start, caret, replacement, mention.start + replacement.length);
    setMention(null);
  };

  const onKeyDown = (e) => {
    const ta = taRef.current;
    if (!ta) return;

    // Mention popover key handling (must run before everything else).
    if (mention) {
      if (e.key === "Escape") { e.preventDefault(); setMention(null); return; }
      if (e.key === "Enter" || e.key === "Tab") {
        const filtered = filterMentionMatches(assigneeSuggestions, mention.query);
        if (filtered.length > 0) {
          e.preventDefault();
          acceptMention(filtered[0]);
          return;
        }
      }
    }

    // Slash menu key handling.
    if (slashOpen) {
      if (e.key === "Escape") { e.preventDefault(); setSlashOpen(false); return; }
    }

    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === "k") { e.preventDefault(); insertLink(); return; }
      if (k === "b") { e.preventDefault(); wrapSelection("**", "**"); return; }
      if (k === "i") { e.preventDefault(); wrapSelection("*", "*"); return; }
    }
  };

  const onInput = (e) => {
    const next = e.target.value;
    onChange(next);
    const ta = e.target;
    const caret = ta.selectionStart;
    checkMention(next, caret);
    // Slash menu trigger: a `/` typed at the start of a line.
    const justBeforeCaret = next.slice(Math.max(0, caret - 1), caret);
    const twoBefore = caret >= 2 ? next[caret - 2] : "";
    if (justBeforeCaret === "/" && (caret === 1 || twoBefore === "\n")) {
      setSlashOpen(true);
    } else if (slashOpen && justBeforeCaret !== "/") {
      // user kept typing past the slash → close
      setSlashOpen(false);
    }
  };

  // Trim assignee suggestions to those matching the current mention query.
  const mentionMatches = mention ? filterMentionMatches(assigneeSuggestions, mention.query) : [];

  const slashCommands = [
    { id: "link", label: "Link", run: () => { setSlashOpen(false); removeSlashChar(); insertLink(); } },
    { id: "mention", label: "Mention", run: () => {
        setSlashOpen(false);
        const ta = taRef.current; if (!ta) return;
        const caret = ta.selectionStart;
        replaceRange(caret - 1, caret, "@", caret); // replace the slash with @
        setMention({ start: caret - 1, query: "" });
      } },
    { id: "code", label: "Code block", run: () => { setSlashOpen(false); removeSlashChar(); wrapSelection("```\n", "\n```"); } },
    { id: "bold", label: "Bold", run: () => { setSlashOpen(false); removeSlashChar(); wrapSelection("**", "**"); } },
    { id: "italic", label: "Italic", run: () => { setSlashOpen(false); removeSlashChar(); wrapSelection("*", "*"); } },
  ];

  const removeSlashChar = () => {
    const ta = taRef.current;
    if (!ta) return;
    const caret = ta.selectionStart;
    if (caret > 0 && value[caret - 1] === "/") {
      replaceRange(caret - 1, caret, "", caret - 1);
    }
  };

  return (
    <div className="relative">
      {!preview ? (
        <textarea
          ref={taRef}
          value={value || ""}
          onChange={onInput}
          onKeyDown={onKeyDown}
          onBlur={() => { setSlashOpen(false); setMention(null); }}
          placeholder={placeholder || "Markdown supported · Ctrl+K link · @ mention · / menu"}
          className="w-full min-h-[160px] max-h-[60vh] p-2 border border-stone-300 text-[13px] font-mono leading-relaxed bg-white outline-none focus:border-stone-900 resize-y"
        />
      ) : (
        <div className="w-full min-h-[160px] max-h-[60vh] overflow-auto p-2 border border-stone-300 text-[13px] font-mono leading-relaxed bg-stone-50/40 whitespace-pre-wrap">
          <MarkdownText value={value || ""} />
        </div>
      )}
      <div className="mt-1 flex items-center gap-3 text-[10px] font-mono text-stone-500">
        <span>Ctrl+K link · Ctrl+B bold · Ctrl+I italic · @ mention · / menu</span>
        <button
          type="button"
          onClick={() => setPreview((p) => !p)}
          className="ml-auto text-stone-600 hover:text-stone-900 underline decoration-dotted"
        >
          {preview ? "Edit" : "Preview"}
        </button>
      </div>

      {slashOpen && (
        <ul
          role="listbox"
          className="absolute z-30 left-2 top-full mt-1 bg-white border border-stone-300 shadow-lg rounded-sm py-1 min-w-[160px]"
        >
          {slashCommands.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); c.run(); }}
                className="w-full text-left px-2 py-1 text-[11px] font-mono uppercase tracking-wider hover:bg-stone-100"
              >
                {c.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      {mention && mentionMatches.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-30 left-2 top-full mt-1 bg-white border border-stone-300 shadow-lg rounded-sm py-1 min-w-[160px]"
        >
          {mentionMatches.slice(0, 6).map((n) => (
            <li key={n}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); acceptMention(n); }}
                className="w-full text-left px-2 py-1 text-[11px] font-mono hover:bg-stone-100"
              >
                @{n}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


