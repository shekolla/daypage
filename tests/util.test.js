import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { applyTimestamped, collectTeamAssignees, filterMentionMatches } from "../lib/util.js";

// ---------------------------------------------------------------------------
// applyTimestamped
// ---------------------------------------------------------------------------

describe("applyTimestamped", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-05-09T10:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); });

  it("passes through fields untouched when neither assignee nor status changes", () => {
    const out = applyTimestamped({ title: "old" }, { title: "new" });
    expect(out.title).toBe("new");
    expect(out.assignedAt).toBeUndefined();
    expect(out.doneAt).toBeUndefined();
  });

  it("sets assignedAt when a new non-empty assignee is added", () => {
    const out = applyTimestamped({ assignee: "" }, { assignee: "Alice" });
    expect(out.assignee).toBe("Alice");
    expect(out.assignedAt).toBe(new Date("2026-05-09T10:00:00Z").toISOString());
  });

  it("does not update assignedAt when assignee is unchanged", () => {
    const out = applyTimestamped(
      { assignee: "Alice", assignedAt: "2026-01-01T00:00:00.000Z" },
      { assignee: "Alice" },
    );
    expect(out.assignedAt).not.toBe(new Date("2026-05-09T10:00:00Z").toISOString());
  });

  it("clears assignedAt when assignee is removed", () => {
    const out = applyTimestamped(
      { assignee: "Alice", assignedAt: "2026-01-01T00:00:00.000Z" },
      { assignee: "" },
    );
    expect(out.assignedAt).toBeNull();
  });

  it("sets doneAt when status transitions to done", () => {
    const out = applyTimestamped({ status: "wip" }, { status: "done" });
    expect(out.doneAt).toBe(new Date("2026-05-09T10:00:00Z").toISOString());
  });

  it("clears doneAt when status transitions away from done", () => {
    const out = applyTimestamped(
      { status: "done", doneAt: "2026-01-01T00:00:00.000Z" },
      { status: "wip" },
    );
    expect(out.doneAt).toBeNull();
  });

  it("does not touch doneAt when status stays done", () => {
    const out = applyTimestamped(
      { status: "done", doneAt: "2026-01-01T00:00:00.000Z" },
      { status: "done" },
    );
    expect(out.doneAt).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// collectTeamAssignees
// ---------------------------------------------------------------------------

describe("collectTeamAssignees", () => {
  it("returns [] for null / undefined team", () => {
    expect(collectTeamAssignees(null)).toEqual([]);
    expect(collectTeamAssignees(undefined)).toEqual([]);
  });

  it("returns [] when team has no priorities", () => {
    expect(collectTeamAssignees({ priorities: [] })).toEqual([]);
  });

  it("collects assignees from priorities", () => {
    const team = {
      priorities: [
        { assignee: "Alice", items: [] },
        { assignee: "Bob", items: [] },
      ],
    };
    const result = collectTeamAssignees(team);
    expect(result).toContain("Alice");
    expect(result).toContain("Bob");
    expect(result).toHaveLength(2);
  });

  it("collects assignees from sub-tasks", () => {
    const team = {
      priorities: [
        { assignee: "Alice", items: [{ assignee: "Carol" }] },
      ],
    };
    expect(collectTeamAssignees(team)).toContain("Carol");
  });

  it("deduplicates assignees case-insensitively, preserving first-seen casing", () => {
    const team = {
      priorities: [
        { assignee: "Alice", items: [{ assignee: "alice" }] },
        { assignee: "ALICE", items: [] },
      ],
    };
    const result = collectTeamAssignees(team);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("Alice");
  });

  it("handles comma-separated assignees per row", () => {
    const team = {
      priorities: [{ assignee: "Alice, Bob", items: [] }],
    };
    const result = collectTeamAssignees(team);
    expect(result).toContain("Alice");
    expect(result).toContain("Bob");
  });
});

// ---------------------------------------------------------------------------
// filterMentionMatches
// ---------------------------------------------------------------------------

describe("filterMentionMatches", () => {
  const suggestions = ["Alice", "Bob", "Bangalore"];

  it("returns all suggestions when query is empty", () => {
    expect(filterMentionMatches(suggestions, "")).toEqual(["Alice", "Bob", "Bangalore"]);
    expect(filterMentionMatches(suggestions, null)).toEqual(["Alice", "Bob", "Bangalore"]);
  });

  it("matches by prefix (case-insensitive)", () => {
    expect(filterMentionMatches(suggestions, "ba")).toEqual(["Bangalore"]);
  });

  it("matches by substring", () => {
    expect(filterMentionMatches(suggestions, "ob")).toEqual(["Bob"]);
  });

  it("deduplicates case-insensitive matches", () => {
    const dupes = ["Alice", "alice", "ALICE"];
    expect(filterMentionMatches(dupes, "")).toHaveLength(1);
  });

  it("returns [] when nothing matches", () => {
    expect(filterMentionMatches(suggestions, "xyz")).toEqual([]);
  });
});
