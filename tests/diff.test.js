import { describe, it, expect } from "vitest";
import { diffPriorities, diffIsEmpty, buildDiffText } from "../lib/diff.js";

const mkPriority = (id, overrides = {}) => ({
  id,
  title: id,
  status: "wip",
  priority: "normal",
  ticket: "",
  items: [],
  ...overrides,
});

describe("diffPriorities", () => {
  it("returns empty buckets for identical inputs", () => {
    const cur = [mkPriority("a"), mkPriority("b")];
    const prev = JSON.parse(JSON.stringify(cur));
    const d = diffPriorities(prev, cur);
    expect(d.addedPriorities).toEqual([]);
    expect(d.removedPriorities).toEqual([]);
    expect(d.statusFlips).toEqual([]);
    expect(d.itemStatusFlips).toEqual([]);
    expect(d.addedItems).toEqual([]);
    expect(d.removedItems).toEqual([]);
    expect(d.newBlockers).toEqual([]);
    expect(diffIsEmpty(d)).toBe(true);
  });

  it("detects priority added / removed", () => {
    const prev = [mkPriority("a")];
    const cur = [mkPriority("b")];
    const d = diffPriorities(prev, cur);
    expect(d.addedPriorities.map(p => p.id)).toEqual(["b"]);
    expect(d.removedPriorities.map(p => p.id)).toEqual(["a"]);
  });

  it("detects priority status flips", () => {
    const prev = [mkPriority("a", { status: "wip" })];
    const cur = [mkPriority("a", { status: "done" })];
    const d = diffPriorities(prev, cur);
    expect(d.statusFlips).toHaveLength(1);
    expect(d.statusFlips[0].from).toBe("wip");
    expect(d.statusFlips[0].to).toBe("done");
  });

  it("detects sub-task added / removed / status changed", () => {
    const prev = [mkPriority("p", { items: [{ id: "i1", title: "x", status: "wip" }] })];
    const cur = [mkPriority("p", {
      items: [
        { id: "i1", title: "x", status: "done" },
        { id: "i2", title: "y", status: "not_started" },
      ],
    })];
    const d = diffPriorities(prev, cur);
    expect(d.itemStatusFlips).toHaveLength(1);
    expect(d.itemStatusFlips[0].from).toBe("wip");
    expect(d.itemStatusFlips[0].to).toBe("done");
    expect(d.addedItems.map(x => x.it.id)).toEqual(["i2"]);
  });

  it("detects new blockers (priority + sub-task levels)", () => {
    const prev = [
      mkPriority("p1", { status: "wip" }),
      mkPriority("p2", { items: [{ id: "i1", title: "x", status: "wip" }] }),
    ];
    const cur = [
      mkPriority("p1", { status: "blocked" }),
      mkPriority("p2", { items: [{ id: "i1", title: "x", status: "blocked" }] }),
    ];
    const d = diffPriorities(prev, cur);
    expect(d.newBlockers.length).toBe(2);
  });

  it("treats null prev as everything-new", () => {
    const cur = [mkPriority("a")];
    const d = diffPriorities(null, cur);
    expect(d.addedPriorities.map(p => p.id)).toEqual(["a"]);
    expect(diffIsEmpty(d)).toBe(false);
  });
});

describe("buildDiffText", () => {
  it("renders the no-change branch", () => {
    expect(buildDiffText(null)).toMatch(/no previous snapshot/);
    const empty = diffPriorities(
      [mkPriority("a")],
      [mkPriority("a")],
    );
    expect(buildDiffText(empty)).toMatch(/no changes/);
  });

  it("includes section headings for each non-empty bucket", () => {
    const prev = [
      mkPriority("p", { status: "wip", items: [{ id: "i1", title: "x", status: "wip" }] }),
      mkPriority("r", { status: "wip" }),
    ];
    const cur = [
      mkPriority("p", { status: "done", items: [{ id: "i1", title: "x", status: "done" }] }),
      mkPriority("r", { status: "blocked" }),       // → new blocker (transition)
      mkPriority("q", { status: "wip" }),           // → new priority (added)
    ];
    const text = buildDiffText(diffPriorities(prev, cur));
    expect(text).toMatch(/NEW BLOCKERS/);
    expect(text).toMatch(/NEW PRIORITIES/);
    expect(text).toMatch(/STATUS — PRIORITIES/);
    expect(text).toMatch(/STATUS — SUB-TASKS/);
  });

  it("includes NEW SUB-TASKS heading when sub-tasks are added", () => {
    const prev = [mkPriority("p", { items: [] })];
    const cur  = [mkPriority("p", { items: [{ id: "i1", title: "new task", status: "not_started" }] })];
    const text = buildDiffText(diffPriorities(prev, cur));
    expect(text).toMatch(/NEW SUB-TASKS/);
    expect(text).toContain("new task");
  });

  it("includes REMOVED heading when priorities or sub-tasks are deleted", () => {
    const prev = [
      mkPriority("p", { items: [{ id: "i1", title: "old sub", status: "wip" }] }),
      mkPriority("q"),
    ];
    const cur = [mkPriority("p", { items: [] })];
    const text = buildDiffText(diffPriorities(prev, cur));
    expect(text).toMatch(/REMOVED/);
    expect(text).toContain("q");
    expect(text).toContain("old sub");
  });
});
