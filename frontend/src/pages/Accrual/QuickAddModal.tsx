import { useRef, useState } from "react";
import { accrualApi, AccrualEntry, AccrualEntryCreate } from "../../api/accrual";
import { ChartAccount } from "../../api/accounts";
import { BankAccount } from "../../api/bankAccounts";
import { METHOD_OPTIONS } from "../ledger/columns";
import AccountPicker from "../ledger/AccountPicker";

/** Fast, keyboard-driven entry: fill in the fields, hit Enter (or click Add),
 * the entry saves and the form resets for the next one. Date/Statement
 * Description/Bank Account/Method/Is Reimbursement stay filled in between
 * saves (most batches of accrual entries share those - e.g. five people
 * reimbursed for the same VBS purchase on the same day) so you only ever
 * retype what's actually different: who and how much. */
export default function QuickAddModal(props: {
  accounts: ChartAccount[];
  bankAccounts: BankAccount[];
  onCreated: (entry: AccrualEntry) => void;
  onClose: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [sticky, setSticky] = useState<{
    transaction_date: string;
    posted_date: string;
    account_no: string;
    bank_account_id: number | null;
    method: string;
    is_reimbursement: boolean;
  }>({
    transaction_date: today,
    posted_date: today,
    account_no: "",
    bank_account_id: props.bankAccounts[0]?.id ?? null,
    method: "",
    is_reimbursement: false,
  });
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [checkInvoiceName, setCheckInvoiceName] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [count, setCount] = useState(0);
  const descriptionRef = useRef<HTMLInputElement>(null);

  const canSave = description.trim() !== "" && Number(amount) !== 0 && !Number.isNaN(Number(amount));

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!canSave || saving) return;
    setSaving(true);
    setError("");
    try {
      const payload: AccrualEntryCreate = {
        ...sticky,
        description,
        amount: Number(amount),
        check_invoice_name: checkInvoiceName,
        notes,
      };
      const entry = await accrualApi.create(payload);
      props.onCreated(entry);
      setCount((c) => c + 1);
      // Reset only the per-entry fields; keep the sticky ones for the next row.
      setDescription("");
      setAmount("");
      setCheckInvoiceName("");
      setNotes("");
      descriptionRef.current?.focus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal-dialog" onClick={(ev) => ev.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 style={{ margin: 0 }}>Quick add</h3>
            <p className="subtitle" style={{ margin: "2px 0 0" }}>
              {count > 0 ? `${count} added this session.` : "Fill in and press Enter to add."}
            </p>
          </div>
          <button className="link" onClick={props.onClose}>
            Close
          </button>
        </div>

        <form onSubmit={submit}>
          <div className="row">
            <label className="field">
              <span>Transaction Date</span>
              <input
                type="date"
                value={sticky.transaction_date}
                onChange={(e) => setSticky((s) => ({ ...s, transaction_date: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>Posted Date</span>
              <input
                type="date"
                value={sticky.posted_date}
                onChange={(e) => setSticky((s) => ({ ...s, posted_date: e.target.value }))}
              />
            </label>
          </div>

          <label className="field">
            <span>Statement Description (Chart of Accounts)</span>
            <AccountPicker
              value={sticky.account_no}
              accounts={props.accounts}
              onChange={(v) => setSticky((s) => ({ ...s, account_no: v }))}
            />
          </label>

          <label className="field">
            <span>Description (who / what)</span>
            <input
              ref={descriptionRef}
              type="text"
              autoFocus
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          <div className="row">
            <label className="field">
              <span>Bank Account</span>
              <select
                value={sticky.bank_account_id ?? ""}
                onChange={(e) =>
                  setSticky((s) => ({
                    ...s,
                    bank_account_id: e.target.value ? Number(e.target.value) : null,
                  }))
                }
              >
                <option value="">Select…</option>
                {props.bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Method</span>
              <select
                value={sticky.method}
                onChange={(e) => setSticky((s) => ({ ...s, method: e.target.value }))}
              >
                <option value="">Select…</option>
                {METHOD_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="row">
            <label className="field">
              <span>Amount</span>
              <input
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Check/Invoice Name</span>
              <input
                type="text"
                value={checkInvoiceName}
                onChange={(e) => setCheckInvoiceName(e.target.value)}
              />
            </label>
          </div>

          <label className="field">
            <span>Notes</span>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>

          <label className="field field-checkbox">
            <input
              type="checkbox"
              checked={sticky.is_reimbursement}
              onChange={(e) => setSticky((s) => ({ ...s, is_reimbursement: e.target.checked }))}
            />
            <span>Is Reimbursement</span>
          </label>

          {error && <div className="error">{error}</div>}

          <div className="modal-footer">
            <button type="button" className="link" onClick={props.onClose}>
              Done
            </button>
            <button className="btn" type="submit" disabled={!canSave || saving}>
              {saving ? "Adding…" : "Add (Enter)"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
