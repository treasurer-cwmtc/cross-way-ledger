import { useEffect } from "react";
import { StripeTransaction } from "../../api/stripe";

function fmtMoney(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

/** Read-only - this is staged, synced-from-Stripe data, not something the
 * treasurer edits directly. Editing (categorizing, matching to a bank line)
 * happens in the Upload wizard once this data is reconciled against a real
 * bank statement. */
export default function StripeDetailModal(props: { entry: StripeTransaction; onClose: () => void }) {
  const e = props.entry;

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") props.onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal-dialog" onClick={(ev) => ev.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 style={{ margin: 0 }}>{e.description || e.type}</h3>
            <p className="subtitle" style={{ margin: "2px 0 0" }}>
              {fmtMoney(e.amount)} · {e.created || "no date"}
            </p>
          </div>
          <button className="link" onClick={props.onClose}>
            Close
          </button>
        </div>

        <div className="modal-readonly-grid">
          <div>
            <span>Stripe ID</span>
            {e.stripe_id}
          </div>
          <div>
            <span>Type</span>
            {e.type || "—"}
          </div>
          <div>
            <span>Source</span>
            {e.source || "—"}
          </div>
          <div>
            <span>Donor</span>
            {e.donor || "—"}
          </div>
          <div>
            <span>Fund</span>
            {e.fund || "—"}
          </div>
          <div>
            <span>Amount</span>
            {fmtMoney(e.amount)}
          </div>
          <div>
            <span>Fee</span>
            {fmtMoney(e.fee)}
          </div>
          <div>
            <span>Net</span>
            {fmtMoney(e.net)}
          </div>
          <div>
            <span>Created</span>
            {e.created || "—"}
          </div>
          <div>
            <span>Payout (Transfer)</span>
            {e.transfer || "—"}
          </div>
          <div>
            <span>Transfer date</span>
            {e.transfer_date || "—"}
          </div>
          <div>
            <span>Synced at</span>
            {new Date(e.synced_at).toLocaleString()}
          </div>
        </div>

        <div className="modal-section-title">Description</div>
        <p className="subtitle" style={{ margin: 0 }}>
          {e.description || "—"}
        </p>

        <div className="modal-footer">
          <button className="btn" onClick={props.onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
