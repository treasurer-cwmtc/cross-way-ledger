import { useEffect, useState } from "react";
import { dashboardApi, Dashboard } from "../../api/dashboard";
import {
  BookIcon,
  ChartIcon,
  PlusCircleIcon,
  ReceiptIcon,
  TableIcon,
  UploadIcon,
} from "./icons";

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

type HomeTab =
  | "upload"
  | "reconciliation"
  | "accrual"
  | "reimbursements"
  | "general-ledger"
  | "income-statement";

const SHORTCUTS: { tab: HomeTab; label: string; icon: (p: { size?: number }) => JSX.Element }[] = [
  { tab: "upload", label: "Upload bank file", icon: (p) => <UploadIcon width={p.size} height={p.size} /> },
  { tab: "reconciliation", label: "Actual ledger", icon: (p) => <TableIcon width={p.size} height={p.size} /> },
  { tab: "accrual", label: "Accrual ledger", icon: (p) => <PlusCircleIcon width={p.size} height={p.size} /> },
  { tab: "reimbursements", label: "Reimbursements", icon: (p) => <ReceiptIcon width={p.size} height={p.size} /> },
  { tab: "general-ledger", label: "General Ledger", icon: (p) => <BookIcon width={p.size} height={p.size} /> },
  { tab: "income-statement", label: "Income Statement", icon: (p) => <ChartIcon width={p.size} height={p.size} /> },
];

/** Landing page: a "what needs my attention" banner up top (outstanding
 * reimbursements if any, otherwise how fresh the books are), a shortcut
 * grid to the pages the treasurer opens most, then the existing
 * balances/YTD-vs-budget stat cards. */
export default function Home(props: { onNavigate: (tab: HomeTab) => void }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    dashboardApi.get().then(setData).catch((err) => setError((err as Error).message));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <p className="subtitle">Loading…</p>;

  const incomeVariance = data.income_ytd - data.income_plan_ytd;
  const expenseVariance = data.expense_plan_ytd - data.expense_ytd;
  const hasOutstanding = data.outstanding_reimbursements_count > 0;

  return (
    <div>
      <h2 className="page-title">Home</h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Quick overview for {data.year}.
      </p>

      <div className="home-banner">
        {hasOutstanding ? (
          <>
            <div>
              <div className="home-banner-label">Needs your attention</div>
              <div className="home-banner-headline">
                {data.outstanding_reimbursements_count} reimbursement
                {data.outstanding_reimbursements_count === 1 ? "" : "s"} awaiting action
              </div>
              <button className="btn" onClick={() => props.onNavigate("reimbursements")}>
                Review reimbursements
              </button>
            </div>
            <div className="home-banner-side">
              <span>Total owed</span>
              <b>{fmtMoney(data.outstanding_reimbursements_total)}</b>
            </div>
          </>
        ) : (
          <>
            <div>
              <div className="home-banner-label">Books are current</div>
              <div className="home-banner-headline">
                {data.last_posted_date
                  ? `Last posted transaction was ${fmtRelative(data.last_posted_date)}`
                  : "No posted Actual transactions yet"}
              </div>
              <button className="btn" onClick={() => props.onNavigate("reconciliation")}>
                Go to Actual
              </button>
            </div>
            {data.last_posted_date && (
              <div className="home-banner-side">
                <span>Posted date</span>
                <b>{data.last_posted_date}</b>
              </div>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Shortcuts</h3>
        <div className="home-shortcuts">
          {SHORTCUTS.map((s) => (
            <button key={s.tab} className="home-shortcut" onClick={() => props.onNavigate(s.tab)}>
              <span className="home-shortcut-icon">{s.icon({ size: 22 })}</span>
              {s.label}
            </button>
          ))}
        </div>
      </div>

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
    </div>
  );
}
