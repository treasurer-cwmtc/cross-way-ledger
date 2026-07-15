import { useRef, useState } from "react";
import { budgetApi, BudgetEntry, BudgetEntryCreate } from "../../api/budget";
import { ChartAccount } from "../../api/accounts";
import AccountPicker from "../ledger/AccountPicker";

/** Fast, keyboard-driven entry - mirrors Accrual's Quick Add. Year/Account
 * stay filled in between saves (budget lines are usually entered in a
 * batch against the same account - e.g. Salary/Health Insurance/Retirement
 * Plan all posted to "Salaries and Benefits") so you only ever retype
 * what's actually different: the description and the amount. */
export default function QuickAddModal(props: {
  accounts: ChartAccount[];
  year: number;
  onCreated: (entry: BudgetEntry) => void;
  onClose: () => void;
}) {
  const [sticky, setSticky] = useState<{ transaction_date: string; account_no: string }>({
    transaction_date: `${props.year}-01-01`,
    account_no: "",
  });
  const [description, setDescription] = useState("Budget");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [count, setCount] = useState(0);
  const amountRef = useRef<HTMLInputElement>(null);

  const canSave =
    sticky.account_no !== "" && Number(amount) !== 0 && !Number.isNaN(Number(amount));

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!canSave || saving) return;
    setSaving(true);
    setError("");
    try {
      const payload: BudgetEntryCreate = {
        ...sticky,
        description,
        amount: Number(amount),
        notes,
      };
      const entry = await budgetApi.create(payload);
      props.onCreated(entry);
      setCount((c) => c + 1);
      // Reset only the per-line fields; keep account/year for the next row.
      setDescription("Budget");
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
              value={sticky.transaction_date}
              onChange={(e) => setSticky((s) => ({ ...s, transaction_date: e.target.value }))}
            />
          </label>

          <label className="field">
            <span>Statement Description (Chart of Accounts)</span>
            <AccountPicker
              value={sticky.account_no}
              accounts={props.accounts}
              onChange={(v) => setSticky((s) => ({ ...s, account_no: v }))}
            />
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
