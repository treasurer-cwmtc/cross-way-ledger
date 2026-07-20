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
import LinkReceipts from "./pages/LinkReceipts";
import Rules from "./pages/Rules";
import Accounts from "./pages/Accounts";
import Config from "./pages/Config";
import Donors from "./pages/Donors";
import Users from "./pages/Users";
import Login from "./pages/Login";
import PledgeCampaignStatus from "./pages/PledgeCampaigns/Status";
import PledgeCampaignPledges from "./pages/PledgeCampaigns/Pledges";
import PledgeCampaignActuals from "./pages/PledgeCampaigns/Actuals";
import PledgeCampaignImportWizard from "./pages/PledgeCampaigns/ImportWizard";

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
  | "link-receipts"
  | "config"
  | "users"
  | "pledge-campaign-status"
  | "pledge-campaign-pledges"
  | "pledge-campaign-actuals"
  | "pledge-campaign-import"
  | "donors";

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
    label: "Pledge Campaigns",
    items: [
      { tab: "pledge-campaign-status", label: "Phase 2 Status" },
      { tab: "pledge-campaign-pledges", label: "Phase 2 Pledges" },
      { tab: "pledge-campaign-actuals", label: "Phase 2 Actuals" },
      { tab: "pledge-campaign-import", label: "Import Data" },
    ],
  },
  {
    label: "Setup",
    items: [
      { tab: "rules", label: "Rules" },
      { tab: "accounts", label: "Chart of Accounts" },
      { tab: "link-receipts", label: "Link Receipts" },
      { tab: "donors", label: "Giving App - Donors" },
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
        </div>

        <nav className="sidebar-nav">
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter((item) => {
              if (item.adminOnly) return user.is_admin;
              if (item.tab === "home") return true;
              // Import writes to the same data the Status dashboard reads,
              // so it's gated by that permission rather than its own key.
              if (item.tab === "pledge-campaign-import") {
                return user.is_admin || user.permissions.includes("pledge-campaign-status");
              }
              return user.is_admin || user.permissions.includes(item.tab);
            });
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
          {tab === "link-receipts" && <LinkReceipts />}
          {tab === "config" && <Config />}
          {tab === "donors" && <Donors />}
          {tab === "pledge-campaign-status" && <PledgeCampaignStatus />}
          {tab === "pledge-campaign-pledges" && <PledgeCampaignPledges />}
          {tab === "pledge-campaign-actuals" && <PledgeCampaignActuals />}
          {tab === "pledge-campaign-import" && <PledgeCampaignImportWizard />}
          {tab === "users" && user.is_admin && <Users currentUserId={user.id} />}
        </div>
      </main>
    </div>
  );
}
