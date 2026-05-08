import { describe, it, expect } from "vitest";
import { isSnoozed } from "../lib/util.js";

describe("isSnoozed", () => {
  it("returns false when no snoozedUntil is set", () => {
    expect(isSnoozed({}, "2026-05-08")).toBe(false);
    expect(isSnoozed({ snoozedUntil: null }, "2026-05-08")).toBe(false);
    expect(isSnoozed({ snoozedUntil: "" }, "2026-05-08")).toBe(false);
  });

  it("hides the row through the snooze date inclusive", () => {
    expect(isSnoozed({ snoozedUntil: "2026-05-08" }, "2026-05-07")).toBe(true);
    expect(isSnoozed({ snoozedUntil: "2026-05-08" }, "2026-05-08")).toBe(true);
  });

  it("surfaces the row again the day after", () => {
    expect(isSnoozed({ snoozedUntil: "2026-05-08" }, "2026-05-09")).toBe(false);
    expect(isSnoozed({ snoozedUntil: "2026-05-08" }, "2026-06-01")).toBe(false);
  });

  it("ignores non-string / null rows safely", () => {
    expect(isSnoozed(null)).toBe(false);
    expect(isSnoozed(undefined)).toBe(false);
    expect(isSnoozed({ snoozedUntil: 123 })).toBe(false);
  });
});
