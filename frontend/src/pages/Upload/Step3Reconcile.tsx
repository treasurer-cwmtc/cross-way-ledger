import { useMemo, useState } from "react";
import { reconcileApi, ReconRun } from "../../api/reconcile";

export default function Step3Reconcile(props: {
  run: ReconRun;
  stripeFile: File | null;
  onRunChange: (run: ReconRun) => void;
  onNext: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const run = props.run;

  async function doReconcile() {
    if (!props.stripeFile) return;
    setBusy(true);
    setError("");
    try {
      props.onRunChange(await reconcileApi.mergeStripe(run.id, props.stripeFile));
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const byDay = useMemo(() => {
    const map = new Map<string, { total: number; count: number; hasIssue: boolean }>();
    for (const l of run.lines) {
      if (l.source !== "stripe") continue;
      const day = l.date_posted || "unknown";
      const row = map.get(day) || { total: 0, count: 0, hasIssue: false };
      row.total += l.amount;
      row.count += 1;
      if (!l.matched) row.hasIssue = true;
      map.set(day, row);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [run.lines]);

  const totalUnmatched = run.unmatched_stripe_bank_count;
  const totalBankStripeLines = run.matched_payout_count + totalUnmatched;

  return (
    <div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Reconcile</h3>
        <p className="subtitle">
          Match every Stripe bank deposit to its underlying donations, and confirm the
          dollar amounts line up day by day.
        </p>
        {!done && (
          <button className="btn" onClick={doReconcile} disabled={!props.stripeFile || busy}>
            {busy ? "Reconciling…" : "Reconcile"}
          </button>
        )}
        {error && <div className="error">{error}</div>}
      </div>

      {done && (
        <>
          <div className="card">
            <div className="stats">
              <div className="stat">
                <b>{run.matched_payout_count}</b>
                <span>Payouts matched</span>
              </div>
              <div className="stat">
                <b style={{ color: totalUnmatched ? "#dc2626" : undefined }}>{totalUnmatched}</b>
                <span>Unmatched Stripe payouts</span>
              </div>
              <div className="stat">
                <b>{totalBankStripeLines}</b>
                <span>Total Stripe bank lines</span>
              </div>
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>By day</h3>
            <table>
              <thead>
                <tr>
                  <th>Date posted</th>
                  <th className="num">Reconciled total</th>
                  <th className="num">Lines</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {byDay.map(([day, row]) => (
                  <tr key={day}>
                    <td>{day}</td>
                    <td className="num">{row.total.toFixed(2)}</td>
                    <td className="num">{row.count}</td>
                    <td>
                      {row.hasIssue ? (
                        <span className="pill warn">Needs attention</span>
                      ) : (
                        <span className="pill bank">✓ Matched</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="toolbar">
            <button className="btn" onClick={props.onNext}>
              Next: Data validation
            </button>
          </div>
        </>
      )}
    </div>
  );
}
