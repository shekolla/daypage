import { STATUS_LABELS } from "./constants.js";

export function diffPriorities(prev, curr) {
  const prevP = new Map((prev || []).map(p => [p.id, p]));
  const currP = new Map((curr || []).map(p => [p.id, p]));
  const out = {
    addedPriorities: [],
    removedPriorities: [],
    statusFlips: [],
    addedItems: [],
    removedItems: [],
    itemStatusFlips: [],
    newBlockers: [],
  };
  for (const p of (curr || [])) {
    const pp = prevP.get(p.id);
    if (!pp) { out.addedPriorities.push(p); continue; }
    if (pp.status !== p.status) out.statusFlips.push({ p, from: pp.status, to: p.status });
    if (p.status === "blocked" && pp.status !== "blocked") out.newBlockers.push({ p });

    const ppItems = new Map(pp.items.map(it => [it.id, it]));
    const pItems = new Map(p.items.map(it => [it.id, it]));
    for (const it of p.items) {
      const ppi = ppItems.get(it.id);
      if (!ppi) { out.addedItems.push({ p, it }); continue; }
      if (ppi.status !== it.status) out.itemStatusFlips.push({ p, it, from: ppi.status, to: it.status });
      if (it.status === "blocked" && ppi.status !== "blocked") out.newBlockers.push({ p, it });
    }
    for (const it of pp.items) if (!pItems.has(it.id)) out.removedItems.push({ p, it });
  }
  for (const p of (prev || [])) if (!currP.has(p.id)) out.removedPriorities.push(p);
  return out;
}

export function diffIsEmpty(d) {
  return !d ||
    (d.addedPriorities.length + d.removedPriorities.length + d.statusFlips.length +
     d.addedItems.length + d.removedItems.length + d.itemStatusFlips.length === 0);
}

export function buildDiffText(diff) {
  if (!diff) return "(no previous snapshot)";
  if (diffIsEmpty(diff)) return "(no changes since previous snapshot)";
  const lines = [];
  if (diff.newBlockers.length) {
    lines.push("🚨 NEW BLOCKERS");
    diff.newBlockers.forEach(b => lines.push(b.it ? `  • ${b.p.title} → ${b.it.title}` : `  • ${b.p.title}`));
    lines.push("");
  }
  if (diff.addedPriorities.length) {
    lines.push("➕ NEW PRIORITIES");
    diff.addedPriorities.forEach(p => lines.push(`  • ${p.title || "(untitled)"}`));
    lines.push("");
  }
  if (diff.statusFlips.length) {
    lines.push("🔄 STATUS — PRIORITIES");
    diff.statusFlips.forEach(f => lines.push(`  • ${f.p.title}: ${STATUS_LABELS[f.from]} → ${STATUS_LABELS[f.to]}`));
    lines.push("");
  }
  if (diff.itemStatusFlips.length) {
    lines.push("🔄 STATUS — SUB-TASKS");
    diff.itemStatusFlips.forEach(f => lines.push(`  • ${f.p.title} → ${f.it.title}: ${STATUS_LABELS[f.from]} → ${STATUS_LABELS[f.to]}`));
    lines.push("");
  }
  if (diff.addedItems.length) {
    lines.push("➕ NEW SUB-TASKS");
    diff.addedItems.forEach(({ p, it }) => lines.push(`  • ${p.title} → ${it.title || "(untitled)"}`));
    lines.push("");
  }
  if (diff.removedPriorities.length || diff.removedItems.length) {
    lines.push("➖ REMOVED");
    diff.removedPriorities.forEach(p => lines.push(`  • ${p.title}`));
    diff.removedItems.forEach(({ p, it }) => lines.push(`  • ${p.title} → ${it.title}`));
  }
  return lines.join("\n").trim();
}
