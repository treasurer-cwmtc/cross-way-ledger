import { useEffect } from "react";
import { ChartAccount } from "../../api/accounts";
import { ReconLine, ReconLineUpdate } from "../../api/reconcile";
import AccountPicker from "../ledger/AccountPicker";
import { CurrencyCell, SelectCell, TextCell } from "../ledger/cells";
import { METHOD_OPTIONS } from "../ledger/columns";

/** Full editor for one preview line - adapted from the Actual/Accrual
 * TransactionModal, minus split (these aren't real ledger entries yet). */
export default function WizardLineModal(props: {
  line: ReconLine;
  accounts: ChartAccount[];
  onUpdate: (id: number, patch: ReconLineUpdate) => void;
  onClose: () => void;
}) {
  const l = props.line;
  const set = (patch: ReconLineUpdate) => props.onUpdate(l.id, patch);

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
            <h3 style={{ margin: 0 }}>{l.bank_description || l.description || "Line"}</h3>
            <p className="subtitle" style={{ margin: "2px 0 0" }}>
              ${l.amount.toFixed(2)} · {l.transaction_date || "no date"}
            </p>
          </div>
          <button className="link" onClick={props.onClose}>
            Close
          </button>
        </div>

        <label className="field">
          <span>Category (account)</span>
          <AccountPicker
            value={l.account_no}
            accounts={props.accounts}
            onChange={(v) => set({ account_no: v })}
          />
        </label>

        <label className="field">
          <span>Description</span>
          <TextCell value={l.description} onCommit={(v) => set({ description: v })} />
        </label>

        <div className="row">
          <label className="field">
            <span>Method</span>
            <SelectCell value={l.method} options={METHOD_OPTIONS} onChange={(v) => set({ method: v })} />
          </label>
          <label className="field">
            <span>Amount</span>
            <CurrencyCell value={l.amount} onCommit={(v) => set({ amount: v })} />
          </label>
        </div>

        <label className="field">
          <span>Bank Description</span>
          <input type="text" value={l.bank_description} readOnly title="The raw bank statement text - not editable." />
        </label>

        <label className="field">
          <span>Notes</span>
          <TextCell value={l.notes} onCommit={(v) => set({ notes: v })} />
        </label>

        <div className="modal-footer">
          <div />
          <button className="btn" onClick={props.onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
