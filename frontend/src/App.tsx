import { useEffect, useState } from "react";
import { auth, AuthError } from "./api/client";
import { authApi, User } from "./api/auth";
import logo from "./assets/cross-way-logo-white.png";
import Home from "./pages/Home";
import Upload from "./pages/Upload";
import Reconciliation from "./pages/Reconciliation";
import Accrual from "./pages/Accrual";
import Budget from "./pages/Budget";
import GeneralLedger from "./pages/GeneralLedger";
import IncomeStatement from "./pages/IncomeStatement";
import Rules from "./pages/Rules";
import Accounts from "./pages/Accounts";
import Config from "./pages/Config";
import Users from "./pages/Users";
import Login from "./pages/Login";

type Tab =
  | "home"
  | "upload"
  | "reconciliation"
  | "accrual"
  | "budget"
  | "general-ledger"
  | "income-statement"
  | "rules"
  | "accounts"
  | "config"
  | "users";

interface NavItem {
  tab: Tab;
  label: string;
  adminOnly?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  { label: "Overview", items: [{ tab: "home", label: "Home" }] },
  {
    label: "Ledgers",
    items: [
      { tab: "upload", label: "Upload" },
      { tab: "reconciliation", label: "Actual" },
      { tab: "accrual", label: "Accrual" },
      { tab: "budget", label: "Budget" },
    ],
  },
  {
    label: "Reporting",
    items: [
      { tab: "general-ledger", label: "General Ledger" },
      { tab: "income-statement", label: "Income Statement" },
    ],
  },
  {
    label: "Setup",
    items: [
      { tab: "rules", label: "Rules" },
      { tab: "accounts", label: "Chart of Accounts" },
      { tab: "config", label: "Config" },
      { tab: "users", label: "Users", adminOnly: true },
    ],
  },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("home");
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
    setTab("home");
  }

  if (loading) return <div className="app-shell">Loading…</div>;
  if (!user) return <Login onSuccess={loadMe} />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img src={logo} alt="Cross Way Mar Thoma Church" />
          <p>Treasurer — bank/Stripe reconciliation and church finance tracking.</p>
        </div>

        <nav className="sidebar-nav">
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter((item) => !item.adminOnly || user.is_admin);
            if (items.length === 0) return null;
            return (
              <div key={group.label} style={{ marginBottom: 14 }}>
                <div
                  style={{
                    fontSize: 10.5,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--sidebar-text-dim)",
                    padding: "6px 13px 4px",
                  }}
                >
                  {group.label}
                </div>
                {items.map((item) => (
                  <button
                    key={item.tab}
                    className={tab === item.tab ? "active" : ""}
                    onClick={() => setTab(item.tab)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div>
            Signed in as <b>{user.username}</b>
            {user.is_admin ? " (admin)" : ""}
          </div>
          <button className="link" onClick={logout}>
            Log out
          </button>
        </div>
      </aside>

      <main className="app-main">
        <div className="app-content">
          {tab === "home" && <Home />}
          {tab === "upload" && <Upload />}
          {tab === "reconciliation" && <Reconciliation />}
          {tab === "accrual" && <Accrual />}
          {tab === "budget" && <Budget />}
          {tab === "general-ledger" && <GeneralLedger />}
          {tab === "income-statement" && <IncomeStatement />}
          {tab === "rules" && <Rules />}
          {tab === "accounts" && <Accounts />}
          {tab === "config" && <Config />}
          {tab === "users" && user.is_admin && <Users currentUserId={user.id} />}
        </div>
      </main>
    </div>
  );
}
