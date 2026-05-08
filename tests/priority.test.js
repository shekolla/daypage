import { describe, it, expect } from "vitest";
import {
  resolvePriorityDef,
  priorityRank,
  isTopUrgency,
  sortedPriorities,
  PRIORITY_COLOR_CLASSES,
  priorityColorClasses,
} from "../lib/priority.js";
import { DEFAULT_PRIORITIES, TW_PRIORITY_PALETTE } from "../lib/constants.js";

describe("resolvePriorityDef", () => {
  it("returns the matching def from a list", () => {
    const def = resolvePriorityDef("p1", DEFAULT_PRIORITIES);
    expect(def.key).toBe("p1");
    expect(def.label).toBe("P1");
    expect(def.color).toBe("yellow");
  });

  it("returns the synthetic unknown def when the key is missing", () => {
    const def = resolvePriorityDef("not-a-real-key", DEFAULT_PRIORITIES);
    expect(def.unknown).toBe(true);
    expect(def.color).toBe("stone");
    expect(def.label).toBe("—");
  });

  it("falls back to DEFAULT_PRIORITIES when the list is empty/null", () => {
    expect(resolvePriorityDef("p0", []).color).toBe("red");
    expect(resolvePriorityDef("p0", null).color).toBe("red");
    expect(resolvePriorityDef("p0", undefined).color).toBe("red");
  });

  it("respects custom priorities over DEFAULT_PRIORITIES", () => {
    const list = [
      { key: "crit", label: "Critical", color: "red", rank: 0 },
      { key: "normal", label: "—", color: "stone", rank: 99, builtin: true },
    ];
    expect(resolvePriorityDef("crit", list).label).toBe("Critical");
    // p1 not in custom list → unknown
    expect(resolvePriorityDef("p1", list).unknown).toBe(true);
  });
});

describe("priorityRank", () => {
  it("returns the numeric rank for a known key", () => {
    expect(priorityRank("p0", DEFAULT_PRIORITIES)).toBe(0);
    expect(priorityRank("p1", DEFAULT_PRIORITIES)).toBe(1);
    expect(priorityRank("normal", DEFAULT_PRIORITIES)).toBe(99);
  });

  it("returns MAX_SAFE_INTEGER for an unknown key (sorts last)", () => {
    expect(priorityRank("nope", DEFAULT_PRIORITIES)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("isTopUrgency", () => {
  it("is true only for rank-0 entries", () => {
    expect(isTopUrgency("p0", DEFAULT_PRIORITIES)).toBe(true);
    expect(isTopUrgency("p1", DEFAULT_PRIORITIES)).toBe(false);
    expect(isTopUrgency("normal", DEFAULT_PRIORITIES)).toBe(false);
    expect(isTopUrgency("nope", DEFAULT_PRIORITIES)).toBe(false);
  });
});

describe("sortedPriorities", () => {
  it("orders by rank ascending and pins normal at the end", () => {
    const out = sortedPriorities(DEFAULT_PRIORITIES);
    expect(out.map(p => p.key)).toEqual(["p0", "p1", "p2", "p3", "normal"]);
  });

  it("pins normal even if its rank is wrong", () => {
    const list = [
      { key: "normal", label: "—", color: "stone", rank: 0, builtin: true },
      { key: "p1", label: "P1", color: "yellow", rank: 5 },
    ];
    const out = sortedPriorities(list);
    expect(out.map(p => p.key)).toEqual(["p1", "normal"]);
  });

  it("falls back to DEFAULT_PRIORITIES on empty list", () => {
    expect(sortedPriorities([]).length).toBe(DEFAULT_PRIORITIES.length);
  });
});

describe("PRIORITY_COLOR_CLASSES", () => {
  it("has an entry for every TW_PRIORITY_PALETTE key", () => {
    for (const c of TW_PRIORITY_PALETTE) {
      expect(PRIORITY_COLOR_CLASSES[c]).toBeDefined();
      expect(typeof PRIORITY_COLOR_CLASSES[c].chip).toBe("string");
      expect(typeof PRIORITY_COLOR_CLASSES[c].text).toBe("string");
      expect(typeof PRIORITY_COLOR_CLASSES[c].swatch).toBe("string");
      expect(typeof PRIORITY_COLOR_CLASSES[c].rowBorder).toBe("string");
    }
  });

  it("never builds class strings dynamically (literal-only values)", () => {
    // Any value containing "${" indicates someone tried template-string
    // class names — Tailwind's purger would drop those.
    for (const c of TW_PRIORITY_PALETTE) {
      const entry = PRIORITY_COLOR_CLASSES[c];
      for (const v of Object.values(entry)) {
        expect(v.includes("${")).toBe(false);
      }
    }
  });
});

describe("priorityColorClasses", () => {
  it("returns the matching entry, or stone for an unknown color", () => {
    expect(priorityColorClasses("yellow").chip).toBe("bg-yellow-300");
    expect(priorityColorClasses("nope").chip).toBe("bg-transparent"); // stone fallback
  });
});
