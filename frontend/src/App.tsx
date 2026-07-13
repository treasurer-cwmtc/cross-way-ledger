import { useState } from "react";
import Reconcile from "./pages/Reconcile";
import Rules from "./pages/Rules";
import Accounts from "./pages/Accounts";

type Tab = "reconcile" | "rules" | "accounts";

export default function App() {
  const [tab, setTab] = useState<Tab>("reconcile");

  return (
    <div className="app">
      <h1>Bank / Stripe Reconciliation</h1>
      <p className="subtitle">
        Upload your Chase and Stripe CSV exports to break Stripe payouts into
        per-donation lines and auto-categorize bank transactions.
      </p>

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
      </nav>

      {tab === "reconcile" && <Reconcile />}
      {tab === "rules" && <Rules />}
      {tab === "accounts" && <Accounts />}
    </div>
  );
}
