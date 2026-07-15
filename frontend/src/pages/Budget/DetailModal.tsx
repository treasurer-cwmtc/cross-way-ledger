import { useEffect } from "react";
import { BudgetEntry, BudgetEntryUpdate } from "../../api/budget";
import { ChartAccount } from "../../api/accounts";
import AccountPicker from "../ledger/AccountPicker";
import { CurrencyCell, DateCell, TextCell } from "../ledger/cells";

/** Full editor for one Budget line. Deliberately not the shared
 * Reconciliation/Accrual TransactionModal - Budget lines don't have a bank
 * account, method, reconciled flag, or split, so reusing that component
 * would either show fields that never apply or need per-field hiding. */
export default function DetailModal(props: {
  entry: BudgetEntry;
  accounts: ChartAccount[];
  onUpdate: (id: number, patch: BudgetEntryUpdate) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
}) {
  const e = props.entry;
  const set = (patch: BudgetEntryUpdate) => props.onUpdate(e.id, patch);

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
            <h3 style={{ margin: 0 }}>{e.description || "Budget line"}</h3>
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
          <span>Statement Description (Chart of Accounts)</span>
          <AccountPicker
            value={e.account_no}
            accounts={props.accounts}
            onChange={(v) => set({ account_no: v })}
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

        <div className="modal-section-title">From Chart of Accounts (read-only)</div>
        <div className="modal-readonly-grid">
          <div>
            <span>Statement Category</span>
            {e.statement_category || "—"}
          </div>
          <div>
            <span>Statement Item</span>
            {e.statement_item || "—"}
          </div>
          <div>
            <span>Statement Detail</span>
            {e.statement_detail || "—"}
          </div>
        </div>

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
