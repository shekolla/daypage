// Pure snapshot + auto-archive logic. Lifted out of the React effect so
// the rollover semantics can be unit-tested independently.
//
// `rolloverTeam(team, today, retentionDays)` mutates the team in place:
//   1. Captures yesterday's priorities into `team.history[lastSnapshotDate]`.
//   2. Auto-archives rows still DONE across two consecutive snapshots
//      (= done >24h). Sub-tasks archive with parentId/parentTitle pointing
//      at their priority; top-level priorities archive with parentId=null
//      and parentTitle="" so the restore path can tell them apart.
//   3. Trims `team.history` to the last `retentionDays` snapshots.
//   4. Stamps `team.lastSnapshotDate = today`.
//
// First-ever rollover (no prior `lastSnapshotDate`) just stamps today and
// returns — there's no "yesterday" to snapshot yet.

export const HISTORY_RETENTION_DAYS_DEFAULT = 30;

export function rolloverTeam(team, today, retentionDays = HISTORY_RETENTION_DAYS_DEFAULT) {
  if (!team) return;
  if (team.lastSnapshotDate === today) return;
  if (!team.lastSnapshotDate) {
    team.lastSnapshotDate = today;
    return;
  }

  team.history[team.lastSnapshotDate] = JSON.parse(JSON.stringify(team.priorities));

  const histKeys = Object.keys(team.history).sort();
  const prevKey = histKeys[histKeys.length - 2];
  if (prevKey) {
    const prevDoneItemIds = new Set();
    const prevDonePriorityIds = new Set();
    team.history[prevKey].forEach(p => {
      if (p.status === "done") prevDonePriorityIds.add(p.id);
      (p.items || []).forEach(it => {
        if (it.status === "done") prevDoneItemIds.add(it.id);
      });
    });

    team.priorities.forEach(p => {
      p.items = (p.items || []).filter(it => {
        if (it.status === "done" && prevDoneItemIds.has(it.id)) {
          team.archive.push({
            ...it,
            archivedDate: today,
            parentTitle: p.title,
            parentId: p.id,
          });
          return false;
        }
        return true;
      });
    });

    team.priorities = team.priorities.filter(p => {
      if (p.status === "done" && prevDonePriorityIds.has(p.id)) {
        (p.items || []).forEach(it => {
          team.archive.push({
            ...it,
            archivedDate: today,
            parentTitle: p.title,
            parentId: p.id,
          });
        });
        const { items: _items, ...rest } = p;
        team.archive.push({
          ...rest,
          notes: [],
          archivedDate: today,
          parentTitle: "",
          parentId: null,
        });
        return false;
      }
      return true;
    });
  }

  const keep = new Set(Object.keys(team.history).sort().slice(-retentionDays));
  team.history = Object.fromEntries(
    Object.entries(team.history).filter(([k]) => keep.has(k))
  );

  team.lastSnapshotDate = today;
}
