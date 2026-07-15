import { useEffect, useState } from "react";
import { dashboardApi, Dashboard } from "../../api/dashboard";

function fmtMoney(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

function fmtRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const days = Math.floor((now - then) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/** Quick landing page: account balances, Income/Expense YTD vs Budget, and
 * when data was last entered - so the treasurer can tell at a glance
 * whether the books are current before digging into any one tab. */
export default function Home() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    dashboardApi.get().then(setData).catch((err) => setError((err as Error).message));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <p className="subtitle">Loading…</p>;

  const incomeVariance = data.income_ytd - data.income_plan_ytd;
  const expenseVariance = data.expense_plan_ytd - data.expense_ytd;

  return (
    <div>
      <h2 className="page-title">Home</h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Quick overview for {data.year}. Details live on the Actual,
        Accrual, Budget, General Ledger, and Income Statement tabs.
      </p>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Accounts</h3>
        <div className="stats">
          {data.bank_accounts.map((b) => (
            <div className="stat" key={b.bank_account_id}>
              <b>{fmtMoney(b.balance)}</b>
              <span>{b.name}</span>
            </div>
          ))}
          {data.bank_accounts.length === 0 && (
            <span className="subtitle">No bank accounts yet - add one on the Upload tab.</span>
          )}
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Income vs Budget (YTD)</h3>
        <div className="stats">
          <div className="stat">
            <b>{fmtMoney(data.income_ytd)}</b>
            <span>Actual</span>
          </div>
          <div className="stat">
            <b>{fmtMoney(data.income_plan_ytd)}</b>
            <span>Plan</span>
          </div>
          <div className="stat">
            <b style={{ color: incomeVariance >= 0 ? "var(--green)" : "var(--red)" }}>
              {fmtMoney(incomeVariance)}
            </b>
            <span>Variance</span>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Expenses vs Budget (YTD)</h3>
        <div className="stats">
          <div className="stat">
            <b>{fmtMoney(data.expense_ytd)}</b>
            <span>Actual</span>
          </div>
          <div className="stat">
            <b>{fmtMoney(data.expense_plan_ytd)}</b>
            <span>Plan</span>
          </div>
          <div className="stat">
            <b style={{ color: expenseVariance >= 0 ? "var(--green)" : "var(--red)" }}>
              {fmtMoney(expenseVariance)}
            </b>
            <span>Variance</span>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Last data entry</h3>
        <p className="subtitle" style={{ margin: 0 }}>
          {data.last_entry_at
            ? `${fmtRelative(data.last_entry_at)} (${new Date(data.last_entry_at).toLocaleString()})`
            : "No Actual or Accrual entries yet."}
        </p>
      </div>
    </div>
  );
}
