import express from "express";
import Database from "better-sqlite3";
import cookieSession from "cookie-session";
import bcrypt from "bcryptjs";
import compression from "compression";
import { fileURLToPath } from "node:url";
import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import { runDueNotificationScan, pruneStaleDueNotifications } from "./notify.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_PORT = parseInt(process.env.PORT || "3000", 10);
const DEFAULT_DB_PATH = process.env.DB_PATH || "/data/tracker.db";
const DEFAULT_STATIC_DIR = process.env.STATIC_DIR || path.resolve(__dirname, "../dist");
const DEFAULT_COOKIE_SECURE =
  process.env.COOKIE_SECURE !== undefined
    ? process.env.COOKIE_SECURE === "true"
    : process.env.NODE_ENV === "production";
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const WEBHOOK_MIN_INTERVAL_MS = 5_000;
const WEBHOOK_BURST_WINDOW_MS = 60_000;
const WEBHOOK_BURST_MAX = 5;
const WEBHOOK_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
const WEBHOOK_DAILY_MAX = 100;
const WEBHOOK_UPSTREAM_TIMEOUT_MS = 10_000;
const WEBHOOK_URL_ALLOWLIST = /^https:\/\/chat\.googleapis\.com\//;

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) {
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Build a fresh Express app instance + the helpers that need to live with it
 * (login + webhook rate-limit Maps, prepared statements). Tests pass an
 * in-memory SQLite via `db`. Production calls `createApp()` with no args
 * and gets the on-disk DB.
 *
 * @param {object} [opts]
 * @param {Database.Database} [opts.db] open SQLite handle (a fresh `:memory:` DB for tests)
 * @param {string} [opts.sessionSecret] override session signing key
 * @param {string} [opts.staticDir] absolute path to the built frontend
 * @param {boolean} [opts.cookieSecure]
 * @param {number} [opts.trustProxyHops]
 * @param {{user:string,pass:string}} [opts.bootstrapAdmin]
 * @param {boolean} [opts.noNotifyCron] disable the per-minute due-notification scheduler (used by tests)
 */
export function createApp(opts = {}) {
  const db =
    opts.db ||
    (() => {
      fs.mkdirSync(path.dirname(DEFAULT_DB_PATH), { recursive: true });
      const handle = new Database(DEFAULT_DB_PATH);
      return handle;
    })();
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");

  db.prepare(
    `CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS user_state (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS rate_limit (
      scope TEXT NOT NULL,
      key TEXT NOT NULL,
      json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (scope, key)
    )`
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS due_notifications (
      user_id INTEGER NOT NULL,
      row_id TEXT NOT NULL,
      due_at TEXT NOT NULL,
      first_sent_at TEXT NOT NULL,
      last_sent_at TEXT NOT NULL,
      PRIMARY KEY (user_id, row_id, due_at),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`
  ).run();
  const rateGetStmt = db.prepare("SELECT json FROM rate_limit WHERE scope = ? AND key = ?");
  const rateSetStmt = db.prepare(
    "INSERT INTO rate_limit (scope, key, json, updated_at) VALUES (?, ?, ?, ?) " +
    "ON CONFLICT(scope, key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at"
  );
  const rateDelStmt = db.prepare("DELETE FROM rate_limit WHERE scope = ? AND key = ?");
  const rateCleanupStmt = db.prepare("DELETE FROM rate_limit WHERE scope = ? AND updated_at < ?");
  function rateGet(scope, key) {
    const row = rateGetStmt.get(scope, String(key));
    if (!row) return null;
    try { return JSON.parse(row.json); } catch { return null; }
  }
  function rateSet(scope, key, rec) {
    rateSetStmt.run(scope, String(key), JSON.stringify(rec), Date.now());
  }
  function rateDel(scope, key) {
    rateDelStmt.run(scope, String(key));
  }

  function getOrCreateSessionSecret() {
    if (opts.sessionSecret) return opts.sessionSecret;
    if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) {
      return process.env.SESSION_SECRET;
    }
    const row = db.prepare("SELECT value FROM kv WHERE key = 'session_secret'").get();
    if (row?.value) return row.value;
    const fresh = crypto.randomBytes(32).toString("hex");
    db.prepare("INSERT INTO kv (key, value) VALUES ('session_secret', ?)").run(fresh);
    return fresh;
  }
  const SESSION_SECRET = getOrCreateSessionSecret();

  const bootstrap = opts.bootstrapAdmin || {
    user: process.env.BOOTSTRAP_ADMIN_USER || "",
    pass: process.env.BOOTSTRAP_ADMIN_PASS || "",
  };
  (function bootstrapAdminIfNoUsers() {
    const count = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
    if (count > 0) return;
    if (!bootstrap.user || !bootstrap.pass) return;
    if (bootstrap.pass === "changeme" || bootstrap.pass.length < 12) {
      console.warn(
        "[security] bootstrap password is short or default. Rotate ASAP via:\n" +
        "  docker compose exec -it tracker node scripts/users.js passwd " + bootstrap.user
      );
    }
    const hash = bcrypt.hashSync(bootstrap.pass, 12);
    db.prepare(
      "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)"
    ).run(bootstrap.user, hash, Date.now());
    console.log(`[users] bootstrapped admin user: ${bootstrap.user}`);
  })();

  const findUserByName = db.prepare(
    "SELECT id, username, password_hash FROM users WHERE username = ?"
  );
  const findUserById = db.prepare("SELECT id, username FROM users WHERE id = ?");
  const getUserStateStmt = db.prepare(
    "SELECT json, updated_at FROM user_state WHERE user_id = ?"
  );
  const upsertUserStateStmt = db.prepare(
    `INSERT INTO user_state (user_id, json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`
  );

  const cookieSecure = opts.cookieSecure ?? DEFAULT_COOKIE_SECURE;
  const trustProxyHops = opts.trustProxyHops ?? Math.max(0, parseInt(process.env.TRUST_PROXY_HOPS || "0", 10) || 0);

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", trustProxyHops);

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "no-referrer-when-downgrade");
    res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
    next();
  });
  app.use(compression());
  app.use(express.json({ limit: "10mb" }));

  // ---- per-IP login rate limit (sliding window, persisted in SQLite) ----
  function clientIp(req) {
    if (trustProxyHops > 0) return req.ip || "unknown";
    return req.socket?.remoteAddress || "unknown";
  }
  function loginRateLimit(req, res, next) {
    const ip = clientIp(req);
    const now = Date.now();
    let rec = rateGet("login", ip);
    if (!rec) rec = { count: 0, firstAt: now, lockUntil: 0 };
    if (rec.lockUntil > now) {
      const retryIn = Math.ceil((rec.lockUntil - now) / 1000);
      res.setHeader("Retry-After", String(retryIn));
      return res.status(429).json({ error: `too many attempts, retry in ${retryIn}s` });
    }
    if (now - rec.firstAt > LOGIN_WINDOW_MS) {
      rec.count = 0;
      rec.firstAt = now;
    }
    rec.count += 1;
    if (rec.count > LOGIN_MAX_ATTEMPTS) {
      rec.lockUntil = now + LOGIN_WINDOW_MS;
      rateSet("login", ip, rec);
      res.setHeader("Retry-After", String(Math.ceil(LOGIN_WINDOW_MS / 1000)));
      return res.status(429).json({ error: "too many attempts, locked for 15 min" });
    }
    rateSet("login", ip, rec);
    res.locals.clearRateLimit = () => rateDel("login", ip);
    next();
  }
  const loginAttemptsCleaner = setInterval(() => {
    rateCleanupStmt.run("login", Date.now() - LOGIN_WINDOW_MS * 2);
  }, 5 * 60 * 1000);
  loginAttemptsCleaner.unref();

  // ---- per-user webhook-post rate limit (persisted in SQLite) ----
  function checkWebhookRate(userId, now = Date.now()) {
    let rec = rateGet("webhook", userId);
    if (!rec) rec = { burstCount: 0, burstAt: now, dailyCount: 0, dailyAt: now, lastPostAt: 0 };
    if (now - rec.lastPostAt < WEBHOOK_MIN_INTERVAL_MS) {
      return { ok: false, error: "min_interval", retryIn: Math.ceil((WEBHOOK_MIN_INTERVAL_MS - (now - rec.lastPostAt)) / 1000) };
    }
    if (now - rec.burstAt > WEBHOOK_BURST_WINDOW_MS) {
      rec.burstCount = 0;
      rec.burstAt = now;
    }
    if (now - rec.dailyAt > WEBHOOK_DAILY_WINDOW_MS) {
      rec.dailyCount = 0;
      rec.dailyAt = now;
    }
    if (rec.burstCount >= WEBHOOK_BURST_MAX) {
      return { ok: false, error: "burst_limit", retryIn: Math.ceil((WEBHOOK_BURST_WINDOW_MS - (now - rec.burstAt)) / 1000) };
    }
    if (rec.dailyCount >= WEBHOOK_DAILY_MAX) {
      return { ok: false, error: "daily_limit", retryIn: Math.ceil((WEBHOOK_DAILY_WINDOW_MS - (now - rec.dailyAt)) / 1000) };
    }
    rec.burstCount += 1;
    rec.dailyCount += 1;
    rec.lastPostAt = now;
    rateSet("webhook", userId, rec);
    return { ok: true };
  }
  const webhookCleaner = setInterval(() => {
    rateCleanupStmt.run("webhook", Date.now() - WEBHOOK_DAILY_WINDOW_MS * 2);
  }, 60 * 60 * 1000);
  webhookCleaner.unref();

  // ---- session ----
  app.use(
    cookieSession({
      name: "tracker.session",
      keys: [SESSION_SECRET],
      maxAge: SESSION_MAX_AGE_MS,
      httpOnly: true,
      sameSite: "lax",
      secure: cookieSecure,
    })
  );

  function requireSession(req, res, next) {
    if (!req.session?.userId) return res.status(401).json({ error: "auth required" });
    req.session.touchedAt = Date.now();
    next();
  }

  // ---- auth endpoints ----
  app.post("/api/login", loginRateLimit, async (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
      return res.status(400).json({ error: "username and password required" });
    }
    const user = findUserByName.get(username);
    const dummyHash = "$2a$12$0123456789012345678901uHXz0g7XqyOJpXJ.Gqqg9nOe8sLk3lG";
    const ok = await bcrypt.compare(password, user?.password_hash || dummyHash);
    if (!user || !ok) {
      return res.status(401).json({ error: "invalid credentials" });
    }
    res.locals.clearRateLimit?.();
    req.session.userId = user.id;
    req.session.username = user.username;
    res.json({ ok: true, username: user.username });
  });

  app.post("/api/logout", (req, res) => {
    req.session = null;
    res.json({ ok: true });
  });

  app.get("/api/me", (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ error: "not logged in" });
    const user = findUserById.get(req.session.userId);
    if (!user) {
      req.session = null;
      return res.status(401).json({ error: "session user no longer exists" });
    }
    res.json({ username: user.username });
  });

  // ---- per-user state ----
  app.get("/api/state", requireSession, (req, res) => {
    const row = getUserStateStmt.get(req.session.userId);
    if (!row) return res.json({ state: null, updated_at: null });
    try {
      res.json({ state: JSON.parse(row.json), updated_at: row.updated_at });
    } catch {
      res.status(500).json({ error: "stored state is corrupted" });
    }
  });

  app.put("/api/state", requireSession, (req, res) => {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({ error: "JSON object body required" });
    }
    const json = JSON.stringify(req.body);
    const ts = Date.now();
    upsertUserStateStmt.run(req.session.userId, json, ts);
    res.json({ ok: true, updated_at: ts });
  });

  // ---- chat-post helper (shared with notify cron) ----
  // Validates URL + text + rate limit, then forwards to chat.googleapis.com.
  // Returns { ok: true } or { ok: false, status, error, retryIn?, detail? }
  // — never throws so callers (HTTP route + cron) handle non-ok uniformly.
  async function forwardToChatPost({ userId, username, url, text, now = Date.now() }) {
    if (typeof url !== "string" || !WEBHOOK_URL_ALLOWLIST.test(url)) {
      return { ok: false, status: 400, error: "url must be https://chat.googleapis.com/..." };
    }
    if (typeof text !== "string" || text.length === 0 || text.length > 4000) {
      return { ok: false, status: 400, error: "text must be 1-4000 characters" };
    }
    const rate = checkWebhookRate(userId, now);
    if (!rate.ok) {
      console.warn(`[webhook-rate] user=${username} blocked: ${rate.error} (retry ${rate.retryIn}s)`);
      return { ok: false, status: 429, error: rate.error, retryIn: rate.retryIn };
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), WEBHOOK_UPSTREAM_TIMEOUT_MS);
    try {
      const upstream = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify({ text }),
        signal: ac.signal,
      });
      clearTimeout(timer);
      console.log(`[webhook] user=${username} → chat (${text.length} chars) ${upstream.status}`);
      if (!upstream.ok) {
        const body = await upstream.text().catch(() => "");
        return { ok: false, status: 502, error: `chat returned ${upstream.status}`, detail: body.slice(0, 200) };
      }
      return { ok: true };
    } catch (e) {
      clearTimeout(timer);
      console.error(`[webhook] user=${username} forward failed: ${e?.name || ""} ${e?.message || e}`);
      return { ok: false, status: 502, error: "forward failed" };
    }
  }

  // ---- chat-post proxy ----
  app.post("/api/chat-post", requireSession, async (req, res) => {
    const { url, text } = req.body || {};
    const result = await forwardToChatPost({
      userId: req.session.userId,
      username: req.session.username,
      url,
      text,
    });
    if (!result.ok) {
      if (result.retryIn) res.setHeader("Retry-After", String(result.retryIn));
      const payload = { error: result.error };
      if (result.retryIn != null) payload.retryIn = result.retryIn;
      if (result.detail) payload.detail = result.detail;
      return res.status(result.status).json(payload);
    }
    res.json({ ok: true });
  });

  // ---- health (no auth) ----
  app.get("/health", (req, res) => {
    res.type("text/plain").send("ok\n");
  });

  // any other /api/* path is a real 404 — never fall through to the SPA shell
  app.use("/api", (req, res) => {
    res.status(404).json({ error: "not found" });
  });

  // ---- static + SPA fallback ----
  const cspValue = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  const staticDir = opts.staticDir ?? DEFAULT_STATIC_DIR;
  app.use(
    express.static(staticDir, {
      setHeaders: (res, filepath) => {
        if (filepath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else {
          res.setHeader("Cache-Control", "no-cache");
          res.setHeader("Content-Security-Policy", cspValue);
        }
      },
    })
  );

  // SPA fallback. Express 5 uses path-to-regexp v8, which rejects bare "*".
  // A trailing app.use without a path matches every method/path the static
  // middleware didn't already handle — same effect, no wildcard string.
  app.use((req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Content-Security-Policy", cspValue);
    res.sendFile(path.join(staticDir, "index.html"));
  });

  app.use((err, req, res, next) => {
    console.error("unhandled error:", err);
    res.status(500).type("text/plain").send("internal server error\n");
  });

  // ---- due-date notification cron (server-side) ----
  // Tick every minute: walk every user's state, find rows that are
  // overdue + still open, and send Chat pings via the active webhook.
  // Persists dedupe in due_notifications so server restarts don't double
  // the first ping. `noNotifyCron: true` (test option) skips the timer.
  const NOTIFY_TICK_MS = 60_000;
  let dueNotifyInterval = null;
  let dueNotifyPruner = null;
  if (!opts.noNotifyCron) {
    dueNotifyInterval = setInterval(() => {
      runDueNotificationScan({ db, forwardToChatPost, now: new Date() })
        .catch(err => console.error("[notify-cron] scan failed:", err?.message || err));
    }, NOTIFY_TICK_MS);
    dueNotifyInterval.unref();
    dueNotifyPruner = setInterval(() => {
      try { pruneStaleDueNotifications(db, 90); }
      catch (err) { console.error("[notify-cron] prune failed:", err?.message || err); }
    }, 60 * 60 * 1000);
    dueNotifyPruner.unref();
  }

  return {
    app,
    db,
    runDueNotificationScan: (now = new Date()) => runDueNotificationScan({
      db,
      forwardToChatPost: (args) => forwardToChatPost({ ...args, now: now.getTime() }),
      now,
    }),
    cleanup() {
      clearInterval(loginAttemptsCleaner);
      clearInterval(webhookCleaner);
      if (dueNotifyInterval) clearInterval(dueNotifyInterval);
      if (dueNotifyPruner) clearInterval(dueNotifyPruner);
    },
  };
}

// Auto-start when invoked directly (production entry).
if (process.env.NODE_ENV !== "test") {
  const { app, db } = createApp();
  const server = app.listen(DEFAULT_PORT, "0.0.0.0", () => {
    const userCount = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
    console.log(`Status Tracker listening on :${DEFAULT_PORT}`);
    console.log(`SQLite DB: ${DEFAULT_DB_PATH}`);
    console.log(`Static dir: ${DEFAULT_STATIC_DIR}`);
    console.log(`Users in DB: ${userCount}`);
    console.log(`Cookie secure flag: ${DEFAULT_COOKIE_SECURE}`);
  });

  function shutdown(signal) {
    console.log(`received ${signal}, shutting down`);
    server.close(() => {
      db.close();
      process.exit(0);
    });
  }
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
