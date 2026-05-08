import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { makeApp, seedUser } from "./_helpers.js";

let app, db, cleanup;
beforeEach(() => {
  ({ app, db, cleanup } = makeApp());
  seedUser(db, "alice", "alice-password-123");
});
afterEach(() => { cleanup?.(); db.close(); });

describe("/api/login", () => {
  it("returns 200 + sets cookie on valid credentials", async () => {
    const res = await request(app)
      .post("/api/login")
      .send({ username: "alice", password: "alice-password-123" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, username: "alice" });
    const setCookie = res.headers["set-cookie"]?.join("\n") || "";
    expect(setCookie).toMatch(/tracker\.session=/i);
  });

  it("returns 401 on wrong password", async () => {
    const res = await request(app)
      .post("/api/login")
      .send({ username: "alice", password: "wrong" });
    expect(res.status).toBe(401);
  });

  it("returns 401 on unknown user (constant-time bcrypt against dummy hash)", async () => {
    const res = await request(app)
      .post("/api/login")
      .send({ username: "ghost", password: "anything" });
    expect(res.status).toBe(401);
  });

  it("returns 400 when username/password missing", async () => {
    const res = await request(app).post("/api/login").send({});
    expect(res.status).toBe(400);
  });

  it("rate-limits after 10 attempts in the window", async () => {
    for (let i = 0; i < 10; i++) {
      const r = await request(app)
        .post("/api/login")
        .send({ username: "alice", password: "wrong" });
      expect(r.status).toBe(401);
    }
    const blocked = await request(app)
      .post("/api/login")
      .send({ username: "alice", password: "wrong" });
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeTruthy();
  });

  it("clears the rate-limit counter on successful login", async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post("/api/login").send({ username: "alice", password: "wrong" });
    }
    const ok = await request(app)
      .post("/api/login")
      .send({ username: "alice", password: "alice-password-123" });
    expect(ok.status).toBe(200);
    // still able to fail twice + succeed without 429 because counter was cleared
    for (let i = 0; i < 9; i++) {
      const r = await request(app).post("/api/login").send({ username: "alice", password: "wrong" });
      expect(r.status).toBe(401);
    }
  });
});

describe("/api/me", () => {
  it("401 when no session cookie", async () => {
    const res = await request(app).get("/api/me");
    expect(res.status).toBe(401);
  });

  it("200 with cookie after login", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "alice", password: "alice-password-123" });
    const me = await agent.get("/api/me");
    expect(me.status).toBe(200);
    expect(me.body.username).toBe("alice");
  });
});

describe("/api/logout", () => {
  it("clears the session", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "alice", password: "alice-password-123" });
    const before = await agent.get("/api/me");
    expect(before.status).toBe(200);
    await agent.post("/api/logout");
    const after = await agent.get("/api/me");
    expect(after.status).toBe(401);
  });
});
