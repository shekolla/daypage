// Priority resolution + Tailwind class table. Pure JS — no React, no DOM.
//
// Priorities live on team.settings.priorities ([{key,label,color,rank,builtin?}]).
// The row's `priority` field stores a key into that list. Lookup is forgiving:
// missing or stale keys resolve to a synthetic unknown-def so the UI never
// crashes after a user deletes/renames an entry.

import { DEFAULT_PRIORITIES } from "./constants.js";

const UNKNOWN_DEF = Object.freeze({
  key: "__unknown__",
  label: "—",
  color: "stone",
  rank: 99,
  unknown: true,
});

export function resolvePriorityDef(key, list) {
  const arr = Array.isArray(list) && list.length > 0 ? list : DEFAULT_PRIORITIES;
  const found = arr.find(p => p && p.key === key);
  return found || UNKNOWN_DEF;
}

export function priorityRank(key, list) {
  const def = resolvePriorityDef(key, list);
  return def.unknown ? Number.MAX_SAFE_INTEGER : def.rank;
}

export function isTopUrgency(key, list) {
  const def = resolvePriorityDef(key, list);
  return !def.unknown && def.rank === 0;
}

// Returns the priorities list sorted by rank ascending. Builtin "normal"
// always lands last regardless of its stored rank, so the dropdown reads
// urgency-first with the "no priority" slot at the bottom.
export function sortedPriorities(list) {
  const arr = Array.isArray(list) && list.length > 0 ? list : DEFAULT_PRIORITIES;
  return [...arr].sort((a, b) => {
    if (a.key === "normal") return 1;
    if (b.key === "normal") return -1;
    return (a.rank ?? 99) - (b.rank ?? 99);
  });
}

// Static lookup table — every entry uses literal class strings so Tailwind's
// JIT compiler picks them up. Building strings like `bg-${color}-300` at
// runtime would be purged. Keys must match TW_PRIORITY_PALETTE exactly.
//
// Fields:
//   chip      — pill background ("bg-yellow-300")
//   text      — pill foreground ("text-yellow-950")
//   border    — pill border ("border-yellow-400")
//   swatch    — circle indicator inside dropdowns ("bg-yellow-400")
//   rowBg     — row body background tint when this priority highlights ("bg-yellow-100/60")
//   rowBorder — row left-edge accent ("border-yellow-400")
export const PRIORITY_COLOR_CLASSES = {
  red:      { chip: "bg-red-300",      text: "text-red-950",      border: "border-red-400",      swatch: "bg-red-500",      rowBg: "bg-red-100/70",      rowBorder: "border-red-500" },
  orange:   { chip: "bg-orange-300",   text: "text-orange-950",   border: "border-orange-400",   swatch: "bg-orange-500",   rowBg: "bg-orange-100/60",   rowBorder: "border-orange-500" },
  amber:    { chip: "bg-amber-300",    text: "text-amber-950",    border: "border-amber-400",    swatch: "bg-amber-500",    rowBg: "bg-amber-100/60",    rowBorder: "border-amber-500" },
  yellow:   { chip: "bg-yellow-300",   text: "text-yellow-950",   border: "border-yellow-400",   swatch: "bg-yellow-500",   rowBg: "bg-yellow-100/60",   rowBorder: "border-yellow-500" },
  lime:     { chip: "bg-lime-300",     text: "text-lime-950",     border: "border-lime-400",     swatch: "bg-lime-500",     rowBg: "bg-lime-100/60",     rowBorder: "border-lime-500" },
  emerald:  { chip: "bg-emerald-300",  text: "text-emerald-950",  border: "border-emerald-400",  swatch: "bg-emerald-500",  rowBg: "bg-emerald-100/60",  rowBorder: "border-emerald-500" },
  teal:     { chip: "bg-teal-300",     text: "text-teal-950",     border: "border-teal-400",     swatch: "bg-teal-500",     rowBg: "bg-teal-100/60",     rowBorder: "border-teal-500" },
  blue:     { chip: "bg-blue-300",     text: "text-blue-950",     border: "border-blue-400",     swatch: "bg-blue-500",     rowBg: "bg-blue-100/60",     rowBorder: "border-blue-500" },
  indigo:   { chip: "bg-indigo-300",   text: "text-indigo-950",   border: "border-indigo-400",   swatch: "bg-indigo-500",   rowBg: "bg-indigo-100/60",   rowBorder: "border-indigo-500" },
  violet:   { chip: "bg-violet-300",   text: "text-violet-950",   border: "border-violet-400",   swatch: "bg-violet-500",   rowBg: "bg-violet-100/60",   rowBorder: "border-violet-500" },
  fuchsia:  { chip: "bg-fuchsia-300",  text: "text-fuchsia-950",  border: "border-fuchsia-400",  swatch: "bg-fuchsia-500",  rowBg: "bg-fuchsia-100/60",  rowBorder: "border-fuchsia-500" },
  pink:     { chip: "bg-pink-300",     text: "text-pink-950",     border: "border-pink-400",     swatch: "bg-pink-500",     rowBg: "bg-pink-100/60",     rowBorder: "border-pink-500" },
  stone:    { chip: "bg-transparent", text: "text-stone-400",    border: "border-stone-300",    swatch: "bg-stone-300",    rowBg: "",                   rowBorder: "border-stone-300" },
};

export function priorityColorClasses(color) {
  return PRIORITY_COLOR_CLASSES[color] || PRIORITY_COLOR_CLASSES.stone;
}
