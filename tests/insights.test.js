import { describe, it, expect } from "vitest";
import {
  collectAllRows,
  windowRange,
  inRange,
  summaryFor,
  velocityByDay,
  assigneePivot,
} from "../lib/insights.js";
import { DEFAULT_PRIORITIES } from "../lib/constants.js";

// Inline factory copies — see tests/snapshot.test.js:6-52. Inline-copied
// rather than extracted to a shared helper, matching the repo's "no
// abstractions till second use" lean.
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

const TODAY = "2026-05-08";

// ---------- collectAllRows ---------------------------------------------

describe("collectAllRows", () => {
  it("flattens priorities + items + archive into one array with `kind`", () => {
    const team = makeTeam({
      priorities: [
        makePriority("p1", {
          items: [makeItem("i1"), makeItem("i2")],
        }),
        makePriority("p2"),
      ],
      archive: [
        { id: "a1", title: "old", status: "done", archivedDate: "2026-04-01", parentId: "p-old" },
      ],
    });
    const rows = collectAllRows(team);
    expect(rows).toHaveLength(5);
    expect(rows.map(r => r.id).sort()).toEqual(["a1", "i1", "i2", "p1", "p2"]);
    const byId = Object.fromEntries(rows.map(r => [r.id, r]));
    expect(byId.p1.kind).toBe("priority");
    expect(byId.i1.kind).toBe("item");
    expect(byId.a1.kind).toBe("archived");
  });

  it("preserves timestamps + status + priority + assignee", () => {
    const team = makeTeam({
      priorities: [
        makePriority("p1", {
          status: "wip",
          priority: "p0",
          assignee: "Alice, Bob",
          createdAt: "2026-05-08T08:00:00.000Z",
          doneAt: null,
        }),
      ],
    });
    const [r] = collectAllRows(team);
    expect(r.status).toBe("wip");
    expect(r.priority).toBe("p0");
    expect(r.assignee).toBe("Alice, Bob");
    expect(r.createdAt).toBe("2026-05-08T08:00:00.000Z");
    expect(r.doneAt).toBeNull();
  });

  it("sub-tasks have priority: null (items have no priority field)", () => {
    const team = makeTeam({
      priorities: [
        makePriority("p1", { items: [makeItem("i1", { status: "wip" })] }),
      ],
    });
    const rows = collectAllRows(team);
    const item = rows.find(r => r.id === "i1");
    expect(item.priority).toBeNull();
  });

  it("tolerates undefined priorities/items/archive without throwing", () => {
    expect(() => collectAllRows({})).not.toThrow();
    expect(() => collectAllRows({ priorities: undefined })).not.toThrow();
    expect(() => collectAllRows(null)).not.toThrow();
    expect(collectAllRows(null)).toEqual([]);
  });
});

// ---------- windowRange + inRange --------------------------------------

describe("windowRange", () => {
  it("returns the correct rolling-N range for each option (today=2026-05-08)", () => {
    expect(windowRange("today",  TODAY)).toEqual({ start: "2026-05-08", end: "2026-05-08" });
    expect(windowRange("week",   TODAY)).toEqual({ start: "2026-05-02", end: "2026-05-08" });
    expect(windowRange("2weeks", TODAY)).toEqual({ start: "2026-04-25", end: "2026-05-08" });
    expect(windowRange("month",  TODAY)).toEqual({ start: "2026-04-09", end: "2026-05-08" });
  });

  it("falls back to week for an unknown window value", () => {
    expect(windowRange("year", TODAY)).toEqual(windowRange("week", TODAY));
  });

  it("inRange uses inclusive lexicographic compare", () => {
    const r = windowRange("week", TODAY);
    expect(inRange("2026-05-02", r)).toBe(true);
    expect(inRange("2026-05-08", r)).toBe(true);
    expect(inRange("2026-05-01", r)).toBe(false);
    expect(inRange("2026-05-09", r)).toBe(false);
    expect(inRange(null, r)).toBe(false);
    expect(inRange("2026-05-05", null)).toBe(false);
  });
});

// ---------- summaryFor -------------------------------------------------

describe("summaryFor", () => {
  const range = windowRange("week", TODAY);

  it("counts created within window", () => {
    const team = makeTeam({
      priorities: [
        makePriority("p1", { createdAt: "2026-05-08T09:00:00.000Z" }), // today
        makePriority("p2", { createdAt: "2026-05-04T09:00:00.000Z" }), // in window
        makePriority("p3", { createdAt: "2026-04-20T09:00:00.000Z" }), // out
        makePriority("p4"), // no createdAt → ignored
      ],
    });
    const s = summaryFor(collectAllRows(team), range, DEFAULT_PRIORITIES);
    expect(s.created).toBe(2);
  });

  it("counts closed via active doneAt", () => {
    const team = makeTeam({
      priorities: [
        makePriority("p1", { status: "done", doneAt: "2026-05-07T20:00:00.000Z" }),
        makePriority("p2", { status: "done", doneAt: "2026-04-01T00:00:00.000Z" }), // out
        makePriority("p3", { status: "wip" }),
      ],
    });
    const s = summaryFor(collectAllRows(team), range, DEFAULT_PRIORITIES);
    expect(s.closed).toBe(1);
  });

  it("counts archived rows as closed and dedupes by id", () => {
    const team = makeTeam({
      priorities: [
        // currently done AND in archive (rollover transient)
        makePriority("p1", { status: "done", doneAt: "2026-05-07T20:00:00.000Z" }),
      ],
      archive: [
        { id: "p1", title: "shipped", status: "done", archivedDate: "2026-05-07" },
        { id: "a2", title: "older",   status: "done", archivedDate: "2026-05-03" },
      ],
    });
    const s = summaryFor(collectAllRows(team), range, DEFAULT_PRIORITIES);
    // p1 counted once + a2 counted once = 2, NOT 3
    expect(s.closed).toBe(2);
  });

  it("openTopUrgency only counts rank <= 1 (default P0/P1)", () => {
    const team = makeTeam({
      priorities: [
        makePriority("p1", { status: "wip", priority: "p0" }),
        makePriority("p2", { status: "blocked", priority: "p1" }),
        makePriority("p3", { status: "wip", priority: "p2" }),
        makePriority("p4", { status: "done", priority: "p0", doneAt: "2026-05-07T20:00:00.000Z" }),
      ],
    });
    const s = summaryFor(collectAllRows(team), range, DEFAULT_PRIORITIES);
    expect(s.openTopUrgency).toBe(2);
    expect(s.openTotal).toBe(3);
  });

  it("perAssigneeTopline returns top-3 by current open count, excluding Unassigned", () => {
    const team = makeTeam({
      priorities: [
        makePriority("p1", { status: "wip", assignee: "Alice" }),
        makePriority("p2", { status: "wip", assignee: "Alice, Bob" }),
        makePriority("p3", { status: "wip", assignee: "Bob" }),
        makePriority("p4", { status: "wip", assignee: "Carol" }),
        makePriority("p5", { status: "wip", assignee: "Dan" }),
        makePriority("p6", { status: "wip", assignee: "" }), // Unassigned, skipped
      ],
    });
    const s = summaryFor(collectAllRows(team), range, DEFAULT_PRIORITIES);
    const names = s.perAssigneeTopline.map(p => p.name);
    expect(names).toContain("Alice");
    expect(names).toContain("Bob");
    expect(names).not.toContain("Unassigned");
    expect(s.perAssigneeTopline).toHaveLength(3);
    // Alice and Bob both have 2 open
    const alice = s.perAssigneeTopline.find(p => p.name === "Alice");
    expect(alice.open).toBe(2);
  });
});

// ---------- velocityByDay ----------------------------------------------

describe("velocityByDay", () => {
  it("returns one entry per day in range, zero-filled", () => {
    const out = velocityByDay([], windowRange("2weeks", TODAY));
    expect(out).toHaveLength(14);
    expect(out[0].date).toBe("2026-04-25");
    expect(out[13].date).toBe("2026-05-08");
    for (const d of out) {
      expect(d.created).toBe(0);
      expect(d.closed).toBe(0);
    }
  });

  it("counts created and closed in the right buckets", () => {
    const team = makeTeam({
      priorities: [
        makePriority("p1", {
          createdAt: "2026-05-05T08:00:00.000Z",
          status: "done",
          doneAt: "2026-05-07T08:00:00.000Z",
        }),
        makePriority("p2", { createdAt: "2026-05-08T11:00:00.000Z", status: "wip" }),
      ],
      archive: [
        { id: "a1", status: "done", archivedDate: "2026-05-06" },
      ],
    });
    const out = velocityByDay(collectAllRows(team), windowRange("week", TODAY));
    const byDate = Object.fromEntries(out.map(d => [d.date, d]));
    expect(byDate["2026-05-05"].created).toBe(1);
    expect(byDate["2026-05-08"].created).toBe(1);
    expect(byDate["2026-05-07"].closed).toBe(1);
    expect(byDate["2026-05-06"].closed).toBe(1);
  });

  it("dedupes between active doneAt and archive (active wins)", () => {
    const team = makeTeam({
      priorities: [
        makePriority("p1", {
          status: "done",
          createdAt: "2026-05-05T08:00:00.000Z",
          doneAt: "2026-05-07T08:00:00.000Z",
        }),
      ],
      archive: [
        { id: "p1", status: "done", archivedDate: "2026-05-06" },
      ],
    });
    const out = velocityByDay(collectAllRows(team), windowRange("week", TODAY));
    const byDate = Object.fromEntries(out.map(d => [d.date, d]));
    // Active doneAt (2026-05-07) wins; archive's 2026-05-06 ignored.
    expect(byDate["2026-05-07"].closed).toBe(1);
    expect(byDate["2026-05-06"].closed).toBe(0);
  });
});

// ---------- assigneePivot ----------------------------------------------

describe("assigneePivot", () => {
  const range = windowRange("week", TODAY);

  it("expands multi-assignee strings to one row per name", () => {
    const team = makeTeam({
      priorities: [
        makePriority("p1", { status: "wip", priority: "p0", assignee: "Alice, Bob" }),
      ],
    });
    const out = assigneePivot(collectAllRows(team), range, DEFAULT_PRIORITIES);
    expect(out.map(r => r.name).sort()).toEqual(["Alice", "Bob"]);
    for (const r of out) {
      expect(r.byPriorityStatus.p0.wip).toBe(1);
    }
  });

  it("buckets empty assignee under 'Unassigned' and renders it last", () => {
    const team = makeTeam({
      priorities: [
        makePriority("p1", { status: "wip", priority: "p1", assignee: "" }),
        makePriority("p2", { status: "wip", priority: "p1", assignee: "Alice" }),
      ],
    });
    const out = assigneePivot(collectAllRows(team), range, DEFAULT_PRIORITIES);
    expect(out[out.length - 1].name).toBe("Unassigned");
  });

  it("Unassigned stays last even if it has the highest count", () => {
    const team = makeTeam({
      priorities: [
        makePriority("p1", { status: "wip", priority: "p1", assignee: "" }),
        makePriority("p2", { status: "wip", priority: "p1", assignee: "" }),
        makePriority("p3", { status: "wip", priority: "p1", assignee: "" }),
        makePriority("p4", { status: "wip", priority: "p1", assignee: "Alice" }),
      ],
    });
    const out = assigneePivot(collectAllRows(team), range, DEFAULT_PRIORITIES);
    expect(out[0].name).toBe("Alice");
    expect(out[out.length - 1].name).toBe("Unassigned");
  });

  it("sorts non-Unassigned by total desc, ties by name asc", () => {
    const team = makeTeam({
      priorities: [
        makePriority("p1", { status: "wip", priority: "p1", assignee: "Alice" }),
        makePriority("p2", { status: "wip", priority: "p1", assignee: "Alice" }),
        makePriority("p3", { status: "wip", priority: "p1", assignee: "Bob" }),
        makePriority("p4", { status: "wip", priority: "p1", assignee: "Carol" }),
        makePriority("p5", { status: "wip", priority: "p1", assignee: "Carol" }),
      ],
    });
    const out = assigneePivot(collectAllRows(team), range, DEFAULT_PRIORITIES);
    expect(out.map(r => r.name)).toEqual(["Alice", "Carol", "Bob"]);
  });

  it("counts blocked + done(in window) correctly", () => {
    const team = makeTeam({
      priorities: [
        makePriority("p1", { status: "blocked", priority: "p0", assignee: "Alice" }),
        makePriority("p2", { status: "done", priority: "p1", assignee: "Alice", doneAt: "2026-05-07T08:00:00.000Z" }),
      ],
      archive: [
        { id: "a1", priority: "p2", status: "done", assignee: "Alice", archivedDate: "2026-05-04" },
      ],
    });
    const out = assigneePivot(collectAllRows(team), range, DEFAULT_PRIORITIES);
    const alice = out.find(r => r.name === "Alice");
    expect(alice.byPriorityStatus.p0.blocked).toBe(1);
    expect(alice.byPriorityStatus.p1.done).toBe(1);
    expect(alice.byPriorityStatus.p2.done).toBe(1);
  });

  it("stale priority key falls into __unknown__ bucket", () => {
    const team = makeTeam({
      priorities: [
        makePriority("p1", { status: "wip", priority: "deleted_key", assignee: "Alice" }),
      ],
    });
    const out = assigneePivot(collectAllRows(team), range, DEFAULT_PRIORITIES);
    const alice = out.find(r => r.name === "Alice");
    expect(alice.byPriorityStatus.__unknown__.wip).toBe(1);
  });
});
