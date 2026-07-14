import { useState } from "react";
import { ChartAccount } from "../../api/accounts";
import { ledgerApi, ReconciliationEntry, SplitLine } from "../../api/ledger";

interface DraftLine {
  description: string;
  account_no: string;
  amount: string;
}

function blankLine(): DraftLine {
  return { description: "", account_no: "", amount: "" };
}

/** Splits one aggregated bank line (e.g. a lump deposit slip covering
 * several checks) into multiple Reconciliation entries. The original line
 * isn't deleted server-side - it's just hidden, so a future re-import of
 * the same statement won't resurrect it as a duplicate. */
export default function SplitModal(props: {
  entry: ReconciliationEntry;
  accounts: ChartAccount[];
  onSplit: (children: ReconciliationEntry[]) => void;
  onClose: () => void;
}) {
  const e = props.entry;
  const [lines, setLines] = useState<DraftLine[]>([
    { description: e.description, account_no: e.account_no, amount: e.amount.toFixed(2) },
    blankLine(),
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const delta = Math.round((e.amount - total) * 100) / 100;
  const balanced = Math.abs(delta) < 0.01;
  const allFilled = lines.every((l) => l.description.trim() && Number(l.amount) > 0);
  const canSave = balanced && allFilled && lines.length >= 2;

  function updateLine(i: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((prev) => [...prev, blankLine()]);
  }

  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      const payload: SplitLine[] = lines.map((l) => ({
        description: l.description,
        account_no: l.account_no,
        amount: Number(l.amount),
      }));
      const children = await ledgerApi.split(e.id, payload);
      props.onSplit(children);
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
            <h3 style={{ margin: 0 }}>Split transaction</h3>
            <p className="subtitle" style={{ margin: "2px 0 0" }}>
              Original: ${e.amount.toFixed(2)} · {e.transaction_date}
            </p>
          </div>
          <button className="link" onClick={props.onClose}>
            Close
          </button>
        </div>

        {lines.map((line, i) => (
          <div key={i} className="row" style={{ alignItems: "flex-end" }}>
            <label className="field">
              <span>Description</span>
              <input
                type="text"
                value={line.description}
                onChange={(ev) => updateLine(i, { description: ev.target.value })}
              />
            </label>
            <label className="field">
              <span>Statement Description</span>
              <select
                value={line.account_no}
                onChange={(ev) => updateLine(i, { account_no: ev.target.value })}
              >
                <option value="">— uncategorized —</option>
                {props.accounts.map((a) => (
                  <option key={a.account_no} value={a.account_no}>
                    {a.account_no} · {a.statement_description}
                  </option>
                ))}
              </select>
            </label>
            <label className="field" style={{ maxWidth: 120 }}>
              <span>Amount</span>
              <input
                type="number"
                step="0.01"
                value={line.amount}
                onChange={(ev) => updateLine(i, { amount: ev.target.value })}
              />
            </label>
            {lines.length > 2 && (
              <button
                className="link"
                style={{ marginBottom: 14 }}
                onClick={() => removeLine(i)}
              >
                Remove
              </button>
            )}
          </div>
        ))}

        <button className="btn secondary" onClick={addLine}>
          + Add line
        </button>

        <div className="toolbar" style={{ marginTop: 16 }}>
          <span style={{ fontSize: 13 }}>
            Total: <b>${total.toFixed(2)}</b> of ${e.amount.toFixed(2)}
          </span>
          <span
            className="pill"
            style={{
              background: balanced ? "#ecfdf5" : "#fef2f2",
              color: balanced ? "var(--green)" : "var(--red)",
            }}
          >
            {balanced ? "Balanced" : `${delta > 0 ? "Remaining" : "Over by"} $${Math.abs(delta).toFixed(2)}`}
          </span>
        </div>
        {error && <div className="error">{error}</div>}

        <div className="modal-footer">
          <button className="link" onClick={props.onClose}>
            Cancel
          </button>
          <button className="btn" onClick={save} disabled={!canSave || saving}>
            {saving ? "Saving…" : "Save Split"}
          </button>
        </div>
      </div>
    </div>
  );
}
