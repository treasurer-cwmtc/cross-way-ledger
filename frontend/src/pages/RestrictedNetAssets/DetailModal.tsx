import { useEffect } from "react";
import { RestrictedTransferEntry, RestrictedTransferEntryUpdate } from "../../api/restrictedTransfers";
import { ChartAccount } from "../../api/accounts";
import AccountPicker from "../ledger/AccountPicker";
import { CurrencyCell, DateCell, TextCell } from "../ledger/cells";

/** Full editor for one transfer. Deliberately not the shared Reconciliation/
 * Accrual TransactionModal - a transfer has two accounts and no bank
 * account, method, reconciled flag, or split. */
export default function DetailModal(props: {
  entry: RestrictedTransferEntry;
  accounts: ChartAccount[];
  onUpdate: (id: number, patch: RestrictedTransferEntryUpdate) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
}) {
  const e = props.entry;
  const set = (patch: RestrictedTransferEntryUpdate) => props.onUpdate(e.id, patch);

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
            <h3 style={{ margin: 0 }}>{e.description || "Transfer"}</h3>
            <p className="subtitle" style={{ margin: "2px 0 0" }}>
              ${e.amount.toFixed(2)} · {e.transaction_date || "no date"}
            </p>
          </div>
          <button className="link" onClick={props.onClose}>
            Close
          </button>
        </div>

        <label className="field">
          <span>Transaction Date</span>
          <DateCell value={e.transaction_date} onChange={(v) => set({ transaction_date: v })} />
        </label>

        <label className="field">
          <span>From (money leaves this account)</span>
          <AccountPicker
            value={e.from_account_no}
            accounts={props.accounts}
            onChange={(v) => set({ from_account_no: v })}
          />
        </label>

        <label className="field">
          <span>To (money lands in this account)</span>
          <AccountPicker
            value={e.to_account_no}
            accounts={props.accounts}
            onChange={(v) => set({ to_account_no: v })}
          />
        </label>

        <label className="field">
          <span>Description</span>
          <TextCell value={e.description} onCommit={(v) => set({ description: v })} />
        </label>

        <label className="field">
          <span>Amount</span>
          <CurrencyCell value={e.amount} onCommit={(v) => set({ amount: v })} />
        </label>

        <label className="field">
          <span>Notes</span>
          <TextCell value={e.notes} onCommit={(v) => set({ notes: v })} />
        </label>

        <div className="modal-footer">
          <button
            className="link"
            onClick={() => {
              props.onDelete(e.id);
              props.onClose();
            }}
          >
            Delete entry
          </button>
          <button className="btn" onClick={props.onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
