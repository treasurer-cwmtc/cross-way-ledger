import { useEffect } from "react";
import { PlaidTransaction } from "../../api/plaid";

function fmtMoney(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

/** Read-only - same reasoning as StripeDetailModal: this is staged,
 * synced-from-the-bank data, not something edited directly here. */
export default function PlaidDetailModal(props: { entry: PlaidTransaction; onClose: () => void }) {
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
              {fmtMoney(e.amount)} · {e.posting_date || "no date"}
              {e.pending ? " · Pending" : ""}
            </p>
          </div>
          <button className="link" onClick={props.onClose}>
            Close
          </button>
        </div>

        <div className="modal-readonly-grid">
          <div>
            <span>Plaid transaction ID</span>
            {e.plaid_transaction_id}
          </div>
          <div>
            <span>Details</span>
            {e.details || "—"}
          </div>
          <div>
            <span>Type</span>
            {e.type || "—"}
          </div>
          <div>
            <span>Amount</span>
            {fmtMoney(e.amount)}
          </div>
          <div>
            <span>Posting date</span>
            {e.posting_date || "—"}
          </div>
          <div>
            <span>Pending</span>
            {e.pending ? "Yes" : "No"}
          </div>
          <div>
            <span>Account</span>
            {e.account_id}
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
