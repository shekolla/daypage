// Test helpers shared across server tests. Each test gets a fresh
// in-memory SQLite handle + Express app via createApp.
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { createApp } from "../server.js";

const SESSION_SECRET = "test-secret-please-do-not-use-in-prod-32";

export function makeApp(opts = {}) {
  const db = new Database(":memory:");
  const built = createApp({
    db,
    sessionSecret: SESSION_SECRET,
    cookieSecure: false,
    trustProxyHops: 0,
    staticDir: "/tmp/__nonexistent-static-dir__",
    ...opts,
  });
  return built;
}

export function seedUser(db, username, password) {
  const hash = bcrypt.hashSync(password, 4); // cost 4 keeps tests fast
  db.prepare(
    "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)"
  ).run(username, hash, Date.now());
  return db.prepare("SELECT id FROM users WHERE username = ?").get(username).id;
}
