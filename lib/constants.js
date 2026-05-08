// Display labels + sort ranks + team-settings defaults. Pure data.
//
// Live in lib/ so non-React modules (diff, export, migrate) can read them
// without dragging Lucide icons or Tailwind colors into a browser-free
// context. The full STATUSES / PRIORITIES maps in status_tracker.jsx layer
// Icons + colors on top of these labels.

export const STATUS_LABELS = {
  not_started: "TODO",
  wip: "WIP",
  blocked: "BLOCKED",
  done: "DONE",
};
export const STATUS_ORDER = ["not_started", "wip", "blocked", "done"];
export const STATUS_SORT_RANK = { blocked: 0, wip: 1, not_started: 2, done: 3 };

// Tailwind palette keys allowed for priority colors. Any value outside this
// set is coerced to "stone" by migrateTeamSettings so the JIT purger keeps
// the matching utility classes alive in lib/priority.js's PRIORITY_COLOR_CLASSES.
export const TW_PRIORITY_PALETTE = [
  "red", "orange", "amber", "yellow", "lime", "emerald",
  "teal", "blue", "indigo", "violet", "fuchsia", "pink", "stone",
];

// Default per-team priority list. The "normal" entry is always present and
// always last (rank 99); it represents "no priority tag" and is non-removable.
// P0 is the new top-urgency slot, ranked above P1.
export const DEFAULT_PRIORITIES = [
  { key: "p0",     label: "P0", color: "red",    rank: 0 },
  { key: "p1",     label: "P1", color: "yellow", rank: 1 },
  { key: "p2",     label: "P2", color: "orange", rank: 2 },
  { key: "p3",     label: "P3", color: "blue",   rank: 3 },
  { key: "normal", label: "—",  color: "stone",  rank: 99, builtin: true },
];

// Deprecated shims kept so any in-flight import keeps working until every
// consumer reads team.settings.priorities directly. New code should use
// lib/priority.js helpers instead.
export const PRIORITY_LABELS = Object.fromEntries(
  DEFAULT_PRIORITIES.map(p => [p.key, p.label])
);
export const PRIORITY_ORDER = ["normal", ...DEFAULT_PRIORITIES
  .filter(p => p.key !== "normal")
  .sort((a, b) => a.rank - b.rank)
  .map(p => p.key)];
export const PRIORITY_SORT_RANK = Object.fromEntries(
  DEFAULT_PRIORITIES.map(p => [p.key, p.rank])
);

export const DEFAULT_WORK_TYPES = ["bug", "feature", "research", "onboarding"];

// Curated list of common timezones for the team-Settings dropdown.
// Empty `key: ""` is the "use server default" sentinel so a team that
// doesn't care just inherits the container's TZ env var.
export const COMMON_TIMEZONES = [
  { key: "",                  label: "Use server default" },
  { key: "Asia/Kolkata",      label: "India (IST · UTC+5:30)" },
  { key: "Asia/Singapore",    label: "Singapore (SGT · UTC+8)" },
  { key: "Asia/Tokyo",        label: "Japan (JST · UTC+9)" },
  { key: "Asia/Hong_Kong",    label: "Hong Kong (HKT · UTC+8)" },
  { key: "Asia/Dubai",        label: "Dubai (GST · UTC+4)" },
  { key: "Australia/Sydney",  label: "Sydney (AEST/AEDT · UTC+10/+11)" },
  { key: "Europe/London",     label: "London (GMT/BST · UTC+0/+1)" },
  { key: "Europe/Berlin",     label: "Berlin (CET/CEST · UTC+1/+2)" },
  { key: "Europe/Paris",      label: "Paris (CET/CEST · UTC+1/+2)" },
  { key: "Europe/Moscow",     label: "Moscow (MSK · UTC+3)" },
  { key: "Africa/Johannesburg", label: "Johannesburg (SAST · UTC+2)" },
  { key: "America/New_York",  label: "New York (EST/EDT · UTC-5/-4)" },
  { key: "America/Chicago",   label: "Chicago (CST/CDT · UTC-6/-5)" },
  { key: "America/Denver",    label: "Denver (MST/MDT · UTC-7/-6)" },
  { key: "America/Los_Angeles", label: "Los Angeles (PST/PDT · UTC-8/-7)" },
  { key: "America/Sao_Paulo", label: "São Paulo (BRT · UTC-3)" },
  { key: "America/Mexico_City", label: "Mexico City (CST · UTC-6)" },
  { key: "Pacific/Auckland",  label: "Auckland (NZST/NZDT · UTC+12/+13)" },
  { key: "UTC",               label: "UTC" },
];

// Whitelist of valid `team.settings.tz` values. Anything else gets coerced
// to "" by migrateTeamSettings.
export const VALID_TIMEZONE_KEYS = new Set(COMMON_TIMEZONES.map(t => t.key));

export const DEFAULT_TEAM_SETTINGS = {
  webhooks: [],
  activeWebhookId: null,
  autoPostEnabled: false,
  autoPostHour: 8,
  autoPostMinute: 30,
  lastAutoPostDate: null,
  workTypes: [...DEFAULT_WORK_TYPES],
  notifyOnDue: false,
  nagOverdue: true,
  nagIntervalHours: 4,
  tz: "",
  priorities: DEFAULT_PRIORITIES.map(p => ({ ...p })),
  savedFilters: [],
};
