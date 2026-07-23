import { useRef, useState } from "react";
import {
  restrictedTransfersApi,
  RestrictedTransferEntry,
  RestrictedTransferEntryCreate,
} from "../../api/restrictedTransfers";
import { ChartAccount } from "../../api/accounts";
import AccountPicker from "../ledger/AccountPicker";

/** Fast, keyboard-driven entry - mirrors Budget/Accrual's Quick Add. Date
 * stays filled in between saves (transfers are usually entered a few at a
 * time for the same year-end reclassification pass), so only the accounts,
 * description, and amount typically change row to row. */
export default function QuickAddModal(props: {
  accounts: ChartAccount[];
  onCreated: (entry: RestrictedTransferEntry) => void;
  onClose: () => void;
}) {
  const [transactionDate, setTransactionDate] = useState(new Date().toISOString().slice(0, 10));
  const [fromAccountNo, setFromAccountNo] = useState("");
  const [toAccountNo, setToAccountNo] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [count, setCount] = useState(0);
  const amountRef = useRef<HTMLInputElement>(null);

  const canSave =
    fromAccountNo !== "" &&
    toAccountNo !== "" &&
    Number(amount) > 0 &&
    !Number.isNaN(Number(amount));

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!canSave || saving) return;
    setSaving(true);
    setError("");
    try {
      const payload: RestrictedTransferEntryCreate = {
        transaction_date: transactionDate,
        from_account_no: fromAccountNo,
        to_account_no: toAccountNo,
        description,
        amount: Number(amount),
        notes,
      };
      const entry = await restrictedTransfersApi.create(payload);
      props.onCreated(entry);
      setCount((c) => c + 1);
      setDescription("");
      setAmount("");
      setNotes("");
      amountRef.current?.focus();
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
          <label className="field">
            <span>Transaction Date</span>
            <input
              type="date"
              value={transactionDate}
              onChange={(e) => setTransactionDate(e.target.value)}
            />
          </label>

          <label className="field">
            <span>From (money leaves this account)</span>
            <AccountPicker value={fromAccountNo} accounts={props.accounts} onChange={setFromAccountNo} />
          </label>

          <label className="field">
            <span>To (money lands in this account)</span>
            <AccountPicker value={toAccountNo} accounts={props.accounts} onChange={setToAccountNo} />
          </label>

          <label className="field">
            <span>Description</span>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>

          <div className="row">
            <label className="field">
              <span>Amount</span>
              <input
                ref={amountRef}
                type="number"
                step="0.01"
                autoFocus
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Notes</span>
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </div>

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
