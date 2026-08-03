import { useEffect, useState } from "react";
import { ChartAccount } from "../../api/accounts";
import { BankAccount } from "../../api/bankAccounts";
import { ReconcileWithAccrualsResult } from "../../api/ledger";
import { pickReceiptFile } from "../../lib/googleDrive";
import { METHOD_OPTIONS } from "./columns";
import AccountPicker from "./AccountPicker";
import {
  BankAccountCell,
  CheckboxCell,
  CurrencyCell,
  DateCell,
  SelectCell,
  TextCell,
} from "./cells";
import ReconcileAccrualWizard from "./ReconcileAccrualWizard";
import SplitModal from "./SplitModal";
import { LedgerEntry, LedgerEntryUpdate, SplitLine } from "./types";

/** Full editor for one entry - every field, including the Chart of Accounts
 * picker (only mounted here, one at a time, so its ~370 options never touch
 * the register). Opened by clicking a RegisterRow; changes auto-save the
 * same way inline cells always have. Shared by Reconciliation and Accrual -
 * split/unsplit are passed in as callbacks so this component doesn't need
 * to know which ledger's API it's talking to. */
export default function TransactionModal(props: {
  entry: LedgerEntry;
  accounts: ChartAccount[];
  bankAccounts: BankAccount[];
  onUpdate: (id: number, patch: LedgerEntryUpdate) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
  onReload: () => void;
  onSplit: (id: number, lines: SplitLine[]) => Promise<LedgerEntry[]>;
  onUnsplit: (parentId: number) => Promise<LedgerEntry>;
  splitHint?: string;
  // The other rows sharing this entry's split_parent_id - shown so it's
  // obvious which lines a split produced, since they otherwise aren't
  // grouped together anywhere in the table (sorted/filtered like any
  // other row).
  splitSiblings?: LedgerEntry[];
  // Reconciliation-only: reconcile this actual line against one or more
  // Accrual entries (e.g. one Zelle payment that was accrued as several
  // separate expense lines). Omitted entirely on the Accrual page, where
  // this action doesn't apply.
  accrualCandidates?: LedgerEntry[];
  onReconcileWithAccruals?: (
    actualId: number,
    accrualIds: number[]
  ) => Promise<ReconcileWithAccrualsResult>;
}) {
  const e = props.entry;
  const set = (patch: LedgerEntryUpdate) => props.onUpdate(e.id, patch);
  const [showSplit, setShowSplit] = useState(false);
  const [showReconcileAccrual, setShowReconcileAccrual] = useState(false);
  const [unsplitting, setUnsplitting] = useState(false);
  const [error, setError] = useState("");
  const [attachingReceipt, setAttachingReceipt] = useState(false);

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") props.onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function attachReceipt() {
    setError("");
    setAttachingReceipt(true);
    try {
      const dateForYear = e.posted_date || e.transaction_date;
      const year = dateForYear ? Number(dateForYear.slice(0, 4)) : new Date().getFullYear();
      const file = await pickReceiptFile({ year });
      if (file) {
        set({
          receipt_file_id: file.id,
          receipt_file_name: file.name,
          receipt_web_view_link: file.url,
          check_invoice_name: file.name,
        });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAttachingReceipt(false);
    }
  }

  function removeReceipt() {
    set({ receipt_file_id: "", receipt_file_name: "", receipt_web_view_link: "" });
  }

  async function undoSplit() {
    if (e.split_parent_id == null) return;
    if (!confirm("Undo this split? The lines you created will be removed and the original line restored.")) {
      return;
    }
    setUnsplitting(true);
    setError("");
    try {
      await props.onUnsplit(e.split_parent_id);
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
              ${e.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })} · {e.transaction_date || "no date"}
            </p>
          </div>
          <button className="link" onClick={props.onClose}>
            Close
          </button>
        </div>

        {e.split_parent_id != null ? (
          <div className="toolbar" style={{ flexDirection: "column", alignItems: "stretch" }}>
            <div className="row" style={{ alignItems: "center" }}>
              <span className="pill warn">Part of a split transaction</span>
              <button className="link" onClick={undoSplit} disabled={unsplitting}>
                {unsplitting ? "Undoing…" : "Undo split (merge back into one line)"}
              </button>
            </div>
            {props.splitSiblings && props.splitSiblings.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 13 }}>
                <div style={{ color: "var(--muted)", marginBottom: 4 }}>
                  This split also created {props.splitSiblings.length} other line
                  {props.splitSiblings.length === 1 ? "" : "s"}:
                </div>
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {props.splitSiblings.map((s) => (
                    <li key={s.id}>
                      {s.description || "(no description)"} — $
                      {s.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </li>
                  ))}
                </ul>
                <div style={{ marginTop: 4 }}>
                  <b>
                    Split total: $
                    {(
                      e.amount + props.splitSiblings.reduce((sum, s) => sum + s.amount, 0)
                    ).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </b>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="toolbar">
            <button className="btn secondary" onClick={() => setShowSplit(true)}>
              Split into multiple lines
            </button>
            <span style={{ color: "var(--muted)", fontSize: 12 }}>
              {props.splitHint ||
                "For one lump entry that actually covers several people or purchases."}
            </span>
          </div>
        )}

        {e.split_parent_id == null && props.onReconcileWithAccruals && (
          <div className="toolbar">
            <button className="btn secondary" onClick={() => setShowReconcileAccrual(true)}>
              Reconcile against Accrual
            </button>
            <span style={{ color: "var(--muted)", fontSize: 12 }}>
              For a bank payment that was recorded as several separate Accrual entries (e.g. one
              Zelle payment covering multiple expense lines).
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
            <span>Posted Date</span>
            <DateCell value={e.posted_date} onChange={(v) => set({ posted_date: v })} />
          </label>
        </div>

        <div className="row">
          <label className="field field-checkbox">
            <CheckboxCell value={e.reconciled} onChange={(v) => set({ reconciled: v })} />
            <span>Reconciled</span>
          </label>
          <label className="field field-checkbox">
            <CheckboxCell
              value={e.is_reimbursement}
              onChange={(v) => set({ is_reimbursement: v })}
            />
            <span>Is Reimbursement</span>
          </label>
        </div>

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
          <input type="text" value={e.bank_description} readOnly title="The raw bank statement text - not editable." />
        </label>

        <label className="field">
          <span>Notes</span>
          <TextCell value={e.notes} onCommit={(v) => set({ notes: v })} />
        </label>

        {e.source_file_name && (
          <label className="field">
            <span>Source file</span>
            {e.source_file_link ? (
              <a href={e.source_file_link} target="_blank" rel="noreferrer">
                {e.source_file_name}
              </a>
            ) : (
              <span>{e.source_file_name}</span>
            )}
          </label>
        )}

        <label className="field">
          <span>Receipt</span>
          {e.receipt_file_id ? (
            <div className="row" style={{ alignItems: "center", gap: 10 }}>
              <a href={e.receipt_web_view_link} target="_blank" rel="noreferrer">
                {e.receipt_file_name || "View receipt"}
              </a>
              <button className="link" onClick={removeReceipt}>
                Remove
              </button>
            </div>
          ) : (
            <button className="btn secondary" onClick={attachReceipt} disabled={attachingReceipt}>
              {attachingReceipt ? "Opening Google Drive…" : "Attach receipt"}
            </button>
          )}
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
          onSubmit={(lines) => props.onSplit(e.id, lines)}
          onSuccess={() => {
            setShowSplit(false);
            props.onReload();
            props.onClose();
          }}
          onClose={() => setShowSplit(false)}
        />
      )}

      {showReconcileAccrual && props.onReconcileWithAccruals && (
        <ReconcileAccrualWizard
          actual={e}
          accrualCandidates={props.accrualCandidates || []}
          onSubmit={(accrualIds) => props.onReconcileWithAccruals!(e.id, accrualIds)}
          onSuccess={() => {
            setShowReconcileAccrual(false);
            props.onReload();
            props.onClose();
          }}
          onClose={() => setShowReconcileAccrual(false)}
        />
      )}
    </div>
  );
}
