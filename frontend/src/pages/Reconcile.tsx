import { useMemo, useState } from "react";
import { api, ReconRun } from "../api";

type Filter = "all" | "stripe" | "bank" | "unmatched";

export default function Reconcile() {
  const [bankFile, setBankFile] = useState<File | null>(null);
  const [stripeFile, setStripeFile] = useState<File | null>(null);
  const [run, setRun] = useState<ReconRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  async function onRun() {
    if (!bankFile || !stripeFile) return;
    setBusy(true);
    setError("");
    try {
      setRun(await api.reconcile(bankFile, stripeFile));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const lines = useMemo(() => {
    if (!run) return [];
    return run.lines.filter((l) => {
      if (filter === "all") return true;
      if (filter === "unmatched") return !l.matched;
      return l.source === filter;
    });
  }, [run, filter]);

  const total = useMemo(
    () => lines.reduce((s, l) => s + l.amount, 0),
    [lines]
  );

  return (
    <div>
      <div className="card">
        <div className="row">
          <label className="field">
            <span>Bank statement CSV (Chase export)</span>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => setBankFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <label className="field">
            <span>Stripe transactions CSV</span>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => setStripeFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>
        <button
          className="btn"
          onClick={onRun}
          disabled={!bankFile || !stripeFile || busy}
        >
          {busy ? "Reconciling…" : "Reconcile"}
        </button>
        {error && <div className="error">{error}</div>}
      </div>

      {run && (
        <div className="card">
          <div className="stats">
            <div className="stat">
              <b>{run.matched_payout_count}</b>
              <span>Payouts matched</span>
            </div>
            <div className="stat">
              <b>{run.lines.length}</b>
              <span>Output lines</span>
            </div>
            <div className="stat">
              <b>{run.stripe_line_count}</b>
              <span>Stripe rows in</span>
            </div>
            <div className="stat">
              <b>{run.bank_line_count}</b>
              <span>Bank rows in</span>
            </div>
            <div className="stat">
              <b style={{ color: run.unmatched_stripe_bank_count ? "#dc2626" : undefined }}>
                {run.unmatched_stripe_bank_count}
              </b>
              <span>Unmatched Stripe</span>
            </div>
          </div>

          <div className="toolbar" style={{ marginTop: 16 }}>
            <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
              <option value="all">All lines</option>
              <option value="stripe">Stripe donations</option>
              <option value="bank">Bank transactions</option>
              <option value="unmatched">Needs attention</option>
            </select>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>
              {lines.length} lines · subtotal{" "}
              <b>${total.toFixed(2)}</b>
            </span>
            <a className="btn secondary" href={api.exportUrl(run.id)} download>
              Download CSV
            </a>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Txn Date</th>
                  <th>Posted</th>
                  <th>Description</th>
                  <th>Category</th>
                  <th>Account</th>
                  <th className="num">Amount</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <span className={`pill ${l.source}`}>{l.source}</span>
                    </td>
                    <td>{l.transaction_date}</td>
                    <td>{l.date_posted}</td>
                    <td>{l.description}</td>
                    <td>{l.statement_description || l.category}</td>
                    <td>{l.account_no}</td>
                    <td className="num">{l.amount.toFixed(2)}</td>
                    <td>
                      {l.notes && <span className="pill warn">{l.notes}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
