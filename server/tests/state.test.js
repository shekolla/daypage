import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { makeApp, seedUser } from "./_helpers.js";

let app, db, cleanup;
beforeEach(() => {
  ({ app, db, cleanup } = makeApp());
  seedUser(db, "alice", "alice-password-123");
  seedUser(db, "bob",   "bob-password-456");
});
afterEach(() => { cleanup?.(); db.close(); });

async function login(agent, username, password) {
  const r = await agent.post("/api/login").send({ username, password });
  expect(r.status).toBe(200);
}

describe("/api/state", () => {
  it("401 unauthenticated", async () => {
    const res = await request(app).get("/api/state");
    expect(res.status).toBe(401);
  });

  it("returns null state for a freshly-created user", async () => {
    const agent = request.agent(app);
    await login(agent, "alice", "alice-password-123");
    const res = await agent.get("/api/state");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ state: null, updated_at: null });
  });

  it("PUT round-trips a JSON object", async () => {
    const agent = request.agent(app);
    await login(agent, "alice", "alice-password-123");
    const blob = { teams: [{ id: "t1", name: "A", priorities: [] }], activeTeamId: "t1" };
    const put = await agent.put("/api/state").send(blob);
    expect(put.status).toBe(200);
    expect(typeof put.body.updated_at).toBe("number");
    const get = await agent.get("/api/state");
    expect(get.body.state).toEqual(blob);
  });

  it("rejects non-object bodies with 400", async () => {
    const agent = request.agent(app);
    await login(agent, "alice", "alice-password-123");
    const arr = await agent.put("/api/state").send([1, 2, 3]);
    expect(arr.status).toBe(400);
  });

  it("isolates state between two users", async () => {
    const aliceAgent = request.agent(app);
    const bobAgent   = request.agent(app);
    await login(aliceAgent, "alice", "alice-password-123");
    await login(bobAgent,   "bob",   "bob-password-456");

    await aliceAgent.put("/api/state").send({ owner: "alice" });
    await bobAgent.put("/api/state").send({ owner: "bob" });

    const aliceGet = await aliceAgent.get("/api/state");
    const bobGet   = await bobAgent.get("/api/state");
    expect(aliceGet.body.state).toEqual({ owner: "alice" });
    expect(bobGet.body.state).toEqual({ owner: "bob" });
  });
});
