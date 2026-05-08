// Component-level smoke tests. Mount the full StatusTracker with seeded
// data and click through every tab + critical interaction. The point is
// to catch any "tab X explodes when rendered" bug — exactly the class of
// regression that pure-helper tests miss (e.g. an out-of-scope variable
// inside a sub-view).
//
// Storage is seeded via window.storage (the Claude-artifacts shim path
// in lib/api.js). That short-circuits the fetch path entirely so we
// don't need to mock global.fetch.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within, act, fireEvent, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StatusTracker from "../status_tracker.jsx";
import { migrate } from "../lib/migrate.js";

// ---------- seed data --------------------------------------------------

function seedState({ snoozedFuture = "2099-01-01" } = {}) {
  const team = {
    id: "team1",
    name: "Eng",
    title: "Eng — Daily",
    subtitle: "On-call",
    priorities: [
      {
        id: "p0row",
        title: "Pager: prod 5xx errors",
        status: "blocked",
        priority: "p0",
        ticket: "https://example.com/t/1",
        items: [
          {
            id: "i0a",
            title: "Roll back",
            status: "wip",
            ticket: "",
            notes: [],
            links: [],
            createdAt: "2026-05-04T08:00:00.000Z",
          },
        ],
        links: [],
        assignee: "Alice",
        type: "bug",
        description: "Mitigation in progress",
        createdAt: "2026-05-04T08:00:00.000Z",
      },
      {
        id: "p1row",
        title: "Migration plan",
        status: "wip",
        priority: "p1",
        ticket: "",
        items: [],
        assignee: "Bob",
        createdAt: "2026-05-06T08:00:00.000Z",
      },
      {
        id: "p2row",
        title: "Snoozed item",
        status: "wip",
        priority: "p2",
        ticket: "",
        items: [],
        snoozedUntil: snoozedFuture,
        createdAt: "2026-05-01T08:00:00.000Z",
      },
    ],
    history: {
      "2026-05-07": [
        {
          id: "p0row",
          title: "Yesterday snapshot",
          status: "wip",
          priority: "p1",
          ticket: "",
          items: [],
        },
      ],
    },
    archive: [
      {
        id: "iX",
        title: "Old archived sub-task",
        status: "done",
        ticket: "",
        notes: [],
        archivedDate: "2026-05-06",
        parentTitle: "Some parent",
        parentId: "p-old",
        assignee: "Alice",
      },
      {
        id: "iY",
        title: "Way-old archived",
        status: "done",
        ticket: "",
        notes: [],
        archivedDate: "2026-04-15",
        parentTitle: "Old parent",
        parentId: "p-vold",
        assignee: "Bob",
      },
    ],
    // Set lastSnapshotDate to today so rolloverTeam is a no-op and the
    // seeded history isn't overwritten with current priorities.
    lastSnapshotDate: new Date().toISOString().slice(0, 10),
    settings: {},
  };
  return migrate({ teams: [team], activeTeamId: team.id });
}

// ---------- harness ----------------------------------------------------

let mockStore = null;
beforeEach(() => {
  mockStore = JSON.stringify(seedState());
  // window.storage is the Claude-artifacts API path in lib/api.js — when
  // present, the storage shim short-circuits before /api/state. Perfect
  // mock surface for tests.
  window.storage = {
    get: vi.fn(async () => ({ value: mockStore })),
    set: vi.fn(async (_k, v) => { mockStore = v; }),
  };
});

afterEach(() => {
  cleanup();
  delete window.storage;
  vi.restoreAllMocks();
});

// Pick the tab nav button (each tab name appears nowhere else in the UI).
function tabButton(name) {
  const buttons = screen.getAllByRole("button", { name });
  // The tab nav button has a `border-b-2` class — pick that one.
  const tabBtn = buttons.find((b) => b.className.includes("border-b-2"));
  return tabBtn || buttons[0];
}

async function mountTracker() {
  const utils = render(<StatusTracker />);
  // Wait for the initial useEffect that loads from storage to settle.
  // The FilterBar search input is unique to the Today view and stable.
  await screen.findByPlaceholderText(/Search title/i, {}, { timeout: 3000 });
  return utils;
}

// ---------- tests ------------------------------------------------------

describe("StatusTracker — tab rendering smoke", () => {
  it("loads with the Today tab and shows seeded priorities", async () => {
    await mountTracker();
    expect(screen.getByText("Pager: prod 5xx errors")).toBeTruthy();
    expect(screen.getByText("Migration plan")).toBeTruthy();
  });

  it("renders the History tab without crashing (regression: out-of-scope `team`)", async () => {
    const user = userEvent.setup();
    await mountTracker();
    await user.click(tabButton(/^history$/i));
    // We should be looking at the History UI, NOT the ErrorBoundary.
    expect(screen.queryByText(/Something broke/i)).toBeNull();
    expect(screen.getByText("▸ History")).toBeTruthy();
    // Pick the seeded date from the dropdown so we render that snapshot
    const dateSelect = screen.getByRole("combobox");
    await user.selectOptions(dateSelect, "2026-05-07");
    expect(screen.getByText("Yesterday snapshot")).toBeTruthy();
  });

  it("renders the Diff tab without crashing", async () => {
    const user = userEvent.setup();
    await mountTracker();
    await user.click(tabButton(/^diff/i));
    expect(screen.queryByText(/Something broke/i)).toBeNull();
  });

  it("renders the Archive tab and shows seeded archive entries", async () => {
    const user = userEvent.setup();
    await mountTracker();
    await user.click(tabButton(/^archive/i));
    expect(screen.queryByText(/Something broke/i)).toBeNull();
    expect(screen.getByText("Old archived sub-task")).toBeTruthy();
  });

  it("renders the Settings tab with the new Priorities editor block", async () => {
    const user = userEvent.setup();
    await mountTracker();
    await user.click(tabButton(/^settings$/i));
    expect(screen.queryByText(/Something broke/i)).toBeNull();
    expect(screen.getByText(/^Priorities$/)).toBeTruthy();
    expect(screen.getByText(/^Work types$/)).toBeTruthy();
  });

  it("renders the Help view via the header `Help` button (no longer a tab)", async () => {
    const user = userEvent.setup();
    await mountTracker();
    // Help is no longer in the tab strip — verify and use the header button.
    expect(screen.queryAllByRole("button", { name: /^help$/i }).filter(b => b.className.includes("border-b-2"))).toHaveLength(0);
    const helpBtn = screen.getByTitle(/Help — feature reference/i);
    await user.click(helpBtn);
    expect(screen.queryByText(/Something broke/i)).toBeNull();
    expect(screen.getByText("▸ Help")).toBeTruthy();
    // Section headings — match by role+name to avoid colliding with body
    // text mentions. Insights section is new with this commit.
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent || "");
    expect(headings.some((h) => /Priorities & P0/.test(h))).toBe(true);
    expect(headings.some((h) => /^Snooze$/.test(h))).toBe(true);
    expect(headings.some((h) => /^Insights$/.test(h))).toBe(true);
    expect(headings.some((h) => /Keyboard shortcuts/.test(h))).toBe(true);
    expect(headings.some((h) => /Undo \(oops\) toast/.test(h))).toBe(true);
    expect(headings.some((h) => /Saved filter views/.test(h))).toBe(true);
  });
});

describe("StatusTracker — priority dropdown", () => {
  it("opens the PriorityPill listbox and shows every team priority", async () => {
    const user = userEvent.setup();
    await mountTracker();
    // First row's priority pill (P0). Pick by title attribute on the trigger.
    const triggers = screen.getAllByTitle(/Change priority/i);
    expect(triggers.length).toBeGreaterThan(0);
    await user.click(triggers[0]);
    // Listbox is open; default tiers should appear
    const listbox = await screen.findByRole("listbox");
    const labels = within(listbox).getAllByRole("option").map((el) => el.textContent || "");
    expect(labels.some((s) => s.includes("P0"))).toBe(true);
    expect(labels.some((s) => s.includes("P1"))).toBe(true);
    expect(labels.some((s) => s.includes("P2"))).toBe(true);
    expect(labels.some((s) => s.includes("P3"))).toBe(true);
    // The "no priority" entry renders as "—"
    expect(labels.some((s) => s.includes("—"))).toBe(true);
  });
});

describe("StatusTracker — snooze gate", () => {
  it("hides snoozed rows by default and reveals them with the filter", async () => {
    const user = userEvent.setup();
    await mountTracker();
    // Row "Snoozed item" is snoozedUntil far-future → hidden
    expect(screen.queryByText("Snoozed item")).toBeNull();
    // Flip the filter to "Show all"
    const snoozeSelect = screen.getByTitle(/Snoozed visibility/i);
    await user.selectOptions(snoozeSelect, "show");
    expect(screen.getByText("Snoozed item")).toBeTruthy();
    // "Only snoozed" should hide non-snoozed rows
    await user.selectOptions(snoozeSelect, "only");
    expect(screen.getByText("Snoozed item")).toBeTruthy();
    expect(screen.queryByText("Pager: prod 5xx errors")).toBeNull();
  });
});

describe("StatusTracker — undo toast on delete", () => {
  it("shows an Undo toast when a priority is deleted, and restores on click", async () => {
    await mountTracker();
    // Row delete buttons use opacity-0 + group-hover:opacity-100 to stay
    // hidden until hover. user-event v14 refuses to click invisible
    // targets, so we use fireEvent which fires the click handler directly
    // without the visibility check (the user reaches it via hover IRL).
    const deleteButtons = screen.getAllByTitle(/^delete$/i);
    expect(deleteButtons.length).toBeGreaterThan(0);
    // Snapshot how many times the title appears before delete (1 — the row).
    const beforeCount = screen.getAllByText("Pager: prod 5xx errors").length;
    await act(async () => { fireEvent.click(deleteButtons[0]); });
    // After delete: title appears in the toast's <em>, not in the priorities
    // list. Toast also has the Undo button.
    const undoBtn = await screen.findByTitle(/Undo this delete/i);
    expect(undoBtn).toBeTruthy();
    // Click Undo — the row should reappear in the list AND toast goes away.
    await act(async () => { fireEvent.click(undoBtn); });
    // After restore: title appears once more (in the row again), toast is gone.
    expect(screen.queryByTitle(/Undo this delete/i)).toBeNull();
    expect(screen.getAllByText("Pager: prod 5xx errors").length).toBe(beforeCount);
  });
});

describe("StatusTracker — keyboard shortcuts", () => {
  it("opens the cheatsheet on '?' and closes on Escape", async () => {
    await mountTracker();
    expect(screen.queryByText(/Keyboard shortcuts$/i)).toBeNull();
    await act(async () => {
      fireEvent.keyDown(document, { key: "?" });
    });
    expect(screen.getByText(/^Keyboard shortcuts$/i)).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.queryByText(/^Keyboard shortcuts$/i)).toBeNull();
  });

  it("focuses the search input on '/'", async () => {
    await mountTracker();
    const search = screen.getByPlaceholderText(/Search title/i);
    expect(document.activeElement === search).toBe(false);
    await act(async () => {
      fireEvent.keyDown(document, { key: "/" });
    });
    expect(document.activeElement === search).toBe(true);
  });

  it("does not hijack 'j' / 'k' while a text input has focus", async () => {
    await mountTracker();
    const search = screen.getByPlaceholderText(/Search title/i);
    search.focus();
    // No throw, no focused-row state change
    await act(async () => {
      fireEvent.keyDown(search, { key: "j" });
    });
    expect(document.activeElement === search).toBe(true);
  });
});

describe("StatusTracker — saved filter views", () => {
  it("filter chip shows × clear button only when active", async () => {
    const user = userEvent.setup();
    await mountTracker();
    // Inactive priority filter — no clear button visible nearby.
    const prioritySelect = screen.getByTitle(/Filter by priority/i);
    expect(prioritySelect.parentElement.querySelector("button")).toBeNull();
    // Activate it.
    await user.selectOptions(prioritySelect, "p0");
    const clearBtn = prioritySelect.parentElement.querySelector("button");
    expect(clearBtn).toBeTruthy();
    expect(clearBtn.getAttribute("title")).toMatch(/Clear this filter/i);
    // Clicking × clears the filter back to "".
    await user.click(clearBtn);
    expect(prioritySelect.value).toBe("");
    expect(prioritySelect.parentElement.querySelector("button")).toBeNull();
  });

  it("export menu collapses Copy / .txt / Snapshot into one dropdown", async () => {
    const user = userEvent.setup();
    await mountTracker();
    // Dropdown trigger lives in the header — labeled 'Export'.
    const trigger = screen.getByRole("button", { name: /^export/i });
    expect(trigger).toBeTruthy();
    // Menu items aren't visible until the trigger is clicked.
    expect(screen.queryByRole("option", { name: /copy as text/i })).toBeNull();
    await user.click(trigger);
    expect(await screen.findByRole("option", { name: /copy as text/i })).toBeTruthy();
    expect(screen.getByRole("option", { name: /download \.txt/i })).toBeTruthy();
    expect(screen.getByRole("option", { name: /download \.md/i })).toBeTruthy();
    expect(screen.getByRole("option", { name: /download json snapshot/i })).toBeTruthy();
  });

  it("cheatsheet modal applies role=dialog and aria-modal for screen readers", async () => {
    await mountTracker();
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => {
      fireEvent.keyDown(document, { key: "?" });
    });
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toMatch(/keyboard shortcuts/i);
  });

  it("touch-target regression: row delete + chip-clear + header icons are at least 36px tall", async () => {
    await mountTracker();
    // Row delete button — `w-9 h-9` (36×36) hit area
    const rowDeletes = screen.getAllByTitle(/^delete$/i);
    expect(rowDeletes[0].className).toMatch(/w-9/);
    expect(rowDeletes[0].className).toMatch(/h-9/);
    // Header help icon — `w-9 h-9`
    const help = screen.getByRole("button", { name: "Help" });
    expect(help.className).toMatch(/w-9/);
    expect(help.className).toMatch(/h-9/);
  });

  it("Help and Logout shrink to icon-only buttons in the header", async () => {
    await mountTracker();
    // Help is icon-only — title still discoverable, button has aria-label.
    const help = screen.getByRole("button", { name: "Help" });
    expect(help.getAttribute("title")).toMatch(/Help — feature reference/);
    // No visible "Help" text — accessible name comes from aria-label, not body text
    expect(help.textContent.trim()).toBe("");
  });

  it("renders the 'Save current' button only when filters are active", async () => {
    const user = userEvent.setup();
    await mountTracker();
    expect(screen.queryByRole("button", { name: /save current/i })).toBeNull();
    // Activate the priority filter
    const prioritySelect = screen.getByTitle(/Filter by priority/i);
    await user.selectOptions(prioritySelect, "p0");
    expect(screen.getByRole("button", { name: /save current/i })).toBeTruthy();
  });
});

describe("StatusTracker — Insights tab", () => {
  // Freeze just the wall clock so seed timestamps land deterministically in
  // the rolling-N-day windows. We deliberately leave setTimeout/microtasks
  // alone — faking those would deadlock the storage shim's async load.
  let dateSpy;
  beforeEach(() => {
    const fixed = new Date("2026-05-08T12:00:00.000Z").getTime();
    dateSpy = vi.spyOn(Date, "now").mockReturnValue(fixed);
    const RealDate = Date;
    // eslint-disable-next-line no-global-assign
    globalThis.Date = class extends RealDate {
      constructor(...args) { return args.length ? new RealDate(...args) : new RealDate(fixed); }
      static now() { return fixed; }
    };
    mockStore = JSON.stringify(seedState());
  });
  afterEach(() => {
    if (dateSpy) dateSpy.mockRestore();
    // Restore native Date
    // eslint-disable-next-line no-global-assign
    globalThis.Date = Object.getPrototypeOf(globalThis.Date.prototype).constructor;
  });

  // Hero card for `label` — finds the label text, walks two parents up to
  // the wrapping card div. Used to scope a getByText for the big number.
  const heroCard = (label) => screen.getByText(label).parentElement;

  // Window chip with `label`. The Today nav tab also has name "Today" so
  // we can't query by role+name globally; the chips don't have an icon
  // and live below the heading, so scope to the parent of the heading.
  const windowChip = (label) => {
    const heading = screen.getByText("▸ Insights");
    const insightsContainer = heading.parentElement.parentElement;
    return within(insightsContainer).getByRole("button", { name: label });
  };

  it("renders without crashing and shows the four widgets", async () => {
    const user = userEvent.setup();
    await mountTracker();
    await user.click(tabButton(/^insights$/i));
    expect(screen.queryByText(/Something broke/i)).toBeNull();
    expect(screen.getByText("▸ Insights")).toBeTruthy();
    expect(screen.getByText("Velocity")).toBeTruthy();
    expect(screen.getByText("By assignee")).toBeTruthy();
    // All four window chips
    expect(windowChip(/^today$/i)).toBeTruthy();
    expect(windowChip(/^this week$/i)).toBeTruthy();
    expect(windowChip(/^2 weeks$/i)).toBeTruthy();
    expect(windowChip(/^1 month$/i)).toBeTruthy();
  });

  it("hero numbers reflect the seeded fixture (default = this week)", async () => {
    const user = userEvent.setup();
    await mountTracker();
    await user.click(tabButton(/^insights$/i));
    // Created in week (May 2-8): p0row (May 4) + p1row (May 6) + i0a (May 4) = 3
    expect(within(heroCard("Created")).getByText("3")).toBeTruthy();
    // Closed in week: archive iX (May 6). iY is April 15, out of week.
    expect(within(heroCard("Closed")).getByText("1")).toBeTruthy();
    // Open P0/P1: p0row (P0 blocked) + p1row (P1 wip) = 2
    expect(within(heroCard("Open P0/P1")).getByText("2")).toBeTruthy();
  });

  it("changing the window changes the hero numbers", async () => {
    const user = userEvent.setup();
    await mountTracker();
    await user.click(tabButton(/^insights$/i));
    // 1 month window picks up p2row (May 1) + iY (April 15) on top of week numbers.
    await user.click(windowChip(/^1 month$/i));
    expect(within(heroCard("Created")).getByText("4")).toBeTruthy();
    expect(within(heroCard("Closed")).getByText("2")).toBeTruthy();
    // Today window: nothing was created on 2026-05-08 in the seed
    await user.click(windowChip(/^today$/i));
    expect(within(heroCard("Created")).getByText("0")).toBeTruthy();
    expect(within(heroCard("Closed")).getByText("0")).toBeTruthy();
  });
});
