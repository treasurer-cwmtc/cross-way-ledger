import { useState } from "react";
import { plaidApi } from "../../api/plaid";
import { reconcileApi, ReconRun } from "../../api/reconcile";
import { stripeApi } from "../../api/stripe";

/** Step 2: pull both sources fresh, then build the reconciliation run from
 * the synced Bank Transactions (Plaid) data for the chosen date range -
 * Stripe's side of the run is filled in on step 3 (Step3Reconcile, reused
 * unmodified from pages/Upload) via the existing merge-stripe endpoint,
 * which already reads from the synced Stripe data with no file involved. */
export default function Step2Sync(props: {
  startDate: string;
  endDate: string;
  onRunCreated: (run: ReconRun) => void;
  onNext: () => void;
}) {
  const [stripeBusy, setStripeBusy] = useState(false);
  const [stripeMsg, setStripeMsg] = useState("");
  const [stripeError, setStripeError] = useState("");

  const [bankBusy, setBankBusy] = useState(false);
  const [bankMsg, setBankMsg] = useState("");
  const [bankError, setBankError] = useState("");

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");

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

  return (
    <div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Sync now</h3>
        <p className="subtitle" style={{ marginTop: 0 }}>
          Pull the latest from both sources before reconciling. Bank Transactions (Plaid) syncs
          whatever's new since its last sync (its own cursor, not scoped to the range below) -
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
        <button className="btn" onClick={next} disabled={starting}>
          {starting ? "Loading…" : "Next: Reconcile"}
        </button>
        {startError && <span className="error">{startError}</span>}
      </div>
    </div>
  );
}
