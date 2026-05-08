// Multi-team data model + schema migration.
//
// Top-level state is a list of teams + the id of the active one. Each team
// owns its own priorities, history, archive, and settings. Schema migration
// is handled in `migrate()`: legacy single-team v3 blobs (everything at the
// top level) are wrapped into one team named "Default".

import { uid } from "./util.js";
import {
  DEFAULT_TEAM_SETTINGS,
  DEFAULT_WORK_TYPES,
  DEFAULT_PRIORITIES,
  TW_PRIORITY_PALETTE,
  VALID_TIMEZONE_KEYS,
} from "./constants.js";

export function newTeam(name = "Default", overrides = {}) {
  return {
    id: uid(),
    name,
    title: "Daily Status Summary",
    subtitle: "Personal Tracker",
    priorities: [],
    history: {},
    archive: [],
    lastSnapshotDate: null,
    settings: { ...DEFAULT_TEAM_SETTINGS },
    ...overrides,
  };
}

export function createDefaultData() {
  const team = newTeam("Default");
  return { teams: [team], activeTeamId: team.id };
}

export function migrateTeamSettings(raw) {
  const settings = { ...DEFAULT_TEAM_SETTINGS, ...(raw || {}) };
  if (!Array.isArray(settings.webhooks) || settings.webhooks.length === 0) {
    if (settings.webhookUrl) {
      const id = uid();
      settings.webhooks = [{ id, name: "Default", url: settings.webhookUrl }];
      settings.activeWebhookId = id;
    } else {
      settings.webhooks = [];
      settings.activeWebhookId = null;
    }
  }
  delete settings.webhookUrl;
  if (!Array.isArray(settings.workTypes)) {
    settings.workTypes = [...DEFAULT_WORK_TYPES];
  } else {
    settings.workTypes = settings.workTypes
      .map(t => (typeof t === "string" ? t.trim() : ""))
      .filter(Boolean);
  }
  if (!Array.isArray(settings.priorities) || settings.priorities.length === 0) {
    settings.priorities = DEFAULT_PRIORITIES.map(p => ({ ...p }));
  } else {
    const seen = new Set();
    settings.priorities = settings.priorities
      .filter(p => p && typeof p.key === "string" && p.key.trim())
      .map(p => {
        const key = p.key.trim();
        return {
          key,
          label: typeof p.label === "string" && p.label.length > 0 ? p.label : key,
          color: TW_PRIORITY_PALETTE.includes(p.color) ? p.color : "stone",
          rank: Number.isFinite(p.rank) ? p.rank : 99,
          ...(key === "normal" ? { builtin: true } : {}),
        };
      })
      .filter(p => {
        if (seen.has(p.key)) return false;
        seen.add(p.key);
        return true;
      });
    if (!settings.priorities.some(p => p.key === "normal")) {
      const normalDef = DEFAULT_PRIORITIES.find(p => p.key === "normal");
      settings.priorities.push({ ...normalDef });
    }
  }
  if (!Array.isArray(settings.savedFilters)) {
    settings.savedFilters = [];
  } else {
    settings.savedFilters = settings.savedFilters
      .filter(f => f && typeof f.id === "string" && typeof f.name === "string" && f.filters && typeof f.filters === "object")
      .map(f => ({ id: f.id, name: f.name, filters: f.filters }));
  }
  // Due-date notification cadence. nagOverdue defaults to true so a user
  // who turns on notifyOnDue gets the full pressure (one ping at due
  // moment + repeat every nagIntervalHours). Disable explicitly to fall
  // back to one-shot only.
  if (typeof settings.nagOverdue !== "boolean") {
    settings.nagOverdue = true;
  }
  const rawIntervalH = +settings.nagIntervalHours;
  settings.nagIntervalHours = Number.isFinite(rawIntervalH)
    ? Math.max(1, Math.min(72, Math.round(rawIntervalH)))
    : 4;
  // Per-team timezone override for due-date math. Empty string = inherit
  // the server's TZ env var (which defaults to Asia/Kolkata in our compose
  // file). Any value not in the curated whitelist is coerced to "" so a
  // hand-edited backup can't smuggle in an unknown identifier.
  if (typeof settings.tz !== "string" || !VALID_TIMEZONE_KEYS.has(settings.tz)) {
    settings.tz = "";
  }
  return settings;
}

export function migrateTeam(raw) {
  return {
    id: raw.id || uid(),
    name: raw.name || "Default",
    title: raw.title || "Daily Status Summary",
    subtitle: raw.subtitle || "Personal Tracker",
    priorities: Array.isArray(raw.priorities) ? raw.priorities : [],
    history: raw.history && typeof raw.history === "object" ? raw.history : {},
    archive: Array.isArray(raw.archive) ? raw.archive : [],
    lastSnapshotDate: raw.lastSnapshotDate || null,
    settings: migrateTeamSettings(raw.settings),
  };
}

export function migrate(data) {
  if (!data || typeof data !== "object") return createDefaultData();

  // v4-shape: already has teams[]
  if (Array.isArray(data.teams)) {
    const teams = data.teams.length > 0
      ? data.teams.map(migrateTeam)
      : [newTeam("Default")];
    const activeTeamId = teams.find(t => t.id === data.activeTeamId)?.id || teams[0].id;
    return { teams, activeTeamId };
  }

  // v3-shape: top-level priorities/settings/etc → wrap into one team
  const team = migrateTeam({
    name: "Default",
    title: data.title,
    subtitle: data.subtitle,
    priorities: data.priorities,
    history: data.history,
    archive: data.archive,
    lastSnapshotDate: data.lastSnapshotDate,
    settings: data.settings,
  });
  return { teams: [team], activeTeamId: team.id };
}

export function getActiveTeam(data) {
  if (!data?.teams?.length) return null;
  return data.teams.find(t => t.id === data.activeTeamId) || data.teams[0];
}

export function getActiveWebhookUrl(settings) {
  if (!settings) return "";
  const wh = settings.webhooks?.find((w) => w.id === settings.activeWebhookId);
  return wh?.url || "";
}

// Sample team mirroring the original "Daily Status Summary" Slides deck.
// Lets a new user click one button and see the full nested layout populated.
export function buildExampleTeam(name = "Data Engineering") {
  const stamp = (o) => ({ ...o, id: uid() });
  const T = (slug) => `https://example.com/ticket/${slug}`;

  return newTeam(name, {
    title: `${name} — Daily Status Summary`,
    subtitle: "Clients On-boardings",
    priorities: [
      stamp({
        title: "VCMC — received MPI file from VCMC; update VCMC data in dexur with information from MPI",
        status: "wip", priority: "normal", ticket: T("vcmc-mpi-update"),
        items: [],
      }),
      stamp({
        title: "Beacon",
        status: "wip", priority: "p1", ticket: "",
        items: [
          stamp({
            title: "Beacon Kalamazoo numerator (Performance Across All Quality Measures dashboard) + Payer segregation — MRN issue",
            status: "wip", ticket: T("beacon-kalamazoo-mrn"),
            notes: [stamp({ content: "Delete old golden encounters & rerun", date: "2026-05-01" })],
          }),
          stamp({
            title: "Loading the ADT feed for Beacon (data missing in parsing — add fields)",
            status: "wip", ticket: T("beacon-adt-feed"),
            notes: [stamp({ content: "Fields missing in parsing — adding + rerunning", date: "2026-05-01" })],
          }),
          stamp({
            title: "Received historical 835 files; daily 835 + 837p files also incoming. Loading the 835s data",
            status: "wip", ticket: T("beacon-835-load"),
            notes: [],
          }),
        ],
      }),
      stamp({
        title: "CMH Payer segregation — done internally, not live yet (WIP)",
        status: "wip", priority: "normal", ticket: T("cmh-payer-seg"),
        items: [
          stamp({
            title: "Dependent on new encounter grouping logic to go live",
            status: "blocked", ticket: "",
            notes: [stamp({ content: "Waiting on new encounter grouping logic", date: "2026-05-01" })],
          }),
        ],
      }),
      stamp({
        title: "Hendricks 837 & 835 EDI onboarding — not live yet (WIP)",
        status: "wip", priority: "normal", ticket: T("hendricks-edi"),
        items: [
          stamp({
            title: "Dependent on new encounter grouping logic to go live",
            status: "blocked", ticket: "",
            notes: [stamp({ content: "Waiting on new encounter grouping logic", date: "2026-05-01" })],
          }),
        ],
      }),
      stamp({
        title: "AHMC EDI 837i/835 files onboarding and reconciliation — ready to go live",
        status: "wip", priority: "normal", ticket: T("ahmc-edi"),
        items: [
          stamp({ title: "Loading starting today", status: "wip", ticket: "", notes: [] }),
        ],
      }),
      stamp({
        title: "Providence EDI 837i/835 files onboarding and reconciliation — missing data",
        status: "blocked", priority: "normal", ticket: T("providence-edi"),
        items: [
          stamp({ title: "Waiting for NPIs mapping completion", status: "blocked", ticket: "", notes: [] }),
        ],
      }),
      stamp({
        title: "Redlands Community Hospital EDI 837i/835 files onboarding",
        status: "done", priority: "normal", ticket: T("redlands-edi"),
        items: [
          stamp({
            title: "Onboarding completed",
            status: "done", ticket: "",
            notes: [stamp({ content: "Completed", date: "2026-05-01" })],
          }),
        ],
      }),
      stamp({
        title: "Temecula Valley Hospital — client sharing ADT live feed; loading data",
        status: "wip", priority: "normal", ticket: T("temecula-adt"),
        items: [],
      }),
      stamp({
        title: "VCMC patient rounding form requests",
        status: "wip", priority: "normal", ticket: T("vcmc-rounding-form"),
        items: [],
      }),
      stamp({
        title: "Loading the customised files for RUHS",
        status: "wip", priority: "normal", ticket: T("ruhs-custom"),
        items: [
          stamp({ title: "Close to 90% match (also waiting for missing files)", status: "wip", ticket: "", notes: [] }),
          stamp({ title: "Will start loading", status: "not_started", ticket: "", notes: [] }),
        ],
      }),
    ],
  });
}
