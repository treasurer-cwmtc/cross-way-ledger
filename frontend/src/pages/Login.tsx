import { useState } from "react";
import { authApi } from "../api/auth";

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await authApi.login(username, password);
      onSuccess();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app" style={{ maxWidth: 380 }}>
      <h1>Bank / Stripe Reconciliation</h1>
      <p className="subtitle">Sign in to continue.</p>
      <form className="card" onSubmit={submit}>
        <label className="field">
          <span>Username</span>
          <input
            type="text"
            value={username}
            autoFocus
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button className="btn" type="submit" disabled={!username || !password || busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        {error && <div className="error">{error}</div>}
      </form>
    </div>
  );
}
