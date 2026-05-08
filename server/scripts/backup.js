// Online SQLite backup. Safe even with concurrent readers/writers.
// Run inside the container; the host wrapper at scripts/backup.sh
// calls this and copies the result out.
//
//   docker compose exec -T tracker node scripts/backup.js /tmp/snapshot.db

import Database from "better-sqlite3";

const src = process.env.DB_PATH || "/data/tracker.db";
const dst = process.argv[2] || "/tmp/snapshot.db";

const db = new Database(src, { readonly: true });
db.backup(dst)
  .then(() => {
    console.log(`backup complete: ${dst}`);
    db.close();
    process.exit(0);
  })
  .catch((err) => {
    console.error("backup failed:", err);
    process.exit(1);
  });
