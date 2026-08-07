import { useEffect, useState } from "react";
import { auth, AuthError } from "./api/client";
import { authApi, User } from "./api/auth";
import logo from "./assets/cross-way-logo-white.png";
import Home from "./pages/Home";
import Upload from "./pages/Upload";
import Reconcile from "./pages/Reconcile";
import StripePage from "./pages/Stripe";
import BankTransactions from "./pages/BankTransactions";
import Reconciliation from "./pages/Reconciliation";
import Accrual from "./pages/Accrual";
import Budget from "./pages/Budget";
import RestrictedNetAssets from "./pages/RestrictedNetAssets";
import GeneralLedger from "./pages/GeneralLedger";
import IncomeStatement from "./pages/IncomeStatement";
import LinkReceipts from "./pages/LinkReceipts";
import Rules from "./pages/Rules";
import Accounts from "./pages/Accounts";
import Config from "./pages/Config";
import Donors from "./pages/Donors";
import Users from "./pages/Users";
import Login from "./pages/Login";
import PledgeCampaigns from "./pages/PledgeCampaigns";
import PledgeCampaignImportWizard from "./pages/PledgeCampaigns/ImportWizard";
import Reimbursements from "./pages/Reimbursements";

type Tab =
  | "home"
  | "upload"
  | "reconcile-wizard"
  | "stripe"
  | "plaid"
  | "reconciliation"
  | "accrual"
  | "budget"
  | "restricted-net-assets"
  | "general-ledger"
  | "income-statement"
  | "rules"
  | "accounts"
  | "link-receipts"
  | "config"
  | "users"
  | "pledge-campaigns"
  | "pledge-campaign-import"
  | "donors"
  | "reimbursements";

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
      // "Upload" is deliberately hidden from nav (deprecated in favor of
      // the automated Stripe/Plaid sync + the upcoming Reconciliation
      // page, see issue #105) but the tab/route/component below are left
      // fully intact - re-adding this one line brings it back if the
      // treasurer ever needs the manual-CSV path again (e.g. Stripe or
      // Plaid access is lost).
      // { tab: "upload", label: "Upload" },
      { tab: "reconcile-wizard", label: "Reconciliation" },
      { tab: "stripe", label: "Stripe" },
      { tab: "plaid", label: "Bank Transactions" },
      { tab: "reconciliation", label: "Actual" },
      { tab: "accrual", label: "Accrual" },
      { tab: "budget", label: "Budget" },
      { tab: "restricted-net-assets", label: "Restricted Net Assets" },
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
      { tab: "pledge-campaigns", label: "Campaign Status" },
      { tab: "pledge-campaign-import", label: "Import Campaigns" },
    ],
  },
  {
    label: "Reimbursements",
    items: [{ tab: "reimbursements", label: "Reimbursements" }],
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

const COLLAPSED_GROUPS_KEY = "sidebar-collapsed-groups";
const SIDEBAR_HIDDEN_KEY = "sidebar-hidden";

// First-time visitors (no stored preference yet) get every group collapsed
// and the whole rail hidden, per the treasurer's request that the default
// view should show as little chrome as possible - anyone who expands
// something has that choice remembered from then on.
function defaultCollapsedGroups(): Record<string, boolean> {
  const defaults: Record<string, boolean> = {};
  for (const group of NAV_GROUPS) {
    if (group.label !== "Overview") defaults[group.label] = true;
  }
  return defaults;
}

function loadCollapsedGroups(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSED_GROUPS_KEY);
    return raw ? JSON.parse(raw) : defaultCollapsedGroups();
  } catch {
    return defaultCollapsedGroups();
  }
}

function loadSidebarHidden(): boolean {
  const raw = localStorage.getItem(SIDEBAR_HIDDEN_KEY);
  return raw === null ? true : raw === "1";
}

export default function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // Overview is always expanded (it's a single Home link, nothing to hide);
  // every other group's collapsed/expanded state persists across reloads,
  // same localStorage-backed pattern as the ledger tables' column widths.
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(loadCollapsedGroups);
  // Whole-sidebar hide/show, independent of the per-group collapse above -
  // lets the whole rail be tucked away to reclaim width, same idea as the
  // UKG reference screenshots.
  const [sidebarHidden, setSidebarHidden] = useState<boolean>(loadSidebarHidden);

  useEffect(() => {
    localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(collapsedGroups));
  }, [collapsedGroups]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_HIDDEN_KEY, sidebarHidden ? "1" : "0");
  }, [sidebarHidden]);

  function toggleGroup(label: string) {
    setCollapsedGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  }

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

  if (loading)
    return (
      <div className="app-loading">
        <div className="spinner" aria-hidden="true" />
        <span>Loading…</span>
      </div>
    );
  if (!user) return <Login onSuccess={loadMe} />;

  return (
    <div className="app-shell">
      <aside className={sidebarHidden ? "sidebar sidebar-hidden" : "sidebar"}>
        <button
          className="sidebar-hide-toggle"
          onClick={() => setSidebarHidden((v) => !v)}
          aria-label={sidebarHidden ? "Show sidebar" : "Hide sidebar"}
          title={sidebarHidden ? "Show sidebar" : "Hide sidebar"}
        >
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transform: sidebarHidden ? "rotate(180deg)" : "none" }}
          >
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>

        {!sidebarHidden && (
          <>
            <div className="sidebar-brand">
              <img src={logo} alt="Cross Way Mar Thoma Church" />
            </div>

            <nav className="sidebar-nav">
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter((item) => {
              if (item.adminOnly) return user.is_admin;
              if (item.tab === "home") return true;
              // Shares the (deprecated, hidden) Upload wizard's own
              // "upload" permission - same backend endpoints
              // (/api/reconcile/*), just a different frontend entry point.
              if (item.tab === "reconcile-wizard") {
                return user.is_admin || user.permissions.includes("upload");
              }
              // The single Campaign Status entry covers three underlying
              // permission keys (its Status/Details sub-tabs) - show it if
              // the user holds any one of them.
              if (item.tab === "pledge-campaigns") {
                return (
                  user.is_admin ||
                  ["pledge-campaign-status", "pledge-campaign-pledges", "pledge-campaign-actuals"].some(
                    (k) => user.permissions.includes(k)
                  )
                );
              }
              // Import writes to the same data the Status dashboard reads,
              // so it's gated by that permission rather than its own key.
              if (item.tab === "pledge-campaign-import") {
                return user.is_admin || user.permissions.includes("pledge-campaign-status");
              }
              return user.is_admin || user.permissions.includes(item.tab);
            });
            if (items.length === 0) return null;
            const collapsible = group.label !== "Overview";
            const collapsed = collapsible && !!collapsedGroups[group.label];
            return (
              <div key={group.label} style={{ marginBottom: 14 }}>
                {collapsible ? (
                  <button
                    className="sidebar-group-toggle"
                    onClick={() => toggleGroup(group.label)}
                    aria-expanded={!collapsed}
                  >
                    <span>{group.label}</span>
                    <svg
                      viewBox="0 0 24 24"
                      width="12"
                      height="12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{
                        transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
                        transition: "transform 0.15s",
                      }}
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                ) : (
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      color: "var(--sidebar-text)",
                      padding: "6px 13px 4px",
                    }}
                  >
                    {group.label}
                  </div>
                )}
                {!collapsed &&
                  items.map((item) => (
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
          </>
        )}
      </aside>

      <main className="app-main">
        <div className="app-content">
          {tab === "home" && <Home onNavigate={setTab} />}
          {tab === "upload" && <Upload />}
          {tab === "reconcile-wizard" && <Reconcile />}
          {tab === "stripe" && <StripePage />}
          {tab === "plaid" && <BankTransactions />}
          {tab === "reconciliation" && <Reconciliation />}
          {tab === "accrual" && <Accrual />}
          {tab === "budget" && <Budget />}
          {tab === "restricted-net-assets" && <RestrictedNetAssets />}
          {tab === "general-ledger" && <GeneralLedger />}
          {tab === "income-statement" && <IncomeStatement />}
          {tab === "rules" && <Rules />}
          {tab === "accounts" && <Accounts />}
          {tab === "link-receipts" && <LinkReceipts />}
          {tab === "config" && <Config />}
          {tab === "donors" && <Donors />}
          {tab === "pledge-campaigns" && <PledgeCampaigns user={user} />}
          {tab === "pledge-campaign-import" && <PledgeCampaignImportWizard />}
          {tab === "reimbursements" && <Reimbursements />}
          {tab === "users" && user.is_admin && <Users currentUserId={user.id} />}
        </div>
      </main>
    </div>
  );
}
