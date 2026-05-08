import { Component, useEffect, useState } from "react";
import StatusTracker from "./StatusTracker.jsx";
import Login from "./Login.jsx";

class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    console.error("App crashed:", error, info);
  }
  reset = () => this.setState({ error: null });
  reload = () => { if (typeof window !== "undefined") window.location.reload(); };
  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: "100vh",
            backgroundColor: "#f5f1e8",
            padding: "3rem 1.5rem",
            fontFamily: "ui-monospace, 'JetBrains Mono', monospace",
            color: "#1c1917",
          }}
        >
          <div style={{ maxWidth: 720, margin: "0 auto" }}>
            <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem", color: "#7f1d1d" }}>
              Something broke
            </h1>
            <p style={{ color: "#57534e", marginBottom: "1.25rem", fontSize: "0.875rem" }}>
              The app hit an unexpected error and could not render. Reload to recover.
            </p>
            <pre
              style={{
                background: "#fef2f2",
                border: "1px solid #fecaca",
                padding: "0.75rem 1rem",
                borderRadius: 4,
                overflow: "auto",
                fontSize: "0.75rem",
                color: "#7f1d1d",
                whiteSpace: "pre-wrap",
              }}
            >
              {String(this.state.error?.stack || this.state.error)}
            </pre>
            <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
              <button onClick={this.reload} style={btnPrimary}>Reload page</button>
              <button onClick={this.reset} style={btnSecondary}>Try again</button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function AuthedApp() {
  const [state, setState] = useState({ status: "checking", username: null });

  const refresh = async () => {
    try {
      const res = await fetch("/api/me", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setState({ status: "authed", username: data.username });
      } else {
        setState({ status: "anon", username: null });
      }
    } catch {
      setState({ status: "anon", username: null });
    }
  };

  useEffect(() => {
    refresh();
    const onUnauth = () => setState({ status: "anon", username: null });
    window.addEventListener("tracker:unauthorized", onUnauth);
    return () => window.removeEventListener("tracker:unauthorized", onUnauth);
  }, []);

  const onLogout = async () => {
    try {
      await fetch("/api/logout", { method: "POST", credentials: "include" });
    } catch { /* offline ok */ }
    setState({ status: "anon", username: null });
  };

  if (state.status === "checking") {
    return (
      <div
        style={{
          minHeight: "100vh",
          backgroundColor: "#f5f1e8",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "ui-monospace, 'JetBrains Mono', monospace",
          color: "#78716c",
          fontSize: "0.75rem",
          letterSpacing: "0.2em",
          textTransform: "uppercase",
        }}
      >
        Loading…
      </div>
    );
  }

  if (state.status === "anon") {
    return <Login onLogin={refresh} />;
  }

  return <StatusTracker user={state.username} onLogout={onLogout} />;
}

const btnPrimary = {
  padding: "0.4rem 0.9rem",
  fontSize: "0.75rem",
  fontFamily: "inherit",
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  background: "#1c1917",
  color: "#fafaf9",
  border: "none",
  cursor: "pointer",
};

const btnSecondary = {
  padding: "0.4rem 0.9rem",
  fontSize: "0.75rem",
  fontFamily: "inherit",
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  background: "transparent",
  color: "#1c1917",
  border: "1px solid #1c1917",
  cursor: "pointer",
};

export default function App() {
  return (
    <ErrorBoundary>
      <AuthedApp />
    </ErrorBoundary>
  );
}
