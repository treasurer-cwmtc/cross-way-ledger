import { useEffect, useRef, useState } from "react";
import { authApi } from "../api/auth";
import { renderGoogleSignInButton } from "../lib/googleIdentity";
import logo from "../assets/cross-way-logo-white.png";

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const googleButtonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!googleButtonRef.current) return;
    renderGoogleSignInButton(googleButtonRef.current, async (idToken) => {
      setError("");
      setBusy(true);
      try {
        await authApi.googleLogin(idToken);
        onSuccess();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        background: "var(--sidebar-bg)",
        padding: 24,
      }}
    >
      <img src={logo} alt="Cross Way Mar Thoma Church" style={{ width: 220, maxWidth: "80vw" }} />
      <div style={{ width: "100%", maxWidth: 360 }}>
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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            margin: "16px 0",
            color: "var(--sidebar-text-dim)",
            fontSize: 12,
          }}
        >
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.12)" }} />
          or
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.12)" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <div ref={googleButtonRef} />
        </div>
      </div>
    </div>
  );
}
