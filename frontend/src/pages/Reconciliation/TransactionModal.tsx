import { useEffect, useState } from "react";
import { ChartAccount } from "../../api/accounts";
import { BankAccount } from "../../api/bankAccounts";
import { ledgerApi, ReconciliationEntry, ReconciliationEntryUpdate } from "../../api/ledger";
import { METHOD_OPTIONS } from "./columns";
import {
  AccountCell,
  BankAccountCell,
  CheckboxCell,
  CurrencyCell,
  DateCell,
  SelectCell,
  TextCell,
} from "./cells";
import SplitModal from "./SplitModal";

/** Full editor for one entry - every field, including the Chart of Accounts
 * picker (only mounted here, one at a time, so its ~370 options never touch
 * the register). Opened by clicking a RegisterRow; changes auto-save the
 * same way inline cells always have. */
export default function TransactionModal(props: {
  entry: ReconciliationEntry;
  accounts: ChartAccount[];
  bankAccounts: BankAccount[];
  onUpdate: (id: number, patch: ReconciliationEntryUpdate) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
  onReload: () => void;
}) {
  const e = props.entry;
  const set = (patch: ReconciliationEntryUpdate) => props.onUpdate(e.id, patch);
  const [showSplit, setShowSplit] = useState(false);
  const [unsplitting, setUnsplitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") props.onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function undoSplit() {
    if (e.split_parent_id == null) return;
    if (!confirm("Undo this split? The lines you created will be removed and the original line restored.")) {
      return;
    }
    setUnsplitting(true);
    setError("");
    try {
      await ledgerApi.unsplit(e.split_parent_id);
      props.onReload();
      props.onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUnsplitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal-dialog" onClick={(ev) => ev.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 style={{ margin: 0 }}>{e.description || "Transaction"}</h3>
            <p className="subtitle" style={{ margin: "2px 0 0" }}>
              ${e.amount.toFixed(2)} · {e.transaction_date || "no date"}
            </p>
          </div>
          <button className="link" onClick={props.onClose}>
            Close
          </button>
        </div>

        {e.split_parent_id != null ? (
          <div className="toolbar">
            <span className="pill warn">Part of a split transaction</span>
            <button className="link" onClick={undoSplit} disabled={unsplitting}>
              {unsplitting ? "Undoing…" : "Undo split (merge back into one line)"}
            </button>
          </div>
        ) : (
          <div className="toolbar">
            <button className="btn secondary" onClick={() => setShowSplit(true)}>
              Split into multiple lines
            </button>
            <span style={{ color: "var(--muted)", fontSize: 12 }}>
              For an aggregated bank line (e.g. a deposit slip covering several checks).
            </span>
          </div>
        )}
        {error && <div className="error">{error}</div>}

        <div className="row">
          <label className="field">
            <span>Transaction Date</span>
            <DateCell value={e.transaction_date} onChange={(v) => set({ transaction_date: v })} />
          </label>
          <label className="field">
            <span>Date Posted</span>
            <DateCell value={e.date_posted} onChange={(v) => set({ date_posted: v })} />
          </label>
        </div>

        <div className="row">
          <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <CheckboxCell value={e.reconciled} onChange={(v) => set({ reconciled: v })} />
            <span>Reconciled</span>
          </label>
          <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <CheckboxCell
              value={e.is_reimbursement}
              onChange={(v) => set({ is_reimbursement: v })}
            />
            <span>Is Reimbursement</span>
          </label>
        </div>

        <label className="field">
          <span>Statement Description (Chart of Accounts)</span>
          <AccountCell
            value={e.account_no}
            accounts={props.accounts}
            onChange={(v) => set({ account_no: v })}
          />
        </label>

        <label className="field">
          <span>Description</span>
          <TextCell value={e.description} onCommit={(v) => set({ description: v })} />
        </label>

        <div className="row">
          <label className="field">
            <span>Bank Account</span>
            <BankAccountCell
              value={e.bank_account_id}
              bankAccounts={props.bankAccounts}
              onChange={(v) => set({ bank_account_id: v })}
            />
          </label>
          <label className="field">
            <span>Method</span>
            <SelectCell value={e.method} options={METHOD_OPTIONS} onChange={(v) => set({ method: v })} />
          </label>
        </div>

        <div className="row">
          <label className="field">
            <span>Amount</span>
            <CurrencyCell value={e.amount} onCommit={(v) => set({ amount: v })} />
          </label>
          <label className="field">
            <span>Check/Invoice Name</span>
            <TextCell
              value={e.check_invoice_name}
              onCommit={(v) => set({ check_invoice_name: v })}
            />
          </label>
        </div>

        <label className="field">
          <span>Bank Description</span>
          <TextCell value={e.bank_description} onCommit={(v) => set({ bank_description: v })} />
        </label>

        <label className="field">
          <span>Notes</span>
          <TextCell value={e.notes} onCommit={(v) => set({ notes: v })} />
        </label>

        <div className="modal-section-title">From Chart of Accounts (read-only)</div>
        <div className="modal-readonly-grid">
          <div>
            <span>Category</span>
            {e.category || "—"}
          </div>
          <div>
            <span>Type</span>
            {(e.category === "Budget" ? "Income" : e.category) || "—"}
          </div>
          <div>
            <span>Statement</span>
            {e.statement_category || "—"}
          </div>
          <div>
            <span>Item</span>
            {e.statement_item || "—"}
          </div>
          <div>
            <span>Item Detail</span>
            {e.statement_detail || "—"}
          </div>
          <div>
            <span>Grouping</span>
            {e.grouping || "—"}
          </div>
          <div>
            <span>Youth Chaplain Share</span>
            {e.is_youth_chaplain_share || "—"}
          </div>
          <div>
            <span>Missions</span>
            {e.is_missions || "—"}
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

      {showSplit && (
        <SplitModal
          entry={e}
          accounts={props.accounts}
          onSplit={() => {
            setShowSplit(false);
            props.onReload();
            props.onClose();
          }}
          onClose={() => setShowSplit(false)}
        />
      )}
    </div>
  );
}
