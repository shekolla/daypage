import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { makeApp, seedUser } from "./_helpers.js";

let app, db, cleanup, fetchSpy;
beforeEach(() => {
  ({ app, db, cleanup } = makeApp());
  seedUser(db, "alice", "alice-password-123");
  fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(/** @type {any} */ ({
    ok: true,
    status: 200,
    text: async () => "",
  }));
});
afterEach(() => {
  fetchSpy.mockRestore();
  cleanup?.();
  db.close();
});

async function login(agent) {
  await agent.post("/api/login").send({ username: "alice", password: "alice-password-123" });
}

describe("/api/chat-post", () => {
  it("401 without a session", async () => {
    const r = await request(app).post("/api/chat-post").send({
      url: "https://chat.googleapis.com/v1/spaces/X/messages?key=k&token=t",
      text: "hello",
    });
    expect(r.status).toBe(401);
  });

  it("400 when the URL is not on the allowlist", async () => {
    const agent = request.agent(app);
    await login(agent);
    const r = await agent.post("/api/chat-post").send({
      url: "https://evil.example.com/post",
      text: "hello",
    });
    expect(r.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("400 when text is empty or oversized", async () => {
    const agent = request.agent(app);
    await login(agent);
    const empty = await agent.post("/api/chat-post").send({
      url: "https://chat.googleapis.com/v1/spaces/X/messages?key=k&token=t",
      text: "",
    });
    expect(empty.status).toBe(400);
    const huge = await agent.post("/api/chat-post").send({
      url: "https://chat.googleapis.com/v1/spaces/X/messages?key=k&token=t",
      text: "a".repeat(4001),
    });
    expect(huge.status).toBe(400);
  });

  it("forwards a valid request to upstream and returns 200", async () => {
    const agent = request.agent(app);
    await login(agent);
    const r = await agent.post("/api/chat-post").send({
      url: "https://chat.googleapis.com/v1/spaces/X/messages?key=k&token=t",
      text: "hello",
    });
    expect(r.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOpts] = fetchSpy.mock.calls[0];
    expect(calledUrl).toContain("chat.googleapis.com");
    expect(calledOpts.method).toBe("POST");
    expect(JSON.parse(calledOpts.body)).toEqual({ text: "hello" });
  });

  it("returns 502 when upstream fails", async () => {
    fetchSpy.mockResolvedValue(/** @type {any} */ ({
      ok: false,
      status: 503,
      text: async () => "service unavailable",
    }));
    const agent = request.agent(app);
    await login(agent);
    const r = await agent.post("/api/chat-post").send({
      url: "https://chat.googleapis.com/v1/spaces/X/messages?key=k&token=t",
      text: "hello",
    });
    expect(r.status).toBe(502);
  });

  it("rate-limits a second post within 5 seconds (min interval)", async () => {
    const agent = request.agent(app);
    await login(agent);
    const first = await agent.post("/api/chat-post").send({
      url: "https://chat.googleapis.com/v1/spaces/X/messages?key=k&token=t",
      text: "first",
    });
    expect(first.status).toBe(200);
    const second = await agent.post("/api/chat-post").send({
      url: "https://chat.googleapis.com/v1/spaces/X/messages?key=k&token=t",
      text: "second",
    });
    expect(second.status).toBe(429);
    expect(second.body.error).toBe("min_interval");
    expect(second.headers["retry-after"]).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledTimes(1); // proxy did NOT forward the second
  });
});
