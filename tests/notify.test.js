import { describe, it, expect } from "vitest";
import {
  shouldPing,
  buildDueNotificationMessage,
  collectOverdueRows,
  endOfDayMs,
} from "../lib/notify.js";

const NOW = new Date("2026-05-09T10:00:00.000Z");

describe("shouldPing", () => {
  it("returns null for a not-yet-overdue row", () => {
    const row = { dueAt: "2099-01-01", status: "wip" };
    expect(shouldPing({ row, now: NOW, lastSentAt: null, nagOverdue: true, nagIntervalHours: 4 })).toBeNull();
  });

  it("returns null for a done row even if overdue", () => {
    const row = { dueAt: "2026-04-01", status: "done" };
    expect(shouldPing({ row, now: NOW, lastSentAt: null, nagOverdue: true, nagIntervalHours: 4 })).toBeNull();
  });

  it("returns 'first' for an overdue row that has never been pinged", () => {
    const row = { dueAt: "2026-04-01", status: "wip" };
    expect(shouldPing({ row, now: NOW, lastSentAt: null, nagOverdue: true, nagIntervalHours: 4 })).toBe("first");
  });

  it("returns null when nagOverdue is off and a ping was already sent", () => {
    const row = { dueAt: "2026-04-01", status: "wip" };
    const lastSentAt = new Date(NOW.getTime() - 24 * 3600_000).toISOString();
    expect(shouldPing({ row, now: NOW, lastSentAt, nagOverdue: false, nagIntervalHours: 4 })).toBeNull();
  });

  it("returns null when within the nag interval", () => {
    const row = { dueAt: "2026-04-01", status: "wip" };
    const lastSentAt = new Date(NOW.getTime() - 1 * 3600_000).toISOString(); // 1h ago
    expect(shouldPing({ row, now: NOW, lastSentAt, nagOverdue: true, nagIntervalHours: 4 })).toBeNull();
  });

  it("returns 'nag' once the interval has elapsed", () => {
    const row = { dueAt: "2026-04-01", status: "wip" };
    const lastSentAt = new Date(NOW.getTime() - 5 * 3600_000).toISOString(); // 5h ago
    expect(shouldPing({ row, now: NOW, lastSentAt, nagOverdue: true, nagIntervalHours: 4 })).toBe("nag");
  });
});

describe("buildDueNotificationMessage", () => {
  it("returns empty string for empty input", () => {
    expect(buildDueNotificationMessage([], "Eng")).toBe("");
  });

  it("renders headline + bulleted rows with priority + ticket links", () => {
    const text = buildDueNotificationMessage(
      [
        { title: "Pager: prod 5xx", ticket: "https://x/1", priorityLabel: "P0" },
        { title: "Migration plan",  ticket: "",            priorityLabel: "P1" },
        { title: "MRN issue",       ticket: "https://x/2", parentTitle: "Beacon dashboard" },
      ],
      "Eng",
      "first",
    );
    expect(text).toMatch(/3 items due\*? — Eng/);
    expect(text).toContain("[Pager: prod 5xx](https://x/1)");
    expect(text).toContain("— P0");
    expect(text).toContain("Migration plan");
    expect(text).toContain("under: Beacon dashboard");
  });

  it("uses 'still overdue' wording for the nag variant", () => {
    const text = buildDueNotificationMessage(
      [{ title: "x", ticket: "", priorityLabel: "P0" }],
      "Team",
      "nag",
    );
    expect(text).toMatch(/1 item still overdue/);
  });

  it("truncates with a '…and N more' bullet when the body would exceed 3800 chars", () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({
      title: `Long title number ${i} that takes up some space when rendered`,
      ticket: `https://example.com/very/long/ticket/path/${i}`,
      priorityLabel: "P0",
    }));
    const text = buildDueNotificationMessage(rows, "Team");
    expect(text.length).toBeLessThan(4096);
    expect(text).toMatch(/…and \d+ more/);
  });
});

describe("endOfDayMs", () => {
  it("returns NaN for invalid input", () => {
    expect(Number.isNaN(endOfDayMs("", ""))).toBe(true);
    expect(Number.isNaN(endOfDayMs("not-a-date", ""))).toBe(true);
    expect(Number.isNaN(endOfDayMs(null, ""))).toBe(true);
  });

  it("Asia/Kolkata: end-of-day = 18:29:59.999 UTC for that calendar day", () => {
    // 2026-05-09 23:59:59.999 IST == 2026-05-09 18:29:59.999 UTC
    const ms = endOfDayMs("2026-05-09", "Asia/Kolkata");
    expect(new Date(ms).toISOString()).toBe("2026-05-09T18:29:59.999Z");
  });

  it("America/New_York: end-of-day = 04:59:59.999 UTC the next day (EDT in May)", () => {
    // EDT (UTC-4) in May. 2026-05-09 23:59:59 EDT == 2026-05-10 03:59:59 UTC.
    const ms = endOfDayMs("2026-05-09", "America/New_York");
    expect(new Date(ms).toISOString()).toBe("2026-05-10T03:59:59.999Z");
  });

  it("UTC: end-of-day = 23:59:59.999Z", () => {
    const ms = endOfDayMs("2026-05-09", "UTC");
    expect(new Date(ms).toISOString()).toBe("2026-05-09T23:59:59.999Z");
  });

  it("with empty tz, falls back to runner local — overdue check still works", () => {
    const ms = endOfDayMs("2026-05-09", "");
    expect(Number.isFinite(ms)).toBe(true);
  });
});

describe("shouldPing — tz-aware overdue", () => {
  it("a row dueAt=today is NOT overdue at 12:00 UTC for Asia/Kolkata (5:30 PM local)", () => {
    // It's 12:00 UTC = 17:30 IST on 2026-05-09. End-of-day IST is 18:29:59 UTC,
    // so we're not overdue yet.
    const now = new Date("2026-05-09T12:00:00Z");
    const decision = shouldPing({
      row: { dueAt: "2026-05-09", status: "wip" },
      now,
      lastSentAt: null,
      nagOverdue: true,
      nagIntervalHours: 4,
      tz: "Asia/Kolkata",
    });
    expect(decision).toBeNull();
  });

  it("a row dueAt=today IS overdue at 19:00 UTC for Asia/Kolkata (00:30 the next day)", () => {
    const now = new Date("2026-05-09T19:00:00Z");
    const decision = shouldPing({
      row: { dueAt: "2026-05-09", status: "wip" },
      now,
      lastSentAt: null,
      nagOverdue: true,
      nagIntervalHours: 4,
      tz: "Asia/Kolkata",
    });
    expect(decision).toBe("first");
  });
});

describe("collectOverdueRows", () => {
  const mkTeam = (overrides = {}) => ({
    id: "t1",
    name: "Eng",
    priorities: [],
    archive: [],
    ...overrides,
  });

  it("returns top-level overdue priorities and overdue sub-tasks, ignoring done + future", () => {
    const team = mkTeam({
      priorities: [
        { id: "p1", title: "Overdue P0",     status: "wip", priority: "p0", dueAt: "2026-04-01", items: [] },
        { id: "p2", title: "Future task",    status: "wip", priority: "p1", dueAt: "2099-01-01", items: [] },
        { id: "p3", title: "Done overdue",   status: "done", priority: "p1", dueAt: "2026-04-01", items: [] },
        { id: "p4", title: "Parent",         status: "wip", priority: "p2", dueAt: null,
          items: [
            { id: "i1", title: "Overdue sub", status: "wip", dueAt: "2026-04-15" },
            { id: "i2", title: "Done sub",    status: "done", dueAt: "2026-04-15" },
          ],
        },
      ],
    });
    const out = collectOverdueRows(team, new Date("2026-05-09T10:00:00Z"), []);
    const ids = out.map(r => r.id).sort();
    expect(ids).toEqual(["i1", "p1"]);
    const sub = out.find(r => r.id === "i1");
    expect(sub.parentTitle).toBe("Parent");
    expect(sub.kind).toBe("item");
  });

  it("uses the team's priority list label when present", () => {
    const team = mkTeam({
      priorities: [
        { id: "p1", title: "Crit", status: "wip", priority: "crit", dueAt: "2026-04-01", items: [] },
      ],
    });
    const list = [{ key: "crit", label: "Critical", color: "red", rank: 0 }];
    const [row] = collectOverdueRows(team, new Date("2026-05-09T10:00:00Z"), list);
    expect(row.priorityLabel).toBe("Critical");
  });

  it("tolerates missing priorities/items arrays", () => {
    expect(collectOverdueRows({}, new Date("2026-05-09T10:00:00Z"), [])).toEqual([]);
    expect(collectOverdueRows(null, new Date("2026-05-09T10:00:00Z"), [])).toEqual([]);
  });
});
