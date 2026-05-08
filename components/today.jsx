// Today view's controls — saved-filter chip strip and the chip-styled
// FilterBar (and its FilterChip + AssigneeChip subcomponents). The Today
// list itself stays in status_tracker.jsx so it can read directly from
// the shell's state + handlers without prop-drilling 30 callbacks.

import { useState, useEffect, useRef } from "react";
import { X, Plus } from "lucide-react";
import { sortedPriorities as sortedPriorityList } from "../lib/priority.js";

// =====================  CONSTANTS  =====================

// Hex values for the row-priority palette. Used for inline `<option>` text
// colors in the FilterBar dropdowns — Tailwind classes don't apply to
// `<option>` elements (the native dropdown rendering ignores most CSS
// classes); inline `style` on each option is the only reliably-styleable
// surface. Matches the swatch column of `lib/priority.js:PRIORITY_COLOR_CLASSES`.
const PRIORITY_HEX = {
  red:     "#b91c1c",   // red-700
  orange:  "#c2410c",   // orange-700
  amber:   "#b45309",   // amber-700
  yellow:  "#a16207",   // yellow-700
  lime:    "#4d7c0f",   // lime-700
  emerald: "#047857",   // emerald-700
  teal:    "#0f766e",   // teal-700
  blue:    "#1d4ed8",   // blue-700
  indigo:  "#4338ca",   // indigo-700
  violet:  "#6d28d9",   // violet-700
  fuchsia: "#a21caf",   // fuchsia-700
  pink:    "#be185d",   // pink-700
  stone:   "#78716c",   // stone-500
};
const STATUS_HEX = {
  not_started: "#57534e",   // stone-600 — neutral
  wip:         "#b45309",   // amber-700
  blocked:     "#b91c1c",   // red-700
  done:        "#047857",   // emerald-700
};

export function SavedFiltersBar({ saved, currentFilters, filtersActive, onApply, onSave, onRemove }) {
  if ((!saved || saved.length === 0) && !filtersActive) return null;
  const handleSave = () => {
    const name = (typeof window !== "undefined" ? window.prompt("Name for this filter view?") : "")?.trim();
    if (!name) return;
    onSave(name);
  };
  const isActive = (f) => {
    const keys = ["priority", "status", "type", "due", "assignee", "search"];
    return keys.every(k => (f.filters[k] || "") === (currentFilters[k] || ""));
  };
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5">
      {(saved || []).map((f) => {
        const active = isActive(f);
        return (
          <span
            key={f.id}
            className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono uppercase tracking-wider border rounded-sm group ${active ? "bg-amber-100 text-amber-950 border-amber-700 font-semibold" : "bg-white/70 text-stone-700 border-stone-300 hover:border-stone-500"}`}
          >
            <button onClick={() => onApply(f.filters)} className="truncate max-w-[160px]" title={`Apply: ${f.name}`}>
              {f.name}
            </button>
            <button
              onClick={() => onRemove(f.id)}
              className={`opacity-0 group-hover:opacity-100 transition ${active ? "text-amber-700 hover:text-amber-950" : "text-stone-400 hover:text-red-600"}`}
              title="Remove saved view"
            >
              <X size={10} />
            </button>
          </span>
        );
      })}
      {filtersActive && (
        <button
          onClick={handleSave}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono uppercase tracking-wider border border-dashed border-stone-400 rounded-sm text-stone-600 hover:text-stone-900 hover:border-stone-900"
          title="Save current filters as a named view"
        >
          <Plus size={10} /> Save current
        </button>
      )}
    </div>
  );
}

// Header export menu. Collapses Copy / Download .txt / Snapshot JSON
// into a single dropdown — three variants of "extract this team's data"
// don't deserve three header buttons. Mirrors the StatusPill listbox
// pattern (aria-haspopup, role=option, esc-to-close, click-outside cleanup).

export function FilterChip({ value, onChange, options, title, disabled = false }) {
  const isActive = value !== "" && value != null;
  const baseChip = "h-7 pl-2 pr-1 text-[11px] font-mono uppercase tracking-wider border rounded-sm appearance-none cursor-pointer outline-none transition";
  const activeCls = "bg-amber-100 text-amber-950 border-amber-700 hover:bg-amber-200 font-semibold";
  const inactiveCls = "bg-white/70 text-stone-500 border-stone-300 hover:border-stone-500";
  return (
    <span className="inline-flex items-stretch">
      <select
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        title={title}
        className={`${baseChip} ${isActive ? activeCls : inactiveCls} ${isActive ? "rounded-r-none border-r-0" : ""} disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {options.map(({ value: v, label, color }) => (
          <option
            key={v}
            value={v}
            style={{ backgroundColor: "#ffffff", color: color || "#1c1917", fontWeight: 500 }}
          >
            {label}
          </option>
        ))}
      </select>
      {isActive && (
        <button
          type="button"
          onClick={() => onChange("")}
          title="Clear this filter"
          aria-label="Clear filter"
          className="h-7 min-w-9 px-1 flex items-center justify-center bg-amber-100 text-amber-900 border border-amber-700 border-l-amber-300 rounded-r-sm hover:bg-amber-200"
        >
          <X size={11} />
        </button>
      )}
    </span>
  );
}

// Free-text assignee chip — `<input>` instead of `<select>` because it's a
// case-insensitive substring match, not enumerable.

export function AssigneeChip({ value, onChange }) {
  const isActive = (value || "").trim() !== "";
  const base = "h-7 px-2 text-[11px] font-mono uppercase tracking-wider border rounded-sm outline-none transition w-28";
  const activeCls = "bg-amber-100 text-amber-950 border-amber-700 placeholder-amber-700 font-semibold";
  const inactiveCls = "bg-white/70 text-stone-700 border-stone-300 placeholder-stone-400 focus:border-stone-500";
  return (
    <span className="inline-flex items-stretch">
      <input
        type="text"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder="assignee"
        title="Filter by assignee (substring match)"
        className={`${base} ${isActive ? activeCls : inactiveCls} ${isActive ? "rounded-r-none border-r-0" : ""}`}
      />
      {isActive && (
        <button
          type="button"
          onClick={() => onChange("")}
          title="Clear this filter"
          aria-label="Clear filter"
          className="h-7 min-w-9 px-1 flex items-center justify-center bg-amber-100 text-amber-900 border border-amber-700 border-l-amber-300 rounded-r-sm hover:bg-amber-200"
        >
          <X size={11} />
        </button>
      )}
    </span>
  );
}


export function FilterBar({ filters, setFilters, workTypes, priorities, total, shown, hidden, onClear, searchInputRef }) {
  const active = filters.priority || filters.status || filters.type || filters.due || filters.snoozed ||
    (filters.assignee || "").trim() || (filters.search || "").trim();
  const set = (k, v) => setFilters({ ...filters, [k]: v });

  const priorityOptions = [
    { value: "", label: "Priority" },
    ...sortedPriorityList(priorities).map(p => ({
      value: p.key,
      label: p.key === "normal" ? "— (none)" : p.label,
      color: PRIORITY_HEX[p.color] || PRIORITY_HEX.stone,
    })),
  ];
  const statusOptions = [
    { value: "", label: "Status" },
    { value: "not_started", label: "TODO",    color: STATUS_HEX.not_started },
    { value: "wip",         label: "WIP",     color: STATUS_HEX.wip },
    { value: "blocked",     label: "BLOCKED", color: STATUS_HEX.blocked },
    { value: "done",        label: "DONE",    color: STATUS_HEX.done },
  ];
  const typeOptions = [
    { value: "", label: "Type" },
    ...workTypes.map(t => ({ value: t, label: t })),
  ];
  const dueOptions = [
    { value: "", label: "Due" },
    { value: "overdue", label: "Overdue" },
    { value: "today", label: "Due today" },
    { value: "week", label: "Due this week" },
    { value: "any", label: "Has due date" },
    { value: "none", label: "No due date" },
  ];
  const snoozedOptions = [
    { value: "", label: "Hide snoozed" },
    { value: "show", label: "Show all" },
    { value: "only", label: "Only snoozed" },
  ];

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      <input
        ref={searchInputRef}
        type="text"
        value={filters.search}
        onChange={(e) => set("search", e.target.value)}
        placeholder="Search title, description, notes…  (press / to focus)"
        className="h-7 flex-1 min-w-[200px] px-2 text-xs font-mono bg-white border border-stone-300 rounded-sm outline-none focus:border-stone-900"
      />
      <FilterChip value={filters.priority} onChange={(v) => set("priority", v)} options={priorityOptions} title="Filter by priority" />
      <FilterChip value={filters.status}   onChange={(v) => set("status", v)}   options={statusOptions}   title="Filter by status" />
      <FilterChip value={filters.type}     onChange={(v) => set("type", v)}     options={typeOptions}     title="Filter by type" disabled={workTypes.length === 0} />
      <FilterChip value={filters.due}      onChange={(v) => set("due", v)}      options={dueOptions}      title="Filter by due date" />
      <FilterChip value={filters.snoozed}  onChange={(v) => set("snoozed", v)}  options={snoozedOptions}  title="Snoozed visibility" />
      <AssigneeChip value={filters.assignee} onChange={(v) => set("assignee", v)} />
      {active && (
        <>
          <button
            onClick={onClear}
            title="Clear all filters"
            className="h-7 px-2 text-[11px] font-mono uppercase tracking-wider border border-stone-700 text-stone-700 hover:bg-stone-700 hover:text-white transition rounded-sm"
          >
            Clear
          </button>
          <span className="text-[11px] font-mono text-stone-500 ml-auto">
            {shown} shown · {hidden} hidden of {total}
          </span>
        </>
      )}
    </div>
  );
}

// Slide-out task drawer. Opens on click of the row's "doc"/"doc+" button.
// Renders the same fields as the row but stacked vertically with room
// for a multi-line description. Closes on Esc or X.
// Description editor with markdown shortcuts (Ctrl+K/B/I), slash menu,
// and @-mention autocomplete. Storage stays plain markdown text — the
// editor only mutates the buffer + caret, never invents formatting.
