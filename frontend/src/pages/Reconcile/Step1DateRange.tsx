import { useEffect, useState } from "react";
import { reconcileApi } from "../../api/reconcile";

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Step 1: pick the date range to reconcile, informed by the most recent
 * transaction date already sitting in each staging table - so it's obvious
 * whether a sync is even needed before moving on to step 2. Doesn't touch
 * the backend itself (no run created yet) - just collects start/end into
 * the parent's state. */
export default function Step1DateRange(props: {
  startDate: string;
  endDate: string;
  onStartDateChange: (v: string) => void;
  onEndDateChange: (v: string) => void;
  onNext: () => void;
}) {
  const [bankLastPosted, setBankLastPosted] = useState<string | null | undefined>(undefined);
  const [stripeLastPosted, setStripeLastPosted] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    reconcileApi
      .syncStatus()
      .then((s) => {
        setBankLastPosted(s.bank_last_posted);
        setStripeLastPosted(s.stripe_last_posted);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const canContinue = !!props.startDate && !!props.endDate && props.startDate <= props.endDate;

  return (
    <div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>What's already synced</h3>
        <p className="subtitle" style={{ marginTop: 0 }}>
          The most recent transaction date already pulled in from each source - use this to
          decide where the range below should start.
        </p>
        <div className="row" style={{ gap: 24 }}>
          <div>
            <span style={{ color: "var(--muted)", fontSize: 12 }}>Bank Transactions (Plaid)</span>
            <div style={{ fontWeight: 600 }}>
              {bankLastPosted === undefined
                ? "Loading…"
                : bankLastPosted || "No synced transactions yet"}
            </div>
          </div>
          <div>
            <span style={{ color: "var(--muted)", fontSize: 12 }}>Stripe</span>
            <div style={{ fontWeight: 600 }}>
              {stripeLastPosted === undefined
                ? "Loading…"
                : stripeLastPosted || "No synced transactions yet"}
            </div>
          </div>
        </div>
        {error && <div className="error">{error}</div>}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Date range</h3>
        <p className="subtitle" style={{ marginTop: 0 }}>
          Which posted dates to reconcile. Step 2 will sync both sources fresh before pulling
          this range in.
        </p>
        <div className="row">
          <label className="field">
            <span>Start date</span>
            <input
              type="date"
              value={props.startDate}
              onChange={(e) => props.onStartDateChange(e.target.value)}
            />
          </label>
          <label className="field">
            <span>End date</span>
            <input
              type="date"
              value={props.endDate}
              onChange={(e) => props.onEndDateChange(e.target.value)}
            />
          </label>
        </div>
        {!canContinue && props.startDate && props.endDate && (
          <p className="error">Start date must be on or before end date.</p>
        )}
        <button className="btn" onClick={props.onNext} disabled={!canContinue}>
          Next: Sync
        </button>
      </div>
    </div>
  );
}

export { isoDaysAgo };
