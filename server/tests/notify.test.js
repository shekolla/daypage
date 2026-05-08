// Server-side due-notification cron tests. Mocks global `fetch` per-test
// so we can observe exactly what the scan posts to chat.googleapis.com,
// then asserts the persisted dedupe state in the SQLite due_notifications
// table.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeApp, seedUser } from "./_helpers.js";

const TEAM_TEMPLATE = (overrides = {}) => ({
  id: "t1",
  name: "Eng",
  title: "Eng — Daily",
  subtitle: "",
  priorities: [],
  history: {},
  archive: [],
  lastSnapshotDate: null,
  settings: {
    webhooks: [{ id: "w1", name: "primary", url: "https://chat.googleapis.com/v1/spaces/X/messages?key=K&token=T" }],
    activeWebhookId: "w1",
    notifyOnDue: true,
    nagOverdue: true,
    nagIntervalHours: 4,
  },
  ...overrides,
});

const ROW_OVERDUE = { id: "p1", title: "Overdue P0", status: "wip", priority: "p0", ticket: "https://example.com/t/1", dueAt: "2026-04-01", items: [] };
const ROW_DONE = { id: "p2", title: "Done overdue", status: "done", priority: "p1", ticket: "", dueAt: "2026-04-01", items: [] };
const ROW_FUTURE = { id: "p3", title: "Future", status: "wip", priority: "p1", ticket: "", dueAt: "2099-01-01", items: [] };

function seedState(db, userId, teams) {
  db.prepare(
    "INSERT INTO user_state (user_id, json, updated_at) VALUES (?, ?, ?)"
  ).run(userId, JSON.stringify({ teams, activeTeamId: teams[0].id }), Date.now());
}

describe("runDueNotificationScan", () => {
  let app, db, runScan, cleanup;
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "ok",
    }));
    vi.stubGlobal("fetch", fetchMock);
    const built = makeApp({ noNotifyCron: true });
    app = built.app;
    db = built.db;
    runScan = built.runDueNotificationScan;
    cleanup = built.cleanup;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("first ping: posts to chat AND inserts a due_notifications row", async () => {
    const userId = seedUser(db, "alice", "correct horse battery staple");
    const team = TEAM_TEMPLATE({ priorities: [ROW_OVERDUE] });
    seedState(db, userId, [team]);

    const summary = await runScan(new Date("2026-05-09T10:00:00Z"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toMatch(/1 item due/);
    expect(body.text).toContain("Overdue P0");
    expect(summary.pings).toBe(1);

    const record = db.prepare(
      "SELECT * FROM due_notifications WHERE user_id = ? AND row_id = ?"
    ).get(userId, "p1");
    expect(record).toBeTruthy();
    expect(record.due_at).toBe("2026-04-01");
    expect(record.first_sent_at).toBe(record.last_sent_at);
  });

  it("nag interval: skips a second ping within the window, fires after", async () => {
    const userId = seedUser(db, "alice", "correct horse battery staple");
    const team = TEAM_TEMPLATE({ priorities: [ROW_OVERDUE] });
    seedState(db, userId, [team]);

    // First scan — ping fires.
    await runScan(new Date("2026-05-09T10:00:00Z"));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Same scan 1 hour later — within 4h window, no ping.
    await runScan(new Date("2026-05-09T11:00:00Z"));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 5 hours later — past 4h window, nag fires.
    await runScan(new Date("2026-05-09T15:01:00Z"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const nagBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(nagBody.text).toMatch(/1 item still overdue/);
  });

  it("nagOverdue=false: only fires the first ping, never nags", async () => {
    const userId = seedUser(db, "alice", "correct horse battery staple");
    const team = TEAM_TEMPLATE({
      priorities: [ROW_OVERDUE],
      settings: { ...TEAM_TEMPLATE().settings, nagOverdue: false },
    });
    seedState(db, userId, [team]);

    await runScan(new Date("2026-05-09T10:00:00Z"));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await runScan(new Date("2026-05-10T10:00:00Z")); // 24h later
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("done rows: ignored even when overdue", async () => {
    const userId = seedUser(db, "alice", "correct horse battery staple");
    const team = TEAM_TEMPLATE({ priorities: [ROW_DONE] });
    seedState(db, userId, [team]);

    await runScan(new Date("2026-05-09T10:00:00Z"));
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("future-due rows: ignored", async () => {
    const userId = seedUser(db, "alice", "correct horse battery staple");
    const team = TEAM_TEMPLATE({ priorities: [ROW_FUTURE] });
    seedState(db, userId, [team]);

    await runScan(new Date("2026-05-09T10:00:00Z"));
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("no active webhook: scan skips silently (no ping, no error)", async () => {
    const userId = seedUser(db, "alice", "correct horse battery staple");
    const team = TEAM_TEMPLATE({
      priorities: [ROW_OVERDUE],
      settings: { ...TEAM_TEMPLATE().settings, webhooks: [], activeWebhookId: null },
    });
    seedState(db, userId, [team]);

    const summary = await runScan(new Date("2026-05-09T10:00:00Z"));
    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(summary.pings).toBe(0);
  });

  it("notifyOnDue=false: scan skips even with overdue rows", async () => {
    const userId = seedUser(db, "alice", "correct horse battery staple");
    const team = TEAM_TEMPLATE({
      priorities: [ROW_OVERDUE],
      settings: { ...TEAM_TEMPLATE().settings, notifyOnDue: false },
    });
    seedState(db, userId, [team]);

    await runScan(new Date("2026-05-09T10:00:00Z"));
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("multiple users + teams: each gets its own combined ping", async () => {
    const aliceId = seedUser(db, "alice", "correct horse battery staple");
    const bobId = seedUser(db, "bob", "correct horse battery staple");

    seedState(db, aliceId, [TEAM_TEMPLATE({ name: "AliceTeam", priorities: [ROW_OVERDUE] })]);
    seedState(db, bobId, [
      TEAM_TEMPLATE({
        id: "tB",
        name: "BobTeam",
        priorities: [{ ...ROW_OVERDUE, id: "px", title: "Bob's overdue thing" }],
      }),
    ]);

    await runScan(new Date("2026-05-09T10:00:00Z"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).text);
    expect(bodies.some((t) => t.includes("AliceTeam"))).toBe(true);
    expect(bodies.some((t) => t.includes("BobTeam"))).toBe(true);
  });

  it("rate-limited forward: still records nothing in due_notifications so the next tick retries", async () => {
    const userId = seedUser(db, "alice", "correct horse battery staple");
    const team = TEAM_TEMPLATE({ priorities: [ROW_OVERDUE] });
    seedState(db, userId, [team]);

    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, text: async () => "" });
    await runScan(new Date("2026-05-09T10:00:00Z"));

    const record = db.prepare(
      "SELECT * FROM due_notifications WHERE user_id = ? AND row_id = ?"
    ).get(userId, "p1");
    expect(record).toBeFalsy();
  });
});
