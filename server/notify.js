// Server-side scheduler for due-date notifications. Walks every user's
// state every tick (default 60s), finds rows that are overdue + still
// open, and posts to each team's active webhook via the shared
// forwardToChatPost helper.
//
// Dedupe is persisted in the `due_notifications` table — survives server
// restarts so a cron tick after reboot doesn't re-spam already-pinged
// items. Records are keyed by (user_id, row_id, due_at) so a row whose
// dueAt changes effectively gets a fresh first-ping.
//
// Counterpart to the client-side tick in status_tracker.jsx — both fire
// the same content, just from different timer scopes. Server-side fills
// the "no tab open" reliability gap.

import { getActiveWebhookUrl } from "../lib/migrate.js";
import {
  collectOverdueRows,
  shouldPing,
  buildDueNotificationMessage,
} from "../lib/notify.js";

// `db` is a better-sqlite3 handle. `forwardToChatPost` is the helper
// extracted from server.js. `now` is injectable for tests.
export async function runDueNotificationScan({ db, forwardToChatPost, now = new Date() }) {
  const users = db.prepare("SELECT id, username FROM users").all();
  const stateStmt = db.prepare("SELECT json FROM user_state WHERE user_id = ?");
  const recordStmt = db.prepare(
    "SELECT first_sent_at, last_sent_at FROM due_notifications WHERE user_id = ? AND row_id = ? AND due_at = ?"
  );
  const upsertStmt = db.prepare(
    `INSERT INTO due_notifications (user_id, row_id, due_at, first_sent_at, last_sent_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, row_id, due_at) DO UPDATE SET last_sent_at = excluded.last_sent_at`
  );

  const summary = { users: 0, pings: 0, skipped: 0 };

  for (const user of users) {
    summary.users += 1;
    const stateRow = stateStmt.get(user.id);
    if (!stateRow?.json) continue;
    let data;
    try { data = JSON.parse(stateRow.json); } catch { continue; }

    for (const team of (data.teams || [])) {
      if (!team || team.settings?.notifyOnDue !== true) continue;
      const webhookUrl = getActiveWebhookUrl(team.settings);
      if (!webhookUrl) continue;

      const tz = team.settings?.tz || "";
      const overdue = collectOverdueRows(team, now, team.settings?.priorities, tz);
      if (overdue.length === 0) continue;

      const firstRows = [];
      const nagRows = [];
      for (const row of overdue) {
        const record = recordStmt.get(user.id, row.id, row.dueAt);
        const decision = shouldPing({
          row,
          now,
          lastSentAt: record?.last_sent_at || null,
          nagOverdue: team.settings?.nagOverdue !== false,
          nagIntervalHours: team.settings?.nagIntervalHours || 4,
          tz,
        });
        if (decision === "first") firstRows.push(row);
        else if (decision === "nag") nagRows.push(row);
        else summary.skipped += 1;
      }

      if (firstRows.length > 0) {
        const text = buildDueNotificationMessage(firstRows, team.name, "first");
        const result = await forwardToChatPost({
          userId: user.id,
          username: user.username,
          url: webhookUrl,
          text,
        });
        if (result.ok) {
          const ts = now.toISOString();
          for (const row of firstRows) {
            upsertStmt.run(user.id, row.id, row.dueAt, ts, ts);
          }
          summary.pings += 1;
        }
      }

      if (nagRows.length > 0) {
        const text = buildDueNotificationMessage(nagRows, team.name, "nag");
        const result = await forwardToChatPost({
          userId: user.id,
          username: user.username,
          url: webhookUrl,
          text,
        });
        if (result.ok) {
          const ts = now.toISOString();
          for (const row of nagRows) {
            // For a nag, we already have a record — only bump last_sent_at.
            // The upsert keeps first_sent_at unchanged because of the
            // ON CONFLICT clause above (it only touches last_sent_at).
            const existing = recordStmt.get(user.id, row.id, row.dueAt);
            const firstAt = existing?.first_sent_at || ts;
            upsertStmt.run(user.id, row.id, row.dueAt, firstAt, ts);
          }
          summary.pings += 1;
        }
      }
    }
  }
  return summary;
}

// Garbage collect records whose due_at is more than `keepDays` old. Cheap
// to run hourly; keeps the table from growing forever as users delete /
// snooze / mark-done overdue items.
export function pruneStaleDueNotifications(db, keepDays = 90) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - keepDays);
  const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
  const result = db.prepare("DELETE FROM due_notifications WHERE due_at < ?").run(cutoffStr);
  return result.changes;
}
