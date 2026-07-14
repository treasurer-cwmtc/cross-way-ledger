import { useEffect, useState } from "react";
import { auth, AuthError } from "./api/client";
import { authApi, User } from "./api/auth";
import Reconcile from "./pages/Reconcile";
import Rules from "./pages/Rules";
import Accounts from "./pages/Accounts";
import Users from "./pages/Users";
import Login from "./pages/Login";

type Tab = "reconcile" | "rules" | "accounts" | "users";

export default function App() {
  const [tab, setTab] = useState<Tab>("reconcile");
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadMe() {
    if (!auth.token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      setUser(await authApi.me());
    } catch (e) {
      if (e instanceof AuthError) auth.clear();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMe();
  }, []);

  function logout() {
    auth.clear();
    setUser(null);
    setTab("reconcile");
  }

  if (loading) return <div className="app">Loading…</div>;
  if (!user) return <Login onSuccess={loadMe} />;

  return (
    <div className="app">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div>
          <h1>Bank / Stripe Reconciliation</h1>
          <p className="subtitle">
            Upload your Chase and Stripe CSV exports to break Stripe payouts into
            per-donation lines and auto-categorize bank transactions.
          </p>
        </div>
        <div style={{ textAlign: "right", fontSize: 13, color: "var(--muted)" }}>
          <div>
            Signed in as <b>{user.username}</b>
            {user.is_admin ? " (admin)" : ""}
          </div>
          <button
            className="link"
            style={{ color: "var(--primary)" }}
            onClick={logout}
          >
            Log out
          </button>
        </div>
      </div>

      <nav className="tabs">
        <button
          className={tab === "reconcile" ? "active" : ""}
          onClick={() => setTab("reconcile")}
        >
          Reconcile
        </button>
        <button
          className={tab === "rules" ? "active" : ""}
          onClick={() => setTab("rules")}
        >
          Rules
        </button>
        <button
          className={tab === "accounts" ? "active" : ""}
          onClick={() => setTab("accounts")}
        >
          Chart of Accounts
        </button>
        {user.is_admin && (
          <button
            className={tab === "users" ? "active" : ""}
            onClick={() => setTab("users")}
          >
            Users
          </button>
        )}
      </nav>

      {tab === "reconcile" && <Reconcile />}
      {tab === "rules" && <Rules />}
      {tab === "accounts" && <Accounts />}
      {tab === "users" && user.is_admin && <Users currentUserId={user.id} />}
    </div>
  );
}
