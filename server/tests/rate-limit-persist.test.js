import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { createApp } from "../server.js";
import { seedUser } from "./_helpers.js";

// The rate-limit state lives in the `rate_limit` SQLite table — survives a
// process restart (i.e., closing the Express app and rebuilding it against
// the same DB). Pre-persistence, both Maps were in-memory and a restart wiped
// the lock; an attacker could replay 10 attempts every restart.

const SESSION_SECRET = "test-secret-please-do-not-use-in-prod-32";
function buildApp(db) {
  return createApp({
    db,
    sessionSecret: SESSION_SECRET,
    cookieSecure: false,
    trustProxyHops: 0,
    staticDir: "/tmp/__nonexistent-static-dir__",
  });
}

describe("rate-limit persistence", () => {
  let db;
  beforeEach(() => { db = new Database(":memory:"); });
  afterEach(() => { db.close(); });

  it("login lock survives a server restart on the same DB", async () => {
    let { app, cleanup } = buildApp(db);
    seedUser(db, "alice", "alice-password-123");
    for (let i = 0; i < 10; i++) {
      const r = await request(app).post("/api/login").send({ username: "alice", password: "wrong" });
      expect(r.status).toBe(401);
    }
    const blocked = await request(app).post("/api/login").send({ username: "alice", password: "wrong" });
    expect(blocked.status).toBe(429);
    cleanup();

    // "Restart" — drop the app, build a fresh one against the same DB.
    ({ app, cleanup } = buildApp(db));
    const stillBlocked = await request(app).post("/api/login").send({ username: "alice", password: "alice-password-123" });
    expect(stillBlocked.status).toBe(429);
    expect(stillBlocked.headers["retry-after"]).toBeTruthy();
    cleanup();
  });

  it("webhook min_interval survives a server restart on the same DB", async () => {
    let { app, cleanup } = buildApp(db);
    seedUser(db, "alice", "alice-password-123");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(/** @type {any} */ ({
      ok: true, status: 200, text: async () => "",
    }));
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "alice", password: "alice-password-123" });
    const ok = await agent.post("/api/chat-post").send({
      url: "https://chat.googleapis.com/v1/spaces/X/messages?key=k&token=t",
      text: "first",
    });
    expect(ok.status).toBe(200);
    cleanup();

    // Restart — same DB; the lastPostAt timestamp should persist and the
    // 5s min interval should still block.
    ({ app, cleanup } = buildApp(db));
    const agent2 = request.agent(app);
    await agent2.post("/api/login").send({ username: "alice", password: "alice-password-123" });
    const blocked = await agent2.post("/api/chat-post").send({
      url: "https://chat.googleapis.com/v1/spaces/X/messages?key=k&token=t",
      text: "second",
    });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe("min_interval");
    fetchSpy.mockRestore();
    cleanup();
  });
});
