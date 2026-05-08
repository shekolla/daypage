import { describe, it, expect } from "vitest";
import { sortByStatus, sortPriorityRows } from "../lib/sort.js";

describe("sortByStatus", () => {
  it("orders blocked → wip → not_started, then done at the end", () => {
    const rows = [
      { id: "a", status: "done" },
      { id: "b", status: "not_started" },
      { id: "c", status: "blocked" },
      { id: "d", status: "wip" },
    ];
    expect(sortByStatus(rows).map(r => r.id)).toEqual(["c", "d", "b", "a"]);
  });

  it("multiple done rows all land at the end (in original relative order)", () => {
    const rows = [
      { id: "d1", status: "done" },
      { id: "wip", status: "wip" },
      { id: "d2", status: "done" },
      { id: "blk", status: "blocked" },
    ];
    expect(sortByStatus(rows).map(r => r.id)).toEqual(["blk", "wip", "d1", "d2"]);
  });

  it("returns a new array (does not mutate input)", () => {
    const rows = [{ id: "a", status: "done" }, { id: "b", status: "wip" }];
    const out = sortByStatus(rows);
    expect(rows.map(r => r.id)).toEqual(["a", "b"]);
    expect(out).not.toBe(rows);
  });

  it("keeps unknown status with open rows (treated as non-done)", () => {
    const rows = [
      { id: "a", status: "wip" },
      { id: "b", status: "garbage" },
      { id: "c", status: "blocked" },
    ];
    expect(sortByStatus(rows).map(r => r.id)).toEqual(["c", "a", "b"]);
  });

  it("respects holdOpenIds — held rows stay sorted as if open", () => {
    const rows = [
      { id: "wip", status: "wip" },
      { id: "freshDone", status: "done" },
      { id: "oldDone", status: "done" },
    ];
    const held = new Set(["freshDone"]);
    // freshDone behaves like its current sort rank (done = 3, last among open)
    // but stays before truly-done rows.
    const out = sortByStatus(rows, held).map(r => r.id);
    expect(out.indexOf("freshDone")).toBeLessThan(out.indexOf("oldDone"));
  });
});

describe("sortPriorityRows", () => {
  it("groups open rows by priority+status, then puts done rows at the end ordered by priority", () => {
    const rows = [
      { id: "norm-blocked", priority: "normal", status: "blocked" },
      { id: "p2-wip",       priority: "p2",     status: "wip" },
      { id: "p1-done",      priority: "p1",     status: "done" },
      { id: "p0-wip",       priority: "p0",     status: "wip" },
      { id: "p1-wip",       priority: "p1",     status: "wip" },
      { id: "p3-todo",      priority: "p3",     status: "not_started" },
      { id: "p3-done",      priority: "p3",     status: "done" },
    ];
    const expected = [
      // open: by priority, then status
      "p0-wip", "p1-wip", "p2-wip", "p3-todo", "norm-blocked",
      // done: by priority
      "p1-done", "p3-done",
    ];
    expect(sortPriorityRows(rows, undefined).map(r => r.id)).toEqual(expected);
  });

  it("honors a custom priority list (rename + reorder)", () => {
    const list = [
      { key: "ship",   label: "Ship",   color: "emerald", rank: 0 },
      { key: "soon",   label: "Soon",   color: "yellow",  rank: 1 },
      { key: "normal", label: "—",      color: "stone",   rank: 99, builtin: true },
    ];
    const rows = [
      { id: "n",  priority: "normal", status: "wip" },
      { id: "sh", priority: "ship",   status: "blocked" },
      { id: "so", priority: "soon",   status: "wip" },
    ];
    expect(sortPriorityRows(rows, list).map(r => r.id)).toEqual(["sh", "so", "n"]);
  });

  it("sorts an unknown priority key to the end of its group", () => {
    const rows = [
      { id: "stale", priority: "deleted_key", status: "wip" },
      { id: "p1",    priority: "p1",          status: "wip" },
      { id: "norm",  priority: "normal",      status: "wip" },
    ];
    expect(sortPriorityRows(rows, undefined).map(r => r.id)).toEqual(["p1", "norm", "stale"]);
  });

  it("holdOpenIds keeps a freshly-done row in its open-group position", () => {
    const rows = [
      { id: "p0-wip",      priority: "p0", status: "wip" },
      { id: "p1-fresh",    priority: "p1", status: "done" }, // just clicked done
      { id: "p2-wip",      priority: "p2", status: "wip" },
      { id: "p2-old-done", priority: "p2", status: "done" }, // older done
    ];
    const held = new Set(["p1-fresh"]);
    const out = sortPriorityRows(rows, undefined, held).map(r => r.id);
    // p1-fresh sits where it was (priority p1 in the open group), the truly
    // old done row goes to the end.
    expect(out).toEqual(["p0-wip", "p1-fresh", "p2-wip", "p2-old-done"]);
  });

  it("does not mutate the input array", () => {
    const rows = [
      { id: "a", priority: "p2", status: "wip" },
      { id: "b", priority: "p1", status: "wip" },
    ];
    const before = rows.map(r => r.id);
    sortPriorityRows(rows, undefined);
    expect(rows.map(r => r.id)).toEqual(before);
  });
});
