import { describe, it, expect } from "vitest";
import {
  parseDueDate, dueBucket, formatDueRelative, isDueNotifiable,
} from "../lib/util.js";

const at = (y, mo, d, h = 12, mi = 0) =>
  new Date(y, mo - 1, d, h, mi, 0, 0);

describe("parseDueDate", () => {
  it("returns null for falsy or malformed input", () => {
    expect(parseDueDate("")).toBeNull();
    expect(parseDueDate(null)).toBeNull();
    expect(parseDueDate(undefined)).toBeNull();
    expect(parseDueDate("2026/05/15")).toBeNull();
    expect(parseDueDate("2026-5-15")).toBeNull();
    expect(parseDueDate("not a date")).toBeNull();
  });

  it("parses YYYY-MM-DD as end-of-day local time", () => {
    const d = parseDueDate("2026-05-15");
    expect(d).not.toBeNull();
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(4);
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
  });
});

describe("dueBucket", () => {
  const now = at(2026, 5, 8, 10);

  it("returns 'none' for missing dueAt", () => {
    expect(dueBucket(null, "wip", now)).toBe("none");
    expect(dueBucket("", "wip", now)).toBe("none");
  });

  it("returns 'none' for done items even if past due", () => {
    expect(dueBucket("2026-05-01", "done", now)).toBe("none");
    expect(dueBucket("2026-05-08", "done", now)).toBe("none");
  });

  it("returns 'today' when dueAt is today", () => {
    expect(dueBucket("2026-05-08", "wip", now)).toBe("today");
    expect(dueBucket("2026-05-08", "blocked", now)).toBe("today");
  });

  it("returns 'overdue' for past dates", () => {
    expect(dueBucket("2026-05-07", "wip", now)).toBe("overdue");
    expect(dueBucket("2026-04-01", "not_started", now)).toBe("overdue");
  });

  it("returns 'soon' within next 6 days", () => {
    expect(dueBucket("2026-05-09", "wip", now)).toBe("soon");
    expect(dueBucket("2026-05-14", "wip", now)).toBe("soon");
  });

  it("returns 'later' beyond 6 days out", () => {
    expect(dueBucket("2026-05-15", "wip", now)).toBe("later");
    expect(dueBucket("2026-12-31", "wip", now)).toBe("later");
  });

  it("rejects malformed dueAt as 'none'", () => {
    expect(dueBucket("garbage", "wip", now)).toBe("none");
  });
});

describe("formatDueRelative", () => {
  const now = at(2026, 5, 8, 10);

  it("returns '' for missing or malformed dueAt", () => {
    expect(formatDueRelative(null, now)).toBe("");
    expect(formatDueRelative("", now)).toBe("");
    expect(formatDueRelative("garbage", now)).toBe("");
  });

  it("formats today / tomorrow / yesterday", () => {
    expect(formatDueRelative("2026-05-08", now)).toBe("due today");
    expect(formatDueRelative("2026-05-09", now)).toBe("due tomorrow");
    expect(formatDueRelative("2026-05-07", now)).toBe("1d overdue");
  });

  it("formats overdue with day count", () => {
    expect(formatDueRelative("2026-05-05", now)).toBe("3d overdue");
    expect(formatDueRelative("2026-04-28", now)).toBe("10d overdue");
  });

  it("formats near-future with day count, far-future with date", () => {
    expect(formatDueRelative("2026-05-11", now)).toBe("due in 3d");
    expect(formatDueRelative("2026-05-14", now)).toBe("due in 6d");
    expect(formatDueRelative("2026-05-15", now)).toBe("due 2026-05-15");
  });

  it("drops the overdue/due-today framing on done rows — neutral date only", () => {
    expect(formatDueRelative("2026-05-05", now, "done")).toBe("due 2026-05-05");
    expect(formatDueRelative("2026-05-08", now, "done")).toBe("due 2026-05-08");
    expect(formatDueRelative("2026-05-15", now, "done")).toBe("due 2026-05-15");
  });
});

describe("isDueNotifiable", () => {
  const now = at(2026, 5, 8, 10);

  it("ignores missing or done", () => {
    expect(isDueNotifiable(null, "wip", now)).toBe(false);
    expect(isDueNotifiable("2026-05-08", "done", now)).toBe(false);
  });

  it("fires within the trailing window after due time", () => {
    // due was at 23:59:59.999 on 2026-05-07. now = 2026-05-08 10:00 — well past
    // 1h trailing window, so default window=1h won't notify.
    expect(isDueNotifiable("2026-05-07", "wip", now)).toBe(false);
    // widen the window: should now fire
    const dayMs = 24 * 60 * 60 * 1000;
    expect(isDueNotifiable("2026-05-07", "wip", now, dayMs)).toBe(true);
  });

  it("does not fire for future-due rows", () => {
    expect(isDueNotifiable("2026-05-09", "wip", now)).toBe(false);
    expect(isDueNotifiable("2026-05-15", "wip", now)).toBe(false);
  });

  it("fires when now is just past today's end-of-day", () => {
    const justAfterMidnight = new Date(2026, 4, 9, 0, 30, 0, 0);
    expect(isDueNotifiable("2026-05-08", "wip", justAfterMidnight)).toBe(true);
  });
});
