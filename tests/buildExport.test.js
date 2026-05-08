import { describe, it, expect } from "vitest";
import { buildExport, buildMarkdownExport, exportLinkSummary } from "../lib/export.js";

describe("exportLinkSummary", () => {
  it("returns empty string when no links", () => {
    expect(exportLinkSummary([])).toBe("");
    expect(exportLinkSummary(undefined)).toBe("");
  });

  it("uses provided labels, falls back to inferred from URL host", () => {
    const out = exportLinkSummary([
      { id: "1", label: "spec", url: "https://example.com" },
      { id: "2", label: "", url: "https://docs.google.com/document/d/x" },
    ]);
    expect(out).toContain("spec");
    expect(out).toContain("doc");
  });
});

describe("buildExport", () => {
  it("renders the canonical Slides-format text", () => {
    const team = {
      title: "Daily — Eng",
      subtitle: "On-boardings",
      priorities: [
        {
          id: "p1",
          title: "Beacon dashboard",
          status: "wip",
          priority: "p1",
          ticket: "https://example.com/t/1",
          assignee: "Madhu",
          items: [
            {
              id: "i1",
              title: "MRN issue",
              status: "blocked",
              ticket: "",
              notes: [{ id: "n1", content: "rerun", date: "2026-05-01" }],
              links: [{ id: "l1", label: "doc", url: "https://docs.google.com/document/d/x" }],
            },
          ],
          links: [
            { id: "l2", label: "deck", url: "https://docs.google.com/presentation/d/y" },
          ],
        },
        {
          id: "p2",
          title: "Hendricks rollout",
          status: "done",
          priority: "normal",
          ticket: "",
          doneAt: "2026-05-06T08:30:00.000Z",
          items: [],
        },
      ],
    };
    const text = buildExport(team);
    // header
    expect(text).toMatch(/^Daily — Eng/);
    expect(text).toMatch(/Team Priorities \/ Ongoing Works/);
    // priority rendering
    expect(text).toContain("(P1)");
    expect(text).toContain("Beacon dashboard");
    expect(text).toContain("@Madhu");
    expect(text).toContain("[Ticket: https://example.com/t/1]");
    expect(text).toContain("[Links: deck]");
    // sub-task rendering
    expect(text).toContain("MRN issue");
    expect(text).toContain("BLOCKED");
    expect(text).toContain("[Links: doc]");
    // note rendering
    expect(text).toContain("rerun");
    expect(text).toContain("2026-05-01");
    // done timestamp on the second priority
    expect(text).toMatch(/Hendricks rollout.* – DONE \(done 2026-05-06\)/);
  });

  it("uses the team's customized priority label for the (Tag)", () => {
    const team = {
      title: "Daily",
      priorities: [
        { id: "p", title: "Hot fire", status: "wip", priority: "crit", ticket: "", items: [] },
      ],
      settings: {
        priorities: [
          { key: "crit",   label: "Critical", color: "red",   rank: 0 },
          { key: "normal", label: "—",        color: "stone", rank: 99, builtin: true },
        ],
      },
    };
    const text = buildExport(team);
    expect(text).toContain("(Critical) Hot fire");
    expect(text).not.toContain("(crit)");
  });

  it("suppresses the priority tag when the row's key is stale (no longer in team list)", () => {
    const team = {
      title: "Daily",
      priorities: [
        { id: "p", title: "Old key", status: "wip", priority: "deleted_key", ticket: "", items: [] },
      ],
      settings: {
        priorities: [
          { key: "p1",     label: "P1", color: "yellow", rank: 1 },
          { key: "normal", label: "—",  color: "stone",  rank: 99, builtin: true },
        ],
      },
    };
    const text = buildExport(team);
    expect(text).toContain("Old key");
    expect(text).not.toMatch(/\([^)]*deleted_key[^)]*\)/);
  });

  it("includes (due YYYY-MM-DD) on open rows and skips it on done rows", () => {
    const team = {
      title: "Daily — Eng",
      priorities: [
        {
          id: "p1", title: "Open with due", status: "wip", priority: "normal",
          ticket: "", dueAt: "2026-05-15",
          items: [
            { id: "i1", title: "Sub due tomorrow", status: "wip", ticket: "",
              notes: [], dueAt: "2026-05-09" },
          ],
        },
        {
          id: "p2", title: "Closed with due", status: "done", priority: "normal",
          ticket: "", dueAt: "2026-05-01", doneAt: "2026-05-06T08:30:00.000Z",
          items: [],
        },
      ],
    };
    const text = buildExport(team);
    expect(text).toContain("Open with due");
    expect(text).toContain("(due 2026-05-15)");
    expect(text).toContain("(due 2026-05-09)");
    // Done row: due date is suppressed; done timestamp wins
    expect(text).not.toContain("(due 2026-05-01)");
    expect(text).toMatch(/Closed with due.* – DONE \(done 2026-05-06\)/);
  });
});

describe("buildMarkdownExport", () => {
  it("renders the canonical GFM structure for a populated team", () => {
    const team = {
      title: "Daily — Eng",
      subtitle: "On-boardings",
      priorities: [
        {
          id: "p1",
          title: "Beacon dashboard",
          status: "wip",
          priority: "p1",
          ticket: "https://example.com/t/1",
          assignee: "Madhu",
          dueAt: "2026-05-15",
          description: "Mitigation in progress",
          items: [
            {
              id: "i1",
              title: "MRN issue",
              status: "blocked",
              ticket: "",
              notes: [{ id: "n1", content: "rerun", date: "2026-05-01" }],
              links: [{ id: "l1", label: "doc", url: "https://docs.google.com/document/d/x" }],
            },
          ],
          links: [
            { id: "l2", label: "deck", url: "https://docs.google.com/presentation/d/y" },
          ],
        },
      ],
    };
    const md = buildMarkdownExport(team);
    expect(md).toMatch(/^# Daily — Eng/);
    expect(md).toMatch(/On-boardings/);
    expect(md).toMatch(/^> 1 priorities · 1 sub-items/m);
    expect(md).toMatch(/^## Team Priorities \/ Ongoing Works/m);
    expect(md).toMatch(/^### 1\. `P1` Beacon dashboard — WIP/m);
    expect(md).toContain("**@Madhu**");
    expect(md).toContain("[ticket](https://example.com/t/1)");
    expect(md).toContain("due 2026-05-15");
    expect(md).toContain("[deck](https://docs.google.com/presentation/d/y)");
    expect(md).toContain("> Mitigation in progress");
    // Sub-task task list with status badge
    expect(md).toMatch(/- \[ \] \*\*BLOCKED\*\* — MRN issue/);
    expect(md).toContain("[doc](https://docs.google.com/document/d/x)");
    // Note nested under the sub-task
    expect(md).toMatch(/  - _2026-05-01_ — rerun/);
  });

  it("omits priority tag for `normal` and unknown keys", () => {
    const team = {
      title: "T",
      priorities: [
        { id: "p1", title: "Plain", status: "wip", priority: "normal", ticket: "", items: [] },
        { id: "p2", title: "Stale", status: "wip", priority: "deleted_key", ticket: "", items: [],
          settings: { priorities: [] } },
      ],
      settings: { priorities: [{ key: "normal", label: "—", color: "stone", rank: 99, builtin: true }] },
    };
    const md = buildMarkdownExport(team);
    expect(md).toMatch(/^### 1\. Plain/m);   // no `\`...\`` prefix
    expect(md).toMatch(/^### 2\. Stale/m);
    expect(md).not.toMatch(/`(NONE|normal|deleted_key|—)`/);
  });

  it("strikethroughs done titles on both priorities and sub-tasks", () => {
    const team = {
      title: "T",
      priorities: [
        {
          id: "p1", title: "Hendricks rollout", status: "done", priority: "normal",
          doneAt: "2026-05-06T08:00:00.000Z", ticket: "",
          items: [
            { id: "i1", title: "Onboarding completed", status: "done",
              doneAt: "2026-05-06T08:00:00.000Z", ticket: "", notes: [] },
          ],
        },
      ],
    };
    const md = buildMarkdownExport(team);
    expect(md).toMatch(/^### 1\. ~~Hendricks rollout~~ — DONE/m);
    expect(md).toMatch(/- \[x\] ~~Onboarding completed~~/);
  });

  it("uses checkbox state matching done-ness", () => {
    const team = {
      title: "T",
      priorities: [
        {
          id: "p1", title: "Mixed bag", status: "wip", priority: "normal", ticket: "",
          items: [
            { id: "i1", title: "still going", status: "wip", ticket: "", notes: [] },
            { id: "i2", title: "shipped",     status: "done", ticket: "", notes: [],
              doneAt: "2026-05-06T08:00:00.000Z" },
          ],
        },
      ],
    };
    const md = buildMarkdownExport(team);
    expect(md).toMatch(/- \[ \] \*\*WIP\*\* — still going/);
    expect(md).toMatch(/- \[x\] ~~shipped~~/);
  });

  it("emits due on open rows and done timestamp on closed rows (mutually exclusive)", () => {
    const team = {
      title: "T",
      priorities: [
        { id: "p1", title: "Open", status: "wip", priority: "normal", ticket: "",
          dueAt: "2026-05-15", items: [] },
        { id: "p2", title: "Closed", status: "done", priority: "normal", ticket: "",
          dueAt: "2026-05-01", doneAt: "2026-05-06T08:00:00.000Z", items: [] },
      ],
    };
    const md = buildMarkdownExport(team);
    expect(md).toContain("due 2026-05-15");
    expect(md).toContain("done 2026-05-06");
    expect(md).not.toContain("due 2026-05-01");
  });

  it("handles an empty team — H1 + stats only, no Team Priorities section", () => {
    const md = buildMarkdownExport({ title: "Empty", priorities: [] });
    expect(md).toMatch(/^# Empty/);
    expect(md).toMatch(/^> 0 priorities · 0 sub-items/m);
    expect(md).not.toContain("## Team Priorities");
  });
});
