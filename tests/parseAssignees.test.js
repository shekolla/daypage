import { describe, it, expect } from "vitest";
import { parseAssignees } from "../lib/util.js";

describe("parseAssignees", () => {
  it("returns [] for empty / null / undefined / non-string", () => {
    expect(parseAssignees("")).toEqual([]);
    expect(parseAssignees(null)).toEqual([]);
    expect(parseAssignees(undefined)).toEqual([]);
    expect(parseAssignees(42)).toEqual([]);
    expect(parseAssignees({})).toEqual([]);
  });

  it("splits on comma, trims surrounding whitespace", () => {
    expect(parseAssignees("Madhu,NagaSai")).toEqual(["Madhu", "NagaSai"]);
    expect(parseAssignees("  Madhu , NagaSai  ")).toEqual(["Madhu", "NagaSai"]);
  });

  it("drops empty segments produced by trailing or repeated commas", () => {
    expect(parseAssignees("Madhu, , NagaSai,,,")).toEqual(["Madhu", "NagaSai"]);
    expect(parseAssignees(",,,")).toEqual([]);
  });

  it("preserves duplicates (caller decides if they care)", () => {
    expect(parseAssignees("Madhu, Madhu")).toEqual(["Madhu", "Madhu"]);
  });
});
