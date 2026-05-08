import { useState, useEffect } from "react";

export default function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const link = document.createElement("link");
    link.href =
      "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=JetBrains+Mono:wght@400;500;600&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `login failed (${res.status})`);
        return;
      }
      onLogin();
    } catch (err) {
      setError(err.message || "network error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#f5f1e8",
        backgroundImage:
          "radial-gradient(circle at 1px 1px, rgba(60,40,20,0.06) 1px, transparent 0)",
        backgroundSize: "24px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        color: "#1c1917",
      }}
    >
      <form
        onSubmit={submit}
        style={{
          background: "rgba(255,255,255,0.7)",
          padding: "2rem 2rem 1.75rem",
          border: "1px solid #d6d3d1",
          maxWidth: 400,
          width: "100%",
          boxShadow: "0 1px 0 rgba(0,0,0,0.04)",
        }}
      >
        <h1
          style={{
            fontFamily: "'Fraunces', serif",
            fontSize: "1.875rem",
            lineHeight: 1.1,
            marginBottom: "0.25rem",
            color: "#1c1917",
          }}
        >
          Status Tracker
        </h1>
        <p
          style={{
            fontSize: "0.7rem",
            color: "#78716c",
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            marginBottom: "1.75rem",
          }}
        >
          Sign in
        </p>

        <label htmlFor="login-username" style={labelStyle}>Username</label>
        <input
          id="login-username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoFocus
          required
          disabled={busy}
          style={inputStyle}
        />

        <label htmlFor="login-password" style={labelStyle}>Password</label>
        <input
          id="login-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          disabled={busy}
          style={inputStyle}
        />

        {error && (
          <div
            role="alert"
            style={{
              color: "#7f1d1d",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              padding: "0.5rem 0.75rem",
              fontSize: "0.8rem",
              marginBottom: "0.75rem",
            }}
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !username || !password}
          style={{
            width: "100%",
            padding: "0.6rem",
            background: busy ? "#57534e" : "#1c1917",
            color: "white",
            border: "none",
            textTransform: "uppercase",
            letterSpacing: "0.15em",
            fontSize: "0.75rem",
            fontFamily: "inherit",
            cursor: busy ? "wait" : "pointer",
          }}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <p style={{ fontSize: "0.7rem", color: "#a8a29e", marginTop: "1rem" }}>
          Need an account? Ask your admin to run{" "}
          <code style={{ background: "#f5f5f4", padding: "1px 4px" }}>users.js create</code>.
        </p>
      </form>
    </div>
  );
}

const labelStyle = {
  display: "block",
  fontSize: "0.65rem",
  textTransform: "uppercase",
  letterSpacing: "0.15em",
  color: "#57534e",
  marginBottom: "0.25rem",
};

const inputStyle = {
  width: "100%",
  padding: "0.5rem 0.6rem",
  border: "1px solid #a8a29e",
  marginBottom: "1rem",
  fontFamily: "inherit",
  fontSize: "0.875rem",
  background: "white",
  outline: "none",
  boxSizing: "border-box",
};
