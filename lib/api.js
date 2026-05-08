// Storage shim + chat-post forwarder. Browser-side only — these touch
// fetch/localStorage/window. Kept out of status_tracker.jsx to slim the
// monolith.
//
// Storage order of preference:
//   1. /api/state       — authoritative shared store (SQLite on the server)
//   2. window.storage   — Claude artifacts API (only present inside artifacts)
//   3. localStorage     — offline cache + standalone fallback
//
// API + localStorage stay in sync: every successful API write mirrors into
// localStorage so the page keeps working if the server goes away.

const API_STATE_URL = "/api/state";

function notifyUnauthorized() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("tracker:unauthorized"));
  }
}

async function apiGet() {
  const res = await fetch(API_STATE_URL, {
    headers: { Accept: "application/json" },
    credentials: "include",
  });
  if (res.status === 401) {
    notifyUnauthorized();
    throw new Error("unauthorized");
  }
  if (!res.ok) throw new Error(`GET ${API_STATE_URL} → ${res.status}`);
  const body = await res.json();
  return body.state ?? null;
}

async function apiPut(stateObj) {
  const res = await fetch(API_STATE_URL, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(stateObj),
  });
  if (res.status === 401) {
    notifyUnauthorized();
    throw new Error("unauthorized");
  }
  if (!res.ok) throw new Error(`PUT ${API_STATE_URL} → ${res.status}`);
  return res.json();
}

export const storage = {
  async get(k) {
    if (typeof window !== "undefined" && window.storage) return window.storage.get(k);
    try {
      const state = await apiGet();
      if (state !== null) {
        if (typeof window !== "undefined") localStorage.setItem(k, JSON.stringify(state));
        return { value: JSON.stringify(state) };
      }
    } catch (err) {
      if (err?.message !== "unauthorized") {
        console.warn("API GET failed, falling back to local cache:", err);
      } else {
        throw err;
      }
    }
    return { value: typeof window !== "undefined" ? localStorage.getItem(k) : null };
  },
  async set(k, v) {
    if (typeof window !== "undefined" && window.storage) return window.storage.set(k, v);
    if (typeof window !== "undefined") localStorage.setItem(k, v);
    try {
      const obj = typeof v === "string" ? JSON.parse(v) : v;
      await apiPut(obj);
    } catch (err) {
      if (err?.message === "unauthorized") throw err;
      console.warn("API PUT failed, kept change in local cache only:", err);
    }
  },
};

// Posts go through the server-side proxy (/api/chat-post) — never directly to
// chat.googleapis.com. The proxy enforces a per-user rate limit (5s min
// interval, 5/min burst, 100/day), so any client regression that tries to
// spam Chat is contained at the chokepoint instead of reaching the user.
export async function postToChat(webhookUrl, text) {
  if (!webhookUrl) throw new Error("Webhook URL not set");
  const res = await fetch("/api/chat-post", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ url: webhookUrl, text }),
  });
  if (res.status === 401) {
    notifyUnauthorized();
    throw new Error("unauthorized");
  }
  if (res.status === 429) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(`rate-limited (${data.error || "too many"})`);
    err.retryIn = data.retryIn;
    throw err;
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`Chat post failed: ${data.error || res.status}`);
  }
  return res.json();
}
