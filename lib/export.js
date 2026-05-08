// External-link helpers + Slides-format text export. The icon helper returns
// Lucide React component references (not JSX), so it stays pure JS — callers
// that render it (`<Icon />`) live in status_tracker.jsx.

import { FileText, Table2, Presentation, Globe2 } from "lucide-react";
import { STATUS_LABELS } from "./constants.js";
import { resolvePriorityDef } from "./priority.js";
import { fmtTimestamp } from "./util.js";

export function inferLinkLabel(url) {
  if (!url) return "";
  let host = "";
  let pathname = "";
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    pathname = u.pathname.toLowerCase();
  } catch {
    return "link";
  }
  if (host === "docs.google.com") {
    if (pathname.startsWith("/document"))     return "doc";
    if (pathname.startsWith("/spreadsheets")) return "sheet";
    if (pathname.startsWith("/presentation")) return "deck";
    if (pathname.startsWith("/forms"))        return "form";
    return "doc";
  }
  if (host === "drive.google.com")             return "drive";
  if (host.endsWith("github.com"))             return "github";
  if (host.endsWith("notion.so"))              return "notion";
  if (host.endsWith("slack.com"))              return "slack";
  return host.replace(/^www\./, "") || "link";
}

export function inferLinkIcon(url) {
  if (!url) return Globe2;
  let host = "";
  let pathname = "";
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    pathname = u.pathname.toLowerCase();
  } catch {
    return Globe2;
  }
  if (host === "docs.google.com") {
    if (pathname.startsWith("/document"))     return FileText;
    if (pathname.startsWith("/spreadsheets")) return Table2;
    if (pathname.startsWith("/presentation")) return Presentation;
    if (pathname.startsWith("/forms"))        return FileText;
    return FileText;
  }
  return Globe2;
}

export function exportLinkSummary(links) {
  if (!Array.isArray(links) || links.length === 0) return "";
  const labels = links
    .filter((l) => l.url)
    .map((l) => (l.label && l.label.trim()) || inferLinkLabel(l.url))
    .filter(Boolean);
  return labels.length ? ` [Links: ${labels.join(", ")}]` : "";
}

// ---------------- Markdown export -----------------------------------------
//
// GitHub-Flavored Markdown for the active team. Designed to render cleanly
// in any GFM viewer (GitHub, Notion paste, Obsidian, VS Code preview).
// Pairs with buildExport() (plain-text Slides format) — same data, two
// audiences. Used for retro docs, weekly summaries, PR descriptions.
//
// Title and description fields in this app are already user-authored
// markdown — we pass them through verbatim, matching how the in-app
// <MarkdownText> renders them. Escaping titles would defeat that.

const mdStrike = (text, on) => (on ? `~~${text}~~` : text);

const mdLinks = (links) => {
  if (!Array.isArray(links) || links.length === 0) return "";
  return links
    .filter((l) => l && l.url)
    .map((l) => `[${(l.label && l.label.trim()) || inferLinkLabel(l.url)}](${l.url})`)
    .join(" · ");
};

const mdMetaParts = (row) => {
  const parts = [];
  if (row.assignee) parts.push(`**@${row.assignee}**`);
  if (row.ticket) parts.push(`[ticket](${row.ticket})`);
  if (row.status === "done" && row.doneAt) {
    parts.push(`done ${fmtTimestamp(row.doneAt)}`);
  } else if (row.dueAt && row.status !== "done") {
    parts.push(`due ${row.dueAt}`);
  }
  const links = mdLinks(row.links);
  if (links) parts.push(links);
  return parts.join(" · ");
};

const mdBlockquote = (text) => {
  if (!text) return "";
  return text.split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n");
};

export function buildMarkdownExport(team) {
  const lines = [];
  const priorities = team.settings?.priorities;
  const items = team.priorities || [];

  // Header
  lines.push(`# ${team.title || "Daily Status Summary"}`);
  lines.push("");
  const headerSub = [];
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  headerSub.push(`**${todayStr}**`);
  if (team.subtitle) headerSub.push(team.subtitle);
  lines.push(headerSub.join(" · "));
  lines.push("");

  // Stats blockquote — same numbers as the on-page header strip.
  const stats = items.reduce(
    (acc, p) => {
      acc.total += 1;
      acc[p.status] = (acc[p.status] || 0) + 1;
      (p.items || []).forEach((it) => {
        acc.subtotal += 1;
        acc[`sub_${it.status}`] = (acc[`sub_${it.status}`] || 0) + 1;
      });
      return acc;
    },
    { total: 0, subtotal: 0 }
  );
  const statBits = [
    `${stats.total} priorities`,
    `${stats.subtotal} sub-items`,
  ];
  if (stats.wip) statBits.push(`${stats.wip} WIP`);
  if (stats.blocked) statBits.push(`${stats.blocked} blocked`);
  if (stats.done) statBits.push(`${stats.done} done`);
  if ((team.archive?.length || 0) > 0) statBits.push(`${team.archive.length} archived`);
  lines.push(`> ${statBits.join(" · ")}`);
  lines.push("");

  if (items.length === 0) {
    return lines.join("\n").trimEnd() + "\n";
  }

  lines.push("## Team Priorities / Ongoing Works");
  lines.push("");

  items.forEach((p, i) => {
    const def = resolvePriorityDef(p.priority, priorities);
    const showTag = p.priority && p.priority !== "normal" && !def.unknown;
    const tag = showTag ? `\`${def.label}\` ` : "";
    const titleText = p.title || "(untitled)";
    const titleRendered = mdStrike(titleText, p.status === "done");
    const statusSuffix = p.status !== "not_started" ? ` — ${STATUS_LABELS[p.status]}` : "";
    lines.push(`### ${i + 1}. ${tag}${titleRendered}${statusSuffix}`);
    lines.push("");

    const meta = mdMetaParts(p);
    if (meta) {
      lines.push(meta);
      lines.push("");
    }

    if ((p.description || "").trim()) {
      lines.push(mdBlockquote(p.description.trim()));
      lines.push("");
    }

    const subs = p.items || [];
    if (subs.length === 0) {
      lines.push("- (no sub-tasks)");
    } else {
      subs.forEach((it) => {
        const checkbox = it.status === "done" ? "[x]" : "[ ]";
        const itTitle = mdStrike(it.title || "(untitled)", it.status === "done");
        const itStatus = it.status !== "not_started" && it.status !== "done"
          ? ` **${STATUS_LABELS[it.status]}** —`
          : "";
        const itMeta = mdMetaParts(it);
        const metaTail = itMeta ? ` · ${itMeta}` : "";
        lines.push(`- ${checkbox}${itStatus} ${itTitle}${metaTail}`);
        (it.notes || []).forEach((n) => {
          const noteContent = n.content || "(empty)";
          lines.push(`  - _${n.date}_ — ${noteContent}`);
        });
      });
    }

    lines.push("");
    if (i < items.length - 1) {
      lines.push("---");
      lines.push("");
    }
  });

  return lines.join("\n").trimEnd() + "\n";
}

export function buildExport(data) {
  const lines = [];
  const priorities = data.settings?.priorities;
  lines.push(data.title);
  lines.push("");
  lines.push("Team Priorities / Ongoing Works");
  lines.push("");
  data.priorities.forEach((p, i) => {
    const pDef = resolvePriorityDef(p.priority, priorities);
    const showTag = p.priority && p.priority !== "normal" && !pDef.unknown;
    const pTag = showTag ? `(${pDef.label}) ` : "";
    const pStat = p.status !== "not_started" ? ` – ${STATUS_LABELS[p.status]}` : "";
    const pTicket = p.ticket ? ` [Ticket: ${p.ticket}]` : "";
    const pLinks = exportLinkSummary(p.links);
    const pOwner = p.assignee ? ` @${p.assignee}` : "";
    const pDone = p.status === "done" && p.doneAt ? ` (done ${fmtTimestamp(p.doneAt)})` : "";
    const pDue  = p.dueAt && p.status !== "done" ? ` (due ${p.dueAt})` : "";
    lines.push(`${i + 1}. ${pTag}${p.title || "(untitled)"}${pOwner}${pStat}${pDue}${pDone}${pTicket}${pLinks}`);
    p.items.forEach((it, j) => {
      const iStat = it.status !== "not_started" ? ` – ${STATUS_LABELS[it.status]}` : "";
      const iTicket = it.ticket ? ` [Ticket: ${it.ticket}]` : "";
      const iLinks = exportLinkSummary(it.links);
      const iOwner = it.assignee ? ` @${it.assignee}` : "";
      const iDone = it.status === "done" && it.doneAt ? ` (done ${fmtTimestamp(it.doneAt)})` : "";
      const iDue  = it.dueAt && it.status !== "done" ? ` (due ${it.dueAt})` : "";
      lines.push(`    ${i + 1}.${j + 1}. ${it.title || "(untitled)"}${iOwner}${iStat}${iDue}${iDone}${iTicket}${iLinks}`);
      it.notes.forEach((n, k) => {
        lines.push(`        ${i + 1}.${j + 1}.${k + 1}. ${n.content || "(empty)"} – ${n.date}`);
      });
    });
  });
  return lines.join("\n");
}
