import { describe, it, expect } from "vitest";
import { migrate, migrateTeam, migrateTeamSettings, getActiveTeam, getActiveWebhookUrl } from "../lib/migrate.js";

describe("migrate", () => {
  it("returns a defaultable shape for empty / null / garbage input", () => {
    const a = migrate(null);
    const b = migrate(undefined);
    const c = migrate({});
    for (const out of [a, b, c]) {
      expect(Array.isArray(out.teams)).toBe(true);
      expect(out.teams.length).toBeGreaterThanOrEqual(1);
      expect(out.activeTeamId).toBeTruthy();
    }
  });

  it("wraps a legacy v3 single-team blob into one Default team", () => {
    const v3 = {
      title: "Old Daily",
      subtitle: "Solo",
      priorities: [{ id: "p1", title: "x", status: "wip", priority: "p1", ticket: "", items: [] }],
      history: { "2026-05-01": [] },
      archive: [],
      lastSnapshotDate: "2026-05-05",
      settings: {
        webhookUrl: "https://chat.googleapis.com/v1/spaces/AAA/messages?key=k&token=t",
        autoPostEnabled: true,
        autoPostHour: 9,
        autoPostMinute: 15,
      },
    };
    const out = migrate(v3);
    expect(out.teams).toHaveLength(1);
    const t = out.teams[0];
    expect(t.name).toBe("Default");
    expect(t.title).toBe("Old Daily");
    expect(t.priorities).toHaveLength(1);
    expect(t.lastSnapshotDate).toBe("2026-05-05");
    // legacy webhookUrl lifted to webhooks[0]
    expect(t.settings.webhooks).toHaveLength(1);
    expect(t.settings.webhooks[0].url).toContain("chat.googleapis.com");
    expect(t.settings.activeWebhookId).toBe(t.settings.webhooks[0].id);
    // legacy webhookUrl removed
    expect(t.settings.webhookUrl).toBeUndefined();
  });

  it("round-trips an already-v4 blob without re-wrapping", () => {
    const v4Once = migrate({
      teams: [{ id: "t1", name: "A", title: "T", subtitle: "", priorities: [], history: {}, archive: [], lastSnapshotDate: null, settings: {} }],
      activeTeamId: "t1",
    });
    const v4Twice = migrate(v4Once);
    expect(v4Twice.teams).toHaveLength(1);
    expect(v4Twice.teams[0].id).toBe("t1");
    expect(v4Twice.activeTeamId).toBe("t1");
  });

  it("creates a default team if v4 has zero teams", () => {
    const out = migrate({ teams: [], activeTeamId: null });
    expect(out.teams.length).toBe(1);
    expect(out.activeTeamId).toBe(out.teams[0].id);
  });

  it("falls back activeTeamId to first team if it points at a missing one", () => {
    const t1 = { id: "real", name: "A", title: "", subtitle: "", priorities: [], history: {}, archive: [], settings: {} };
    const out = migrate({ teams: [t1], activeTeamId: "nonexistent" });
    expect(out.activeTeamId).toBe("real");
  });
});

describe("migrateTeamSettings", () => {
  it("populates default workTypes when missing", () => {
    const s = migrateTeamSettings({});
    expect(Array.isArray(s.workTypes)).toBe(true);
    expect(s.workTypes.length).toBeGreaterThan(0);
  });

  it("preserves provided workTypes (trimmed, empties dropped)", () => {
    const s = migrateTeamSettings({ workTypes: ["bug", " feature ", "", null] });
    expect(s.workTypes).toEqual(["bug", "feature"]);
  });

  it("converts legacy webhookUrl into webhooks[]", () => {
    const s = migrateTeamSettings({ webhookUrl: "https://chat.googleapis.com/v1/x" });
    expect(s.webhooks).toHaveLength(1);
    expect(s.activeWebhookId).toBe(s.webhooks[0].id);
    expect(s.webhookUrl).toBeUndefined();
  });

  it("seeds default priorities (incl. P0) when settings.priorities is missing", () => {
    const s = migrateTeamSettings({});
    expect(Array.isArray(s.priorities)).toBe(true);
    const keys = s.priorities.map(p => p.key);
    expect(keys).toEqual(["p0", "p1", "p2", "p3", "normal"]);
    const p0 = s.priorities.find(p => p.key === "p0");
    expect(p0.label).toBe("P0");
    expect(p0.color).toBe("red");
    expect(p0.rank).toBe(0);
    const normal = s.priorities.find(p => p.key === "normal");
    expect(normal.builtin).toBe(true);
    expect(normal.rank).toBe(99);
  });

  it("preserves a user-customized priorities list on re-migration", () => {
    const custom = [
      { key: "crit", label: "Critical", color: "red", rank: 0 },
      { key: "ship", label: "Ship", color: "emerald", rank: 1 },
      { key: "normal", label: "—", color: "stone", rank: 99 },
    ];
    const s = migrateTeamSettings({ priorities: custom });
    expect(s.priorities.map(p => p.key)).toEqual(["crit", "ship", "normal"]);
    expect(s.priorities.find(p => p.key === "normal").builtin).toBe(true);
    // re-running over its own output is idempotent
    const s2 = migrateTeamSettings(s);
    expect(s2.priorities).toEqual(s.priorities);
  });

  it("appends builtin normal entry when missing from user list", () => {
    const s = migrateTeamSettings({
      priorities: [{ key: "p1", label: "P1", color: "yellow", rank: 1 }],
    });
    const last = s.priorities[s.priorities.length - 1];
    expect(last.key).toBe("normal");
    expect(last.builtin).toBe(true);
  });

  it("drops malformed priority entries and coerces invalid colors to stone", () => {
    const s = migrateTeamSettings({
      priorities: [
        { label: "no key" },               // dropped (no key)
        { key: "", label: "blank" },       // dropped (empty key)
        { key: "bad", color: "neon" },     // kept, color → stone
        { key: "ok", label: "OK", color: "blue", rank: 2 },
        { key: "ok", label: "dup", color: "red" }, // dropped (duplicate key)
      ],
    });
    const keys = s.priorities.map(p => p.key);
    expect(keys).toContain("bad");
    expect(keys).toContain("ok");
    expect(keys).toContain("normal");
    expect(s.priorities.find(p => p.key === "bad").color).toBe("stone");
    expect(s.priorities.find(p => p.key === "ok").label).toBe("OK");
    // duplicate "ok" was dropped
    expect(keys.filter(k => k === "ok")).toHaveLength(1);
  });

  it("seeds savedFilters as [] when missing", () => {
    const s = migrateTeamSettings({});
    expect(s.savedFilters).toEqual([]);
  });

  it("seeds nag defaults (true / 4) when missing", () => {
    const s = migrateTeamSettings({});
    expect(s.nagOverdue).toBe(true);
    expect(s.nagIntervalHours).toBe(4);
  });

  it("seeds tz='' (server default) when missing or invalid", () => {
    expect(migrateTeamSettings({}).tz).toBe("");
    expect(migrateTeamSettings({ tz: "Asia/Kolkata" }).tz).toBe("Asia/Kolkata");
    expect(migrateTeamSettings({ tz: "Made/Up" }).tz).toBe("");
    expect(migrateTeamSettings({ tz: 123 }).tz).toBe("");
  });

  it("clamps nagIntervalHours into [1, 72]", () => {
    expect(migrateTeamSettings({ nagIntervalHours: 0 }).nagIntervalHours).toBe(1);
    expect(migrateTeamSettings({ nagIntervalHours: 200 }).nagIntervalHours).toBe(72);
    expect(migrateTeamSettings({ nagIntervalHours: "abc" }).nagIntervalHours).toBe(4);
    expect(migrateTeamSettings({ nagIntervalHours: 6.4 }).nagIntervalHours).toBe(6);
  });

  it("filters malformed savedFilters entries", () => {
    const s = migrateTeamSettings({
      savedFilters: [
        { id: "a", name: "wip", filters: { status: "wip" } },
        { name: "no id", filters: {} },                       // dropped
        { id: "b", filters: {} },                             // dropped (no name)
        { id: "c", name: "no filters" },                      // dropped (no filters)
      ],
    });
    expect(s.savedFilters.map(f => f.id)).toEqual(["a"]);
  });
});

describe("migrateTeam", () => {
  it("fills defaults for missing fields", () => {
    const t = migrateTeam({});
    expect(t.id).toBeTruthy();
    expect(t.name).toBe("Default");
    expect(Array.isArray(t.priorities)).toBe(true);
    expect(t.history).toEqual({});
    expect(Array.isArray(t.archive)).toBe(true);
    expect(t.lastSnapshotDate).toBeNull();
    expect(t.settings).toBeTruthy();
  });
});

describe("getActiveTeam / getActiveWebhookUrl", () => {
  it("returns the active team by id, or first when id is missing", () => {
    const data = {
      teams: [
        { id: "t1", name: "A", priorities: [] },
        { id: "t2", name: "B", priorities: [] },
      ],
      activeTeamId: "t2",
    };
    expect(getActiveTeam(data).id).toBe("t2");
    expect(getActiveTeam({ teams: data.teams, activeTeamId: "missing" }).id).toBe("t1");
    expect(getActiveTeam({ teams: [] })).toBeNull();
    expect(getActiveTeam(null)).toBeNull();
  });

  it("returns the URL of the active webhook entry", () => {
    const settings = {
      webhooks: [
        { id: "w1", name: "primary", url: "https://chat.googleapis.com/p" },
        { id: "w2", name: "backup", url: "https://chat.googleapis.com/b" },
      ],
      activeWebhookId: "w2",
    };
    expect(getActiveWebhookUrl(settings)).toBe("https://chat.googleapis.com/b");
    expect(getActiveWebhookUrl({ webhooks: [], activeWebhookId: null })).toBe("");
    expect(getActiveWebhookUrl(null)).toBe("");
  });
});
