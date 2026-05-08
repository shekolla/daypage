import { STATUS_SORT_RANK } from "./constants.js";
import { priorityRank } from "./priority.js";

// Done rows always sort to the end of the list. Within the open group rows
// sort by priority+status as before; within the done group they sort by
// priority alone (status is the same — `done`). `holdOpenIds` is an
// optional Set of row ids that should sort *as if open* even if their
// status is currently `done` — the UI uses this to keep a freshly-done
// row in its original spot for a few seconds so teammates watching the
// screen aren't startled by a sudden reorder.
const isEffectivelyDone = (row, holdOpenIds) =>
  row.status === "done" && !(holdOpenIds && holdOpenIds.has(row.id));

// Sub-tasks: status only (no priority field on items). Done rows go last.
export const sortByStatus = (arr, holdOpenIds) => [...arr].sort((a, b) => {
  const aDone = isEffectivelyDone(a, holdOpenIds);
  const bDone = isEffectivelyDone(b, holdOpenIds);
  if (aDone !== bDone) return aDone ? 1 : -1;
  return (STATUS_SORT_RANK[a.status] ?? 9) - (STATUS_SORT_RANK[b.status] ?? 9);
});

// Top-level priorities: priority list is per-team (team.settings.priorities);
// pass it through so users can reorder/rename their tiers without breaking
// sort order. Done rows always trail; within the done group they sort by
// priority. Open rows sort by priority then status.
export const sortPriorityRows = (arr, priorities, holdOpenIds) => [...arr].sort((a, b) => {
  const aDone = isEffectivelyDone(a, holdOpenIds);
  const bDone = isEffectivelyDone(b, holdOpenIds);
  if (aDone !== bDone) return aDone ? 1 : -1;
  const dp = priorityRank(a.priority, priorities) - priorityRank(b.priority, priorities);
  if (dp !== 0) return dp;
  if (aDone) return 0;
  return (STATUS_SORT_RANK[a.status] ?? 9) - (STATUS_SORT_RANK[b.status] ?? 9);
});
