import { useEffect, useState } from "react";
import { reconcileApi, ReconRun } from "../../api/reconcile";
import { plaidApi } from "../../api/plaid";
import { stripeApi } from "../../api/stripe";

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Step 1: what's already synced/reconciled, pick a date range, sync both
 * sources fresh, then build the run from the synced Bank Transactions
 * (Plaid) data for that range - Stripe's side of the run is filled in on
 * the Review step's "Reconcile" (Step3Reconcile, reused unmodified from
 * pages/Upload) via the existing merge-stripe endpoint, which already
 * reads from the synced Stripe data with no file involved.
 *
 * The sync step used to be its own separate page (Step2Sync) between this
 * one and the bank-line review - folded in here instead, since picking a
 * range and syncing fresh are really one decision, and it frees up "step
 * 2" for the actual review step that issue #122 restores. */
export default function Step1DateRange(props: {
  startDate: string;
  endDate: string;
  onStartDateChange: (v: string) => void;
  onEndDateChange: (v: string) => void;
  onRunCreated: (run: ReconRun) => void;
  onNext: () => void;
}) {
  const [bankLastPosted, setBankLastPosted] = useState<string | null | undefined>(undefined);
  const [stripeLastPosted, setStripeLastPosted] = useState<string | null | undefined>(undefined);
  const [actualLastPosted, setActualLastPosted] = useState<string | null | undefined>(undefined);
  const [statusError, setStatusError] = useState("");

  const [stripeBusy, setStripeBusy] = useState(false);
  const [stripeMsg, setStripeMsg] = useState("");
  const [stripeError, setStripeError] = useState("");

  const [bankBusy, setBankBusy] = useState(false);
  const [bankMsg, setBankMsg] = useState("");
  const [bankError, setBankError] = useState("");

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");

  useEffect(() => {
    reconcileApi
      .syncStatus()
      .then((s) => {
        setBankLastPosted(s.bank_last_posted);
        setStripeLastPosted(s.stripe_last_posted);
        setActualLastPosted(s.actual_last_posted);
      })
      .catch((e) => setStatusError((e as Error).message));
  }, []);

  async function syncStripe() {
    setStripeBusy(true);
    setStripeError("");
    setStripeMsg("");
    try {
      const result = await stripeApi.syncNow();
      setStripeMsg(`Synced ${result.fetched} transaction${result.fetched === 1 ? "" : "s"}.`);
    } catch (e) {
      setStripeError((e as Error).message);
    } finally {
      setStripeBusy(false);
    }
  }

  async function syncBank() {
    setBankBusy(true);
    setBankError("");
    setBankMsg("");
    try {
      const result = await plaidApi.syncNow();
      setBankMsg(
        `Synced ${result.fetched} transaction${result.fetched === 1 ? "" : "s"} ` +
          `(${result.added} new, ${result.modified} updated, ${result.removed} removed).`
      );
    } catch (e) {
      setBankError((e as Error).message);
    } finally {
      setBankBusy(false);
    }
  }

  async function next() {
    setStarting(true);
    setStartError("");
    try {
      const run = await reconcileApi.fromBankSync(props.startDate, props.endDate);
      props.onRunCreated(run);
      props.onNext();
    } catch (e) {
      setStartError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  const canContinue = !!props.startDate && !!props.endDate && props.startDate <= props.endDate;

  return (
    <div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>What's already synced</h3>
        <p className="subtitle" style={{ marginTop: 0 }}>
          The most recent transaction date already pulled in from each source, plus the last
          date actually reconciled into Actual - use these to decide where the range below
          should start.
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
          <div>
            <span style={{ color: "var(--muted)", fontSize: 12 }}>
              Last posted in Actual (prior reconciliation)
            </span>
            <div style={{ fontWeight: 600 }}>
              {actualLastPosted === undefined
                ? "Loading…"
                : actualLastPosted || "Nothing reconciled yet"}
            </div>
          </div>
        </div>
        {statusError && <div className="error">{statusError}</div>}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Date range</h3>
        <p className="subtitle" style={{ marginTop: 0 }}>
          Which posted dates to reconcile.
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
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Sync now</h3>
        <p className="subtitle" style={{ marginTop: 0 }}>
          Pull the latest from both sources before reconciling. Bank Transactions (Plaid) syncs
          whatever's new since its last sync (its own cursor, not scoped to the range above) -
          Stripe re-syncs its full recent window. Either can be skipped if you already synced
          recently.
        </p>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div>
            <button className="btn secondary" onClick={syncStripe} disabled={stripeBusy}>
              {stripeBusy ? "Syncing…" : "Sync Stripe now"}
            </button>
            {stripeMsg && <p className="ok" style={{ margin: "6px 0 0" }}>{stripeMsg}</p>}
            {stripeError && <div className="error">{stripeError}</div>}
          </div>
          <div>
            <button className="btn secondary" onClick={syncBank} disabled={bankBusy}>
              {bankBusy ? "Syncing…" : "Sync Bank Transactions now"}
            </button>
            {bankMsg && <p className="ok" style={{ margin: "6px 0 0" }}>{bankMsg}</p>}
            {bankError && <div className="error">{bankError}</div>}
          </div>
        </div>
      </div>

      <div className="toolbar">
        <button className="btn" onClick={next} disabled={!canContinue || starting}>
          {starting ? "Loading…" : "Next: Review"}
        </button>
        {startError && <span className="error">{startError}</span>}
      </div>
    </div>
  );
}

export { isoDaysAgo };
