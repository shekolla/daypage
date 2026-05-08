import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { makeApp } from "./_helpers.js";

let app, db, cleanup;
beforeEach(() => { ({ app, db, cleanup } = makeApp()); });
afterEach(() => { cleanup?.(); db.close(); });

describe("/health", () => {
  it("returns 200 + 'ok' without auth", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.text).toBe("ok\n");
    expect(res.headers["content-type"]).toMatch(/text\/plain/);
  });
});

describe("/api/* fallthrough", () => {
  it("returns JSON 404 for unmatched API paths (not the SPA HTML)", async () => {
    const res = await request(app).get("/api/this-does-not-exist");
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.body).toEqual({ error: "not found" });
  });
});
