import { describe, it, expect } from "vitest";
import { rolloverTeam, HISTORY_RETENTION_DAYS_DEFAULT } from "../lib/snapshot.js";

// Test helpers ---------------------------------------------------------------

const makeItem = (id, overrides = {}) => ({
  id,
  title: `item-${id}`,
  status: "not_started",
  ticket: "",
  notes: [],
  links: [],
  assignee: "",
  type: "",
  description: "",
  createdAt: null,
  assignedAt: null,
  doneAt: null,
  dueAt: null,
  ...overrides,
});

const makePriority = (id, overrides = {}) => ({
  id,
  title: `priority-${id}`,
  status: "not_started",
  priority: "normal",
  ticket: "",
  items: [],
  links: [],
  assignee: "",
  type: "",
  description: "",
  createdAt: null,
  assignedAt: null,
  doneAt: null,
  dueAt: null,
  ...overrides,
});

const makeTeam = (overrides = {}) => ({
  id: "t1",
  name: "Team",
  title: "T",
  subtitle: "",
  priorities: [],
  history: {},
  archive: [],
  lastSnapshotDate: null,
  settings: {},
  ...overrides,
});

// First-load semantics ------------------------------------------------------

describe("rolloverTeam — first load", () => {
  it("stamps lastSnapshotDate when null and exits without snapshotting", () => {
    const team = makeTeam({ priorities: [makePriority("p1", { status: "done" })] });
    rolloverTeam(team, "2026-05-08");
    expect(team.lastSnapshotDate).toBe("2026-05-08");
    expect(team.history).toEqual({});
    expect(team.archive).toEqual([]);
    expect(team.priorities).toHaveLength(1);
  });

  it("is a no-op when lastSnapshotDate already equals today", () => {
    const team = makeTeam({
      lastSnapshotDate: "2026-05-08",
      priorities: [makePriority("p1", { status: "done" })],
      history: { "2026-05-07": [] },
      archive: [],
    });
    const before = JSON.stringify(team);
    rolloverTeam(team, "2026-05-08");
    expect(JSON.stringify(team)).toBe(before);
  });

  it("does nothing when team is null/undefined", () => {
    expect(() => rolloverTeam(null, "2026-05-08")).not.toThrow();
    expect(() => rolloverTeam(undefined, "2026-05-08")).not.toThrow();
  });
});

// Single-rollover (only one history key) -----------------------------------

describe("rolloverTeam — single rollover", () => {
  it("snapshots yesterday and does NOT archive yet (needs 2 history keys)", () => {
    const team = makeTeam({
      lastSnapshotDate: "2026-05-07",
      priorities: [
        makePriority("p1", { status: "done", items: [makeItem("i1", { status: "done" })] }),
      ],
    });
    rolloverTeam(team, "2026-05-08");
    expect(team.history["2026-05-07"]).toBeDefined();
    expect(team.archive).toEqual([]);
    expect(team.priorities).toHaveLength(1);
    expect(team.priorities[0].items).toHaveLength(1);
    expect(team.lastSnapshotDate).toBe("2026-05-08");
  });

  it("history snapshot is a deep copy (mutating priorities later doesn't change history)", () => {
    const team = makeTeam({
      lastSnapshotDate: "2026-05-07",
      priorities: [makePriority("p1", { status: "wip", title: "first" })],
    });
    rolloverTeam(team, "2026-05-08");
    team.priorities[0].title = "mutated";
    team.priorities[0].status = "done";
    expect(team.history["2026-05-07"][0].title).toBe("first");
    expect(team.history["2026-05-07"][0].status).toBe("wip");
  });
});

// Auto-archive — sub-tasks --------------------------------------------------

describe("rolloverTeam — sub-task auto-archive", () => {
  it("archives a sub-task done in prev snapshot AND still done today", () => {
    const team = makeTeam({
      lastSnapshotDate: "2026-05-07",
      history: {
        "2026-05-06": [
          makePriority("p1", {
            status: "wip",
            items: [makeItem("i1", { status: "done", title: "ship it" })],
          }),
        ],
      },
      priorities: [
        makePriority("p1", {
          status: "wip",
          items: [makeItem("i1", { status: "done", title: "ship it" })],
        }),
      ],
    });
    rolloverTeam(team, "2026-05-08");
    expect(team.priorities[0].items).toHaveLength(0);
    expect(team.archive).toHaveLength(1);
    expect(team.archive[0]).toMatchObject({
      id: "i1",
      title: "ship it",
      archivedDate: "2026-05-08",
      parentId: "p1",
      parentTitle: "priority-p1",
    });
  });

  it("does NOT archive a sub-task that was done in prev but is no longer done today", () => {
    const team = makeTeam({
      lastSnapshotDate: "2026-05-07",
      history: {
        "2026-05-06": [
          makePriority("p1", { items: [makeItem("i1", { status: "done" })] }),
        ],
      },
      priorities: [
        makePriority("p1", { items: [makeItem("i1", { status: "wip" })] }),
      ],
    });
    rolloverTeam(team, "2026-05-08");
    expect(team.priorities[0].items).toHaveLength(1);
    expect(team.priorities[0].items[0].status).toBe("wip");
    expect(team.archive).toEqual([]);
  });

  it("does NOT archive a sub-task that is done today but was NOT done in prev snapshot", () => {
    const team = makeTeam({
      lastSnapshotDate: "2026-05-07",
      history: {
        "2026-05-06": [
          makePriority("p1", { items: [makeItem("i1", { status: "wip" })] }),
        ],
      },
      priorities: [
        makePriority("p1", { items: [makeItem("i1", { status: "done" })] }),
      ],
    });
    rolloverTeam(team, "2026-05-08");
    expect(team.priorities[0].items).toHaveLength(1);
    expect(team.archive).toEqual([]);
  });

  it("only the freshly-done sub-task survives; siblings already-done-twice archive", () => {
    const team = makeTeam({
      lastSnapshotDate: "2026-05-07",
      history: {
        "2026-05-06": [
          makePriority("p1", {
            items: [
              makeItem("i1", { status: "done" }),
              makeItem("i2", { status: "wip" }),
            ],
          }),
        ],
      },
      priorities: [
        makePriority("p1", {
          items: [
            makeItem("i1", { status: "done" }), // archives
            makeItem("i2", { status: "done" }), // freshly done — stays
          ],
        }),
      ],
    });
    rolloverTeam(team, "2026-05-08");
    expect(team.priorities[0].items.map(i => i.id)).toEqual(["i2"]);
    expect(team.archive).toHaveLength(1);
    expect(team.archive[0].id).toBe("i1");
  });

  it("a sub-task done in OLDER history but not in immediate prev does not archive", () => {
    const team = makeTeam({
      lastSnapshotDate: "2026-05-07",
      history: {
        "2026-05-05": [makePriority("p1", { items: [makeItem("i1", { status: "done" })] })],
        "2026-05-06": [makePriority("p1", { items: [makeItem("i1", { status: "wip" })] })],
      },
      priorities: [
        makePriority("p1", { items: [makeItem("i1", { status: "done" })] }),
      ],
    });
    // After rollover, prev key becomes "2026-05-07" (just-added) and the
    // key we compare against is "2026-05-06" — where i1 is wip — so it
    // should NOT archive.
    rolloverTeam(team, "2026-05-08");
    expect(team.priorities[0].items).toHaveLength(1);
    expect(team.archive).toEqual([]);
  });

  it("preserves the full sub-task payload on archive (assignee, dueAt, links, notes)", () => {
    const item = makeItem("i1", {
      status: "done",
      title: "with metadata",
      assignee: "Alice, Bob",
      dueAt: "2026-05-09",
      links: [{ id: "l1", label: "spec", url: "https://example.com" }],
      notes: [{ id: "n1", content: "note", date: "2026-05-06" }],
      ticket: "https://tracker.example/1",
    });
    const team = makeTeam({
      lastSnapshotDate: "2026-05-07",
      history: {
        "2026-05-06": [makePriority("p1", { items: [{ ...item }] })],
      },
      priorities: [makePriority("p1", { items: [item] })],
    });
    rolloverTeam(team, "2026-05-08");
    expect(team.archive[0]).toMatchObject({
      assignee: "Alice, Bob",
      dueAt: "2026-05-09",
      links: [{ id: "l1", label: "spec", url: "https://example.com" }],
      notes: [{ id: "n1", content: "note", date: "2026-05-06" }],
      ticket: "https://tracker.example/1",
    });
  });
});

// Auto-archive — top-level priorities --------------------------------------

describe("rolloverTeam — top-level priority auto-archive", () => {
  it("archives a top-level priority done in prev snapshot AND still done today", () => {
    const team = makeTeam({
      lastSnapshotDate: "2026-05-07",
      history: {
        "2026-05-06": [makePriority("p1", { status: "done", title: "shipped" })],
      },
      priorities: [makePriority("p1", { status: "done", title: "shipped" })],
    });
    rolloverTeam(team, "2026-05-08");
    expect(team.priorities).toHaveLength(0);
    expect(team.archive).toHaveLength(1);
    expect(team.archive[0]).toMatchObject({
      id: "p1",
      title: "shipped",
      archivedDate: "2026-05-08",
      parentId: null,
      parentTitle: "",
      notes: [],
    });
    expect(team.archive[0]).not.toHaveProperty("items");
  });

  it("preserves the priority tag (P1/P2/normal) on the archived row", () => {
    const team = makeTeam({
      lastSnapshotDate: "2026-05-07",
      history: {
        "2026-05-06": [makePriority("p1", { status: "done", priority: "p1" })],
      },
      priorities: [makePriority("p1", { status: "done", priority: "p1" })],
    });
    rolloverTeam(team, "2026-05-08");
    expect(team.archive[0].priority).toBe("p1");
  });

  it("archives a done priority along with any remaining sub-tasks under it", () => {
    const team = makeTeam({
      lastSnapshotDate: "2026-05-07",
      history: {
        "2026-05-06": [
          makePriority("p1", {
            status: "done",
            items: [
              makeItem("i1", { status: "done" }),
              makeItem("i2", { status: "done" }),
            ],
          }),
        ],
      },
      priorities: [
        makePriority("p1", {
          status: "done",
          items: [
            makeItem("i1", { status: "done" }),
            makeItem("i2", { status: "done" }),
          ],
        }),
      ],
    });
    rolloverTeam(team, "2026-05-08");
    expect(team.priorities).toHaveLength(0);
    // Sub-tasks archived first (inside the sub-task pass), then the priority
    // archives separately. Three archive entries total: i1, i2, p1.
    expect(team.archive).toHaveLength(3);
    const ids = team.archive.map(a => a.id).sort();
    expect(ids).toEqual(["i1", "i2", "p1"]);
    const priorityRow = team.archive.find(a => a.id === "p1");
    expect(priorityRow.parentId).toBeNull();
    expect(priorityRow.parentTitle).toBe("");
    const subRow = team.archive.find(a => a.id === "i1");
    expect(subRow.parentId).toBe("p1");
    expect(subRow.parentTitle).toBe("priority-p1");
  });

  it("archives a done priority that has only freshly-added (not_started) sub-tasks", () => {
    // Edge case: user added a sub-task to a done priority. The cascade
    // doesn't fire on add, so the priority is still done with an open sub.
    // We archive everything together so nothing is silently lost.
    const team = makeTeam({
      lastSnapshotDate: "2026-05-07",
      history: {
        "2026-05-06": [makePriority("p1", { status: "done", items: [] })],
      },
      priorities: [
        makePriority("p1", {
          status: "done",
          items: [makeItem("inew", { status: "not_started" })],
        }),
      ],
    });
    rolloverTeam(team, "2026-05-08");
    expect(team.priorities).toHaveLength(0);
    expect(team.archive.map(a => a.id).sort()).toEqual(["inew", "p1"]);
    const inewArchived = team.archive.find(a => a.id === "inew");
    expect(inewArchived.parentId).toBe("p1");
  });

  it("does NOT archive a priority that was done in prev but is no longer done today", () => {
    const team = makeTeam({
      lastSnapshotDate: "2026-05-07",
      history: {
        "2026-05-06": [makePriority("p1", { status: "done" })],
      },
      priorities: [makePriority("p1", { status: "wip" })],
    });
    rolloverTeam(team, "2026-05-08");
    expect(team.priorities).toHaveLength(1);
    expect(team.archive).toEqual([]);
  });

  it("does NOT archive a priority that is done today but was NOT done in prev snapshot", () => {
    const team = makeTeam({
      lastSnapshotDate: "2026-05-07",
      history: {
        "2026-05-06": [makePriority("p1", { status: "wip" })],
      },
      priorities: [makePriority("p1", { status: "done" })],
    });
    rolloverTeam(team, "2026-05-08");
    expect(team.priorities).toHaveLength(1);
    expect(team.archive).toEqual([]);
  });

  it("does NOT archive a top-level priority on the very first rollover (only one history key)", () => {
    const team = makeTeam({
      lastSnapshotDate: "2026-05-07",
      // empty history — first rollover has no prevKey
      priorities: [makePriority("p1", { status: "done" })],
    });
    rolloverTeam(team, "2026-05-08");
    expect(team.priorities).toHaveLength(1);
    expect(team.archive).toEqual([]);
    expect(Object.keys(team.history)).toEqual(["2026-05-07"]);
  });
});

// Mixed scenarios ----------------------------------------------------------

describe("rolloverTeam — mixed", () => {
  it("archives one done priority and leaves another wip priority alone in the same pass", () => {
    const team = makeTeam({
      lastSnapshotDate: "2026-05-07",
      history: {
        "2026-05-06": [
          makePriority("p1", { status: "done" }),
          makePriority("p2", { status: "wip" }),
        ],
      },
      priorities: [
        makePriority("p1", { status: "done" }),
        makePriority("p2", { status: "wip" }),
      ],
    });
    rolloverTeam(team, "2026-05-08");
    expect(team.priorities.map(p => p.id)).toEqual(["p2"]);
    expect(team.archive).toHaveLength(1);
    expect(team.archive[0].id).toBe("p1");
  });

  it("archived sub-tasks under a surviving priority and the priority itself coexist", () => {
    const team = makeTeam({
      lastSnapshotDate: "2026-05-07",
      history: {
        "2026-05-06": [
          makePriority("p1", { status: "wip", items: [makeItem("i1", { status: "done" })] }),
          makePriority("p2", { status: "done" }),
        ],
      },
      priorities: [
        makePriority("p1", { status: "wip", items: [makeItem("i1", { status: "done" })] }),
        makePriority("p2", { status: "done" }),
      ],
    });
    rolloverTeam(team, "2026-05-08");
    expect(team.priorities.map(p => p.id)).toEqual(["p1"]);
    expect(team.priorities[0].items).toEqual([]);
    expect(team.archive).toHaveLength(2);
    const ids = team.archive.map(a => a.id).sort();
    expect(ids).toEqual(["i1", "p2"]);
    expect(team.archive.find(a => a.id === "i1").parentId).toBe("p1");
    expect(team.archive.find(a => a.id === "p2").parentId).toBeNull();
  });

  it("appends to an existing archive instead of clobbering it", () => {
    const team = makeTeam({
      lastSnapshotDate: "2026-05-07",
      archive: [{
        id: "i-old",
        title: "old archived",
        status: "done",
        archivedDate: "2026-04-01",
        parentTitle: "old parent",
        parentId: "p-old",
        notes: [],
      }],
      history: {
        "2026-05-06": [makePriority("p1", { items: [makeItem("i1", { status: "done" })] })],
      },
      priorities: [makePriority("p1", { items: [makeItem("i1", { status: "done" })] })],
    });
    rolloverTeam(team, "2026-05-08");
    expect(team.archive).toHaveLength(2);
    expect(team.archive[0].id).toBe("i-old");
    expect(team.archive[1].id).toBe("i1");
  });
});

// History retention --------------------------------------------------------

describe("rolloverTeam — history retention", () => {
  it("trims history to retentionDays after rollover", () => {
    const history = {};
    for (let i = 1; i <= 10; i++) {
      history[`2026-04-${String(i).padStart(2, "0")}`] = [];
    }
    const team = makeTeam({
      lastSnapshotDate: "2026-04-10",
      history,
      priorities: [],
    });
    rolloverTeam(team, "2026-04-11", 3);
    // The just-snapshotted "2026-04-10" plus the two newest before that should remain
    expect(Object.keys(team.history).sort()).toEqual([
      "2026-04-08",
      "2026-04-09",
      "2026-04-10",
    ]);
  });

  it("uses the default retention window when none is passed", () => {
    expect(HISTORY_RETENTION_DAYS_DEFAULT).toBe(30);
    const history = {};
    for (let i = 0; i < 35; i++) {
      const d = new Date(2026, 0, 1 + i);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      history[k] = [];
    }
    const last = `2026-02-04`;
    const team = makeTeam({ lastSnapshotDate: last, history });
    rolloverTeam(team, "2026-02-05");
    expect(Object.keys(team.history).length).toBe(30);
  });
});

// Idempotency / repeatability ---------------------------------------------

describe("rolloverTeam — idempotency", () => {
  it("calling twice with the same `today` is a no-op the second time", () => {
    const team = makeTeam({
      lastSnapshotDate: "2026-05-07",
      history: {
        "2026-05-06": [makePriority("p1", { items: [makeItem("i1", { status: "done" })] })],
      },
      priorities: [makePriority("p1", { items: [makeItem("i1", { status: "done" })] })],
    });
    rolloverTeam(team, "2026-05-08");
    const snapshot = JSON.stringify(team);
    rolloverTeam(team, "2026-05-08");
    expect(JSON.stringify(team)).toBe(snapshot);
  });

  it("a sub-task done across three days archives on day three, not day two", () => {
    // Simulate the canonical 24-48h dwell:
    //   Day 1 (May 6): user marks i1 done.
    //   Day 2 (May 7) load: snapshot day 1; no archive yet.
    //   Day 3 (May 8) load: snapshot day 2; i1 was done in day 1 history → archive.
    const team = makeTeam({
      lastSnapshotDate: "2026-05-06",
      priorities: [
        makePriority("p1", { items: [makeItem("i1", { status: "done" })] }),
      ],
    });
    rolloverTeam(team, "2026-05-07");
    expect(team.archive).toEqual([]);
    expect(team.priorities[0].items).toHaveLength(1);

    rolloverTeam(team, "2026-05-08");
    expect(team.archive).toHaveLength(1);
    expect(team.archive[0].id).toBe("i1");
    expect(team.priorities[0].items).toEqual([]);
  });

  it("a top-level done priority archives on day three of the same simulation", () => {
    const team = makeTeam({
      lastSnapshotDate: "2026-05-06",
      priorities: [makePriority("p1", { status: "done" })],
    });
    rolloverTeam(team, "2026-05-07");
    expect(team.archive).toEqual([]);
    rolloverTeam(team, "2026-05-08");
    expect(team.archive).toHaveLength(1);
    expect(team.archive[0].id).toBe("p1");
    expect(team.priorities).toEqual([]);
  });
});

// Hardening / defensive shapes --------------------------------------------

describe("rolloverTeam — defensive shapes", () => {
  it("handles a priority with no items array (legacy/migration)", () => {
    const p = makePriority("p1", { status: "done" });
    delete p.items;
    const team = makeTeam({
      lastSnapshotDate: "2026-05-07",
      history: {
        "2026-05-06": [{ ...makePriority("p1", { status: "done" }), items: [] }],
      },
      priorities: [p],
    });
    expect(() => rolloverTeam(team, "2026-05-08")).not.toThrow();
    expect(team.priorities).toHaveLength(0);
    expect(team.archive.find(a => a.id === "p1")).toBeDefined();
  });

  it("handles a history entry where a priority is missing items[]", () => {
    const team = makeTeam({
      lastSnapshotDate: "2026-05-07",
      history: {
        "2026-05-06": [{ ...makePriority("p1", { status: "wip" }), items: undefined }],
      },
      priorities: [makePriority("p1", { status: "wip", items: [makeItem("i1", { status: "done" })] })],
    });
    expect(() => rolloverTeam(team, "2026-05-08")).not.toThrow();
    // i1 wasn't in any prev snapshot → not archived
    expect(team.archive).toEqual([]);
  });

  it("handles a completely empty team (no priorities, no history)", () => {
    const team = makeTeam({ lastSnapshotDate: "2026-05-07" });
    rolloverTeam(team, "2026-05-08");
    expect(team.lastSnapshotDate).toBe("2026-05-08");
    expect(team.history["2026-05-07"]).toEqual([]);
    expect(team.archive).toEqual([]);
    expect(team.priorities).toEqual([]);
  });
});
