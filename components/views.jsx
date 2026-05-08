// Read-only views: Help, History, Insights, plus DiffSection used by the
// Diff view body that still lives inline in StatusTracker. None of these
// mutate the team blob — they read derived state and render. Insights does
// its own memo'd derivation via lib/insights.js helpers.

import { useMemo } from "react";
import { today } from "../lib/util.js";
import {
  sortedPriorities as sortedPriorityList,
  priorityColorClasses,
} from "../lib/priority.js";
import {
  collectAllRows,
  windowRange,
  summaryFor,
  velocityByDay,
  assigneePivot,
} from "../lib/insights.js";
import {
  PriorityPill, StatusPill, TicketField, LinksField, AssigneeField,
  DueField, RowMeta,
} from "./fields.jsx";

// =====================  CONSTANTS  =====================

const INSIGHTS_WINDOWS = [
  { id: "today",   label: "Today",      days: 1 },
  { id: "week",    label: "This week",  days: 7 },
  { id: "2weeks",  label: "2 weeks",    days: 14 },
  { id: "month",   label: "1 month",    days: 30 },
];

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatDayLabel(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return `${WEEKDAY_SHORT[dt.getDay()]} ${String(d).padStart(2, "0")}`;
}

export function DiffSection({ title, color, children }) {
  const colors = {
    red:     "border-red-300 bg-red-50",
    emerald: "border-emerald-300 bg-emerald-50",
    blue:    "border-blue-300 bg-blue-50",
    stone:   "border-stone-300 bg-stone-50",
  };
  return (
    <div className={`border-l-4 ${colors[color] || colors.stone} px-4 py-3`}>
      <div className="text-[11px] font-mono uppercase tracking-wider text-stone-700 mb-2">{title}</div>
      <ul className="list-disc pl-5 space-y-1 text-[13px] text-stone-800">{children}</ul>
    </div>
  );
}

// Static help / what's-here page. Lives next to History/Settings as a
// regular tab. Lists every non-obvious feature with the exact key names,
// filter options, and field paths so a new user can discover them without
// reading source. Keep terse — this is reference, not marketing.

export function HelpView({ onOpenShortcuts }) {
  const Section = ({ title, children }) => (
    <section className="bg-white/60 border border-stone-300 p-4 mb-3">
      <h3 className="text-[11px] font-bold tracking-[0.2em] uppercase text-stone-700 mb-2">{title}</h3>
      <div className="text-[13px] text-stone-800 leading-relaxed space-y-2">{children}</div>
    </section>
  );
  const Kbd = ({ children }) => (
    <kbd className="inline-block px-1.5 py-0.5 text-[11px] font-mono bg-stone-100 border border-stone-300 rounded-sm text-stone-800 align-middle">{children}</kbd>
  );
  const Tag = ({ children, color = "stone" }) => {
    const map = {
      red: "bg-red-100 text-red-900 border-red-300",
      yellow: "bg-yellow-200 text-yellow-950 border-yellow-300",
      orange: "bg-orange-200 text-orange-950 border-orange-300",
      blue: "bg-blue-200 text-blue-950 border-blue-300",
      stone: "bg-stone-100 text-stone-800 border-stone-300",
      emerald: "bg-emerald-100 text-emerald-900 border-emerald-300",
      amber: "bg-amber-100 text-amber-900 border-amber-300",
    };
    return <span className={`inline-block px-1.5 py-0.5 text-[10px] font-mono border rounded-sm ${map[color] || map.stone}`}>{children}</span>;
  };

  return (
    <div className="max-w-3xl">
      <div className="mb-5">
        <h2 className="text-xs font-bold tracking-[0.2em] uppercase text-stone-700">▸ Help</h2>
        <p className="text-[12px] text-stone-500 mt-1">
          Reference for everything the tracker can do. Press <Kbd>?</Kbd> anywhere to see keyboard shortcuts.
        </p>
      </div>

      <Section title="The basics">
        <p>
          Every team has its own <strong>priorities</strong> (top-level items) with optional <strong>sub-tasks</strong>. Click any title to edit it inline — markdown shortcuts work for <code>**bold**</code>, <code>*italic*</code>, <code>`code`</code>, and <code>[link](url)</code>.
        </p>
        <p>
          Status cycles per row: <Tag>TODO</Tag> <Tag color="amber">WIP</Tag> <Tag color="red">BLOCKED</Tag> <Tag color="emerald">DONE</Tag>. Marking a parent DONE asks before cascading to its sub-tasks.
        </p>
        <p>
          Auto-save is debounced ~500ms after every edit. The bottom-right corner shows when the last write hit the server.
        </p>
      </Section>

      <Section title="Priorities & P0">
        <p>
          The chip on every row is a <em>dropdown</em>: <Tag color="red">P0</Tag> <Tag color="yellow">P1</Tag> <Tag color="orange">P2</Tag> <Tag color="blue">P3</Tag> <Tag>—</Tag>. P0 rows get a thick red left border and a tinted background so they stand out from P1.
        </p>
        <p>
          Settings → <strong>Priorities</strong> is where you customize per team: rename labels, pick from 13 colors, drag to reorder, add new tiers, or delete the ones you don't use. The bottom <em>—</em> entry is the "no priority" slot and stays pinned.
        </p>
        <p>
          Sort order on the Today list follows the configured rank (top of the list = highest urgency).
        </p>
      </Section>

      <Section title="Snooze">
        <p>
          Click the <Kbd>snooze</Kbd> chip on any row's meta line and pick a date to hide it from Today until that date passes. Snoozed rows reappear automatically the morning after.
        </p>
        <p>
          The <em>Hide snoozed</em> filter at the top right of the FilterBar controls visibility:
        </p>
        <ul className="list-disc pl-5">
          <li><strong>Hide snoozed</strong> (default) — the row is invisible during the snooze window.</li>
          <li><strong>Show all</strong> — every row, including snoozed ones, with a stone "until YYYY-MM-DD" pill.</li>
          <li><strong>Only snoozed</strong> — quick way to see what you've parked.</li>
        </ul>
        <p className="text-[12px] text-stone-500">
          Stored as <code>snoozedUntil: YYYY-MM-DD</code> on the row. Snoozing never changes status.
        </p>
      </Section>

      <Section title="Due dates">
        <p>
          Click <Kbd>due</Kbd> to set a date. The pill colors itself by bucket: <Tag color="red">overdue</Tag> <Tag color="amber">today</Tag> <Tag color="amber">due in Nd</Tag> <Tag>later</Tag>. Done rows always show neutral styling — no nagging on closed work.
        </p>
        <p>
          Settings → toggle <strong>Notify on due</strong> to get a browser notification when a row crosses its due moment (tab must be open; uses the standard Notification permission prompt).
        </p>
      </Section>

      <Section title="Insights">
        <p>
          Open the <strong>Insights</strong> tab for team-wide flow metrics. Pick a window — Today / This week / 2 weeks / 1 month (rolling N days, not calendar weeks). Four cards up top: <em>Created</em>, <em>Closed</em> (incl. archived), <em>Open P0/P1</em>, and <em>Top assignees</em> by current open load.
        </p>
        <p>
          The <strong>Velocity</strong> chart below those cards is a hand-rolled SVG: green bars for created-that-day, blue for closed-that-day. Hover any bar for the exact daily counts.
        </p>
        <p>
          The <strong>By assignee</strong> table at the bottom expands every comma-separated assignee independently (so a row owned by "Alice, Bob" counts toward both). Per-priority columns show the open WIP / blocked split; the rightmost column shows what each person closed within the selected window. Sorted by total descending; <em>Unassigned</em> always last.
        </p>
        <p className="text-[12px] text-stone-500">
          Snooze is intentionally ignored here — for load analysis, snoozed work still counts as on your plate.
        </p>
      </Section>

      <Section title="Saved filter views">
        <p>
          Set up the FilterBar however you want — priority, status, type, due, assignee, search, snoozed visibility — then click <strong>Save current</strong> above the bar. Name it (e.g. <em>"WIP for me"</em>, <em>"P0 + P1 only"</em>) and it appears as a chip you can click to re-apply later. Hover the chip to reveal the <Kbd>×</Kbd> remove button.
        </p>
        <p className="text-[12px] text-stone-500">
          Stored as <code>settings.savedFilters: [&#123;id, name, filters&#125;]</code> per team.
        </p>
      </Section>

      <Section title="Keyboard shortcuts">
        <p>
          <button onClick={onOpenShortcuts} className="underline decoration-dotted">Open the cheatsheet</button> for the full list. The essentials:
        </p>
        <ul className="list-disc pl-5">
          <li><Kbd>j</Kbd> / <Kbd>k</Kbd> — focus next / previous priority (visual ring on the row).</li>
          <li><Kbd>x</Kbd> — toggle DONE on the focused row.</li>
          <li><Kbd>c</Kbd> — create a new top-level priority.</li>
          <li><Kbd>/</Kbd> — focus the search input.</li>
          <li><Kbd>?</Kbd> — toggle the cheatsheet modal.</li>
          <li><Kbd>Esc</Kbd> — close cheatsheet, dropdown, or task panel.</li>
        </ul>
        <p className="text-[12px] text-stone-500">
          Shortcuts skip themselves while any input or textarea has focus, so typing in a title field never hijacks <Kbd>j</Kbd>.
        </p>
      </Section>

      <Section title="Undo (oops) toast">
        <p>
          Deleting any priority or sub-task pops a toast in the bottom-left for 8 seconds with a green countdown bar. Click <strong>Undo</strong> to splice the row back at its original position with everything intact (assignees, dueAt, sub-tasks, links, notes).
        </p>
        <p className="text-[12px] text-stone-500">
          Up to 4 toasts stack. Each one can be dismissed independently with the <Kbd>×</Kbd>.
        </p>
      </Section>

      <Section title="Task drawer (descriptions)">
        <p>
          Click <Kbd>doc</Kbd> on any row to open the side drawer. Long-form description with markdown editing: <Kbd>Ctrl</Kbd>+<Kbd>B</Kbd>/<Kbd>I</Kbd> to bold/italicize, <Kbd>Ctrl</Kbd>+<Kbd>K</Kbd> for a link, <Kbd>@</Kbd> to mention an assignee, <Kbd>/</Kbd> at the start of a line for the slash menu (link, code block, etc.). Toggle <strong>Preview</strong> to see the rendered markdown.
        </p>
      </Section>

      <Section title="Snapshots, history, archive">
        <p>
          Every day the first time you open the app, the previous day's state is captured into <strong>History</strong> (last 30 days kept). The <strong>Diff</strong> tab shows what changed since that snapshot.
        </p>
        <p>
          Anything DONE for {">"}24h auto-moves to <strong>Archive</strong> — sub-tasks <em>and</em> top-level priorities both archive on the same dwell. Archived rows can be restored at any time.
        </p>
        <p>
          Settings → <strong>Snapshot</strong> downloads the entire JSON state for every team — restorable from the same panel.
        </p>
      </Section>

      <Section title="Webhooks & auto-post">
        <p>
          Settings → add a Google Chat webhook URL (must be <code>https://chat.googleapis.com/...</code>) and pick one as active. Use <strong>Send now</strong> to manually post the current status, or toggle <strong>Auto-post</strong> with an hour:minute to fire daily while a tab is open.
        </p>
        <p className="text-[12px] text-stone-500">
          For real cron-style posting (no tab needed), see the Apps Script template at the bottom of Settings.
        </p>
      </Section>

      <Section title="Multi-team">
        <p>
          The strip at the top of the page switches between teams. Each team has its own priorities, history, archive, settings (including custom priority list, work types, webhooks, saved filters). <strong>Add team</strong> creates a fresh slate; <strong>×</strong> on a team chip deletes it (you can never delete the last one).
        </p>
      </Section>

      <Section title="Data shape (advanced)">
        <p>
          State persists in SQLite per logged-in user. Every change is mirrored to <code>localStorage</code> as a fallback if the server is unreachable. Schema is JSON-blob from the server's perspective — all migrations and validation happen client-side.
        </p>
        <p className="text-[12px] text-stone-500">
          Per-row fields: <code>id, title, status, priority, ticket, type, links[], assignee, description, items[], createdAt, assignedAt, doneAt, dueAt, snoozedUntil</code>.
        </p>
      </Section>

      <p className="text-[11px] text-stone-400 mt-4">
        Found a bug or want a feature? File it where you normally would — this page reflects the latest shipped state, not promises.
      </p>
    </div>
  );
}

// Window-selector chip values + their human labels.

export function VelocityBars({ days }) {
  const VIEW_W = 600;
  const VIEW_H = 140;
  const BOTTOM_PAD = 22;
  const TOP_PAD = 6;
  const BAR_AREA_H = VIEW_H - TOP_PAD - BOTTOM_PAD;
  const cellW = VIEW_W / Math.max(days.length, 1);
  const barW = Math.max(4, Math.min(16, (cellW - 8) / 2));
  const max = Math.max(1, ...days.flatMap(d => [d.created, d.closed]));
  const labelStride = days.length > 14 ? 3 : 1;

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      width="100%"
      preserveAspectRatio="none"
      role="img"
      aria-label={`Velocity for last ${days.length} days`}
      className="block"
    >
      {days.map((d, i) => {
        const cellX = i * cellW;
        const center = cellX + cellW / 2;
        const createdH = (d.created / max) * BAR_AREA_H;
        const closedH = (d.closed / max) * BAR_AREA_H;
        const createdX = center - barW - 1;
        const closedX = center + 1;
        const baseY = TOP_PAD + BAR_AREA_H;
        return (
          <g key={d.date}>
            <rect
              x={createdX}
              y={baseY - createdH}
              width={barW}
              height={createdH}
              fill="#10b981"
            >
              <title>{`${formatDayLabel(d.date)} — created ${d.created} / closed ${d.closed}`}</title>
            </rect>
            <rect
              x={closedX}
              y={baseY - closedH}
              width={barW}
              height={closedH}
              fill="#3b82f6"
            >
              <title>{`${formatDayLabel(d.date)} — created ${d.created} / closed ${d.closed}`}</title>
            </rect>
            {i % labelStride === 0 && (
              <text
                x={center}
                y={VIEW_H - 6}
                textAnchor="middle"
                fontSize="10"
                fontFamily="monospace"
                fill="#78716c"
              >
                {formatDayLabel(d.date)}
              </text>
            )}
          </g>
        );
      })}
      {/* Legend in the top-right corner */}
      <g>
        <rect x={VIEW_W - 138} y={4} width={8} height={8} fill="#10b981" />
        <text x={VIEW_W - 126} y={12} fontSize="10" fontFamily="monospace" fill="#57534e">created</text>
        <rect x={VIEW_W - 70} y={4} width={8} height={8} fill="#3b82f6" />
        <text x={VIEW_W - 58} y={12} fontSize="10" fontFamily="monospace" fill="#57534e">closed</text>
      </g>
    </svg>
  );
}


export function InsightsView({ team, window: insightsWindow, setWindow }) {
  const priorityList = team?.settings?.priorities;
  const priorityDefs = useMemo(() => sortedPriorityList(priorityList), [priorityList]);
  const todayStr = today();

  const { summary, days, pivot } = useMemo(() => {
    const rows = collectAllRows(team);
    const range = windowRange(insightsWindow, todayStr);
    return {
      summary: summaryFor(rows, range, priorityList),
      days: velocityByDay(rows, range),
      pivot: assigneePivot(rows, range, priorityList),
    };
  }, [team, insightsWindow, todayStr, priorityList]);

  const windowLabel = INSIGHTS_WINDOWS.find(w => w.id === insightsWindow)?.label || insightsWindow;
  const isEmpty = (team?.priorities?.length || 0) === 0 && (team?.archive?.length || 0) === 0;

  return (
    <div className="max-w-3xl">
      <div className="mb-5">
        <h2 className="text-xs font-bold tracking-[0.2em] uppercase text-stone-700">▸ Insights</h2>
        <p className="text-[12px] text-stone-500 mt-1">
          Team velocity and load. Window: <strong className="text-stone-700">{windowLabel}</strong>.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {INSIGHTS_WINDOWS.map(({ id, label }) => {
          const active = insightsWindow === id;
          return (
            <button
              key={id}
              onClick={() => setWindow(id)}
              className={`inline-flex items-center px-2 py-0.5 text-[11px] font-mono uppercase tracking-wider border rounded-sm ${active ? "bg-stone-900 text-stone-50 border-stone-900" : "bg-white/70 text-stone-700 border-stone-300 hover:border-stone-500"}`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <InsightsCard big={summary.created} label="Created" sub={`in ${windowLabel.toLowerCase()}`} />
        <InsightsCard big={summary.closed}  label="Closed"  sub="incl. archived" />
        <InsightsCard
          big={summary.openTopUrgency}
          label="Open P0/P1"
          sub={`of ${summary.openTotal} open total`}
        />
        <InsightsCard
          big={summary.perAssigneeTopline.length || ""}
          label="Top assignees"
          sub={
            summary.perAssigneeTopline.length === 0
              ? "no open work"
              : summary.perAssigneeTopline.map(a => `${a.name} ${a.open}`).join(" · ")
          }
        />
      </div>

      <section className="bg-white/60 border border-stone-300 p-4 mb-3">
        <h3 className="text-[11px] font-bold tracking-[0.2em] uppercase text-stone-700 mb-2">Velocity</h3>
        {days.length === 0 ? (
          <p className="text-[12px] text-stone-500">No data in this window.</p>
        ) : (
          <VelocityBars days={days} />
        )}
      </section>

      <section className="bg-white/60 border border-stone-300 p-4">
        <h3 className="text-[11px] font-bold tracking-[0.2em] uppercase text-stone-700 mb-2">By assignee</h3>
        {pivot.length === 0 ? (
          <p className="text-[12px] text-stone-500">
            {isEmpty ? "No priorities yet — head to Today and create some." : "No work in this window."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] font-mono">
              <thead>
                <tr className="text-stone-500 text-[10px] uppercase tracking-wider">
                  <th className="text-left pb-2 pr-3">Person</th>
                  <th className="text-right pb-2 pr-3">Total</th>
                  {priorityDefs.map(def => {
                    const cls = priorityColorClasses(def.color);
                    return (
                      <th key={def.key} className="text-right pb-2 pr-3">
                        <span className={`inline-block min-w-[28px] px-1 ${cls.chip} ${cls.text}`}>{def.label}</span>
                      </th>
                    );
                  })}
                  <th className="text-right pb-2">Done ({windowLabel})</th>
                </tr>
              </thead>
              <tbody>
                {pivot.map(row => {
                  const totalDone = priorityDefs.reduce(
                    (acc, def) => acc + (row.byPriorityStatus[def.key]?.done || 0),
                    (row.byPriorityStatus.__unknown__?.done || 0)
                  );
                  return (
                    <tr key={row.name} className="border-t border-stone-200">
                      <td className="text-left py-1.5 pr-3 text-stone-800">{row.name}</td>
                      <td className="text-right py-1.5 pr-3 text-stone-800">{row.total}</td>
                      {priorityDefs.map(def => {
                        const bucket = row.byPriorityStatus[def.key] || { wip: 0, blocked: 0, done: 0 };
                        const wipText = bucket.wip ? `${bucket.wip} wip` : "";
                        const blkText = bucket.blocked ? `${bucket.blocked} blk` : "";
                        const parts = [wipText, blkText].filter(Boolean);
                        return (
                          <td key={def.key} className="text-right py-1.5 pr-3 text-stone-700">
                            {parts.length === 0 ? <span className="text-stone-300">·</span> : parts.join(" / ")}
                          </td>
                        );
                      })}
                      <td className="text-right py-1.5 text-emerald-800">{totalDone || <span className="text-stone-300">·</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}


export function InsightsCard({ big, label, sub }) {
  return (
    <div className="bg-white/60 border border-stone-300 p-4">
      <div className="text-3xl font-bold leading-none text-stone-900">{big === 0 || big ? big : "—"}</div>
      <div className="text-[11px] font-mono uppercase tracking-wider text-stone-500 mt-2">{label}</div>
      {sub && <div className="text-[11px] text-stone-600 mt-1 truncate" title={sub}>{sub}</div>}
    </div>
  );
}


export function HistoryView({ history, priorities, historyDate, setHistoryDate }) {
  const dates = Object.keys(history).sort().reverse();
  const snapshot = history[historyDate];

  if (dates.length === 0) {
    return (
      <div className="text-stone-400 text-sm py-8 text-center border-2 border-dashed border-stone-300">
        <p>No snapshots yet. History records each day's state automatically.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <h2 className="text-xs font-bold tracking-[0.2em] uppercase text-stone-700">▸ History</h2>
        <select
          value={historyDate}
          onChange={(e) => setHistoryDate(e.target.value)}
          className="font-mono text-xs px-2 py-1 border border-stone-400 bg-white"
        >
          {dates.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <span className="text-[11px] text-stone-500 font-mono">
          (last {dates.length} day{dates.length === 1 ? "" : "s"})
        </span>
      </div>

      {!snapshot ? (
        <div className="text-stone-400 text-sm py-8 text-center border-2 border-dashed border-stone-300">
          <p>No snapshot for {historyDate}.</p>
        </div>
      ) : snapshot.length === 0 ? (
        <div className="text-stone-400 text-sm py-8 text-center border-2 border-dashed border-stone-300">
          <p>That day was empty.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {snapshot.map((p, i) => (
            <div key={p.id} className="bg-white/60 border border-stone-300 px-3 py-2">
              <div className="flex items-start gap-2">
                <span className="font-mono text-stone-500 text-sm font-medium pt-0.5 select-none w-5 shrink-0">{i + 1}.</span>
                <PriorityPill priority={p.priority} priorities={priorities} readOnly />
                <div className={`flex-1 min-w-0 text-sm break-words ${p.status === "done" ? "line-through text-stone-500" : "text-stone-900"}`}>
                  {p.title || "(untitled)"}
                </div>
                <StatusPill status={p.status} readOnly onChange={() => {}} />
              </div>
              <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1 pl-7 text-[11px]">
                <TicketField value={p.ticket} readOnly onChange={() => {}} />
                <LinksField links={p.links || []} readOnly />
                <DueField value={p.dueAt} status={p.status} readOnly onChange={() => {}} />
                <AssigneeField
                  value={p.assignee}
                  createdAt={p.createdAt}
                  assignedAt={p.assignedAt}
                  doneAt={p.doneAt}
                  readOnly
                  onChange={() => {}}
                />
                <RowMeta
                  createdAt={p.createdAt}
                  assignedAt={p.assignedAt}
                  doneAt={p.doneAt}
                  status={p.status}
                />
              </div>
              {p.items.length > 0 && (
                <div className="mt-1 border-t border-stone-200 pt-1">
                  {p.items.map((it, j) => (
                    <div key={it.id} className="px-1 py-0.5 pl-7 text-[13px]">
                      <div className="flex items-start gap-2">
                        <span className="font-mono text-stone-400 text-xs pt-0.5 w-8 shrink-0">{i + 1}.{j + 1}</span>
                        <div className={`flex-1 min-w-0 break-words ${it.status === "done" ? "line-through text-stone-500" : "text-stone-800"}`}>
                          {it.title || "(untitled)"}
                        </div>
                        <StatusPill status={it.status} readOnly size="xs" onChange={() => {}} />
                      </div>
                      <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-0.5 pl-10 text-[11px]">
                        <TicketField value={it.ticket} readOnly onChange={() => {}} />
                        <LinksField links={it.links || []} readOnly />
                        <DueField value={it.dueAt} status={it.status} readOnly onChange={() => {}} />
                        <AssigneeField
                          value={it.assignee}
                          createdAt={it.createdAt}
                          assignedAt={it.assignedAt}
                          doneAt={it.doneAt}
                          readOnly
                          onChange={() => {}}
                        />
                        <RowMeta
                          createdAt={it.createdAt}
                          assignedAt={it.assignedAt}
                          doneAt={it.doneAt}
                          status={it.status}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Priorities editor — mirror of the work-types editor below, but each entry
// is a {key,label,color,rank} object. The builtin "normal" entry pins to
// the bottom and cannot be deleted (label is still editable). Drag-reorder
// uses native HTML5 DnD; reorder rewrites `rank` so sort order matches the
// new index. Color is picked from a fixed Tailwind palette so JIT keeps
// every utility class alive — see PRIORITY_COLOR_CLASSES in lib/priority.js.
