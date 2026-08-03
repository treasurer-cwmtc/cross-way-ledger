import { useMemo, useState } from "react";
import { ReconcileWithAccrualsResult } from "../../api/ledger";
import { LedgerEntry } from "./types";

function fmtMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

type Step = "select" | "preview";

/** One bank line often represents several accrual entries at once (e.g. one
 * Zelle payment to a person that was accrued as 5 separate expense lines) -
 * the mirror image of Stripe reconciliation, where one bank payout line
 * explodes into several Stripe donation lines. This is a manual two-step
 * wizard rather than anything automatic: Step 1 picks which accrual entries
 * make up this actual line (validated against its amount live, not just on
 * submit); Step 2 previews exactly what gets created/hidden before
 * committing, since both sides of this action are otherwise invisible
 * (the actual becomes N new lines, the accrual entries disappear from their
 * list) and there's no undo once it's submitted. */
export default function ReconcileAccrualWizard(props: {
  actual: LedgerEntry;
  accrualCandidates: LedgerEntry[];
  onSubmit: (accrualIds: number[]) => Promise<ReconcileWithAccrualsResult>;
  onSuccess: (result: ReconcileWithAccrualsResult) => void;
  onClose: () => void;
}) {
  const { actual } = props;
  const [step, setStep] = useState<Step>("select");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return props.accrualCandidates;
    return props.accrualCandidates.filter(
      (a) =>
        a.description.toLowerCase().includes(q) ||
        a.statement_description.toLowerCase().includes(q) ||
        a.notes.toLowerCase().includes(q)
    );
  }, [props.accrualCandidates, query]);

  const selectedEntries = props.accrualCandidates.filter((a) => selected.has(a.id));
  const selectedTotal = round2(selectedEntries.reduce((sum, a) => sum + a.amount, 0));
  const actualAmount = round2(actual.amount);
  const ties = selectedEntries.length > 0 && Math.abs(selectedTotal - actualAmount) < 0.01;

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    setSubmitting(true);
    setError("");
    try {
      const result = await props.onSubmit([...selected]);
      props.onSuccess(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div
        className="modal-dialog"
        style={{ maxWidth: 720 }}
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h3 style={{ margin: 0 }}>Reconcile against Accrual</h3>
            <p className="subtitle" style={{ margin: "2px 0 0" }}>
              {step === "select" ? "Step 1 of 2 — select matching lines" : "Step 2 of 2 — preview"}
            </p>
          </div>
          <button className="link" onClick={props.onClose}>
            Close
          </button>
        </div>

        <div className="card" style={{ marginBottom: 14, padding: 12 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <b>{actual.description || "(no description)"}</b>
              <div className="subtitle" style={{ margin: 0 }}>
                {actual.posted_date || "no date"} · {actual.bank_description || "no bank description"}
              </div>
            </div>
            <b className="num">{fmtMoney(actual.amount)}</b>
          </div>
        </div>

        {error && <div className="error">{error}</div>}

        {step === "select" ? (
          <>
            <input
              type="text"
              placeholder="Search accrual entries…"
              value={query}
              onChange={(ev) => setQuery(ev.target.value)}
              style={{ marginBottom: 10 }}
            />
            <div className="table-wrap" style={{ maxHeight: 320 }}>
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Statement Description</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((a) => (
                    <tr
                      key={a.id}
                      onClick={() => toggle(a.id)}
                      style={{ cursor: "pointer" }}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(a.id)}
                          onChange={() => toggle(a.id)}
                          onClick={(ev) => ev.stopPropagation()}
                        />
                      </td>
                      <td>{a.transaction_date || "—"}</td>
                      <td>{a.description || "—"}</td>
                      <td>{a.statement_description || "— uncategorized —"}</td>
                      <td className="num">{fmtMoney(a.amount)}</td>
                    </tr>
                  ))}
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={5} className="subtitle">
                        No accrual entries match.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="row" style={{ marginTop: 12, justifyContent: "space-between", alignItems: "center" }}>
              <div>
                Selected total:{" "}
                <b style={{ color: ties ? undefined : "var(--red)" }}>{fmtMoney(selectedTotal)}</b>
                {" · "}Actual amount: <b>{fmtMoney(actualAmount)}</b>
                {!ties && selectedEntries.length > 0 && (
                  <span style={{ color: "var(--red)", marginLeft: 8 }}>
                    Doesn't tie — difference {fmtMoney(round2(actualAmount - selectedTotal))}
                  </span>
                )}
              </div>
              <button className="btn" onClick={() => setStep("preview")} disabled={!ties}>
                Next: Preview
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="modal-section-title">
              The actual line will be replaced with {selectedEntries.length} lines
            </div>
            <div className="table-wrap" style={{ maxHeight: 220, marginBottom: 14 }}>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Statement Description</th>
                    <th>Amount</th>
                    <th>Posted Date</th>
                    <th>Bank Description</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedEntries.map((a) => (
                    <tr key={a.id}>
                      <td>{a.transaction_date || "—"}</td>
                      <td>{a.statement_description || "— uncategorized —"}</td>
                      <td className="num">{fmtMoney(a.amount)}</td>
                      <td>{actual.posted_date || "—"}</td>
                      <td title={actual.bank_description}>{actual.bank_description || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="subtitle" style={{ marginTop: 0 }}>
              Posted Date and Bank Description are retained from the original actual line, same as
              a manual split - the original stays on record (hidden) so a re-imported bank
              statement can't recreate it as a duplicate.
            </p>

            <div className="modal-section-title">
              These {selectedEntries.length} accrual entries will be removed from the Accrual ledger
            </div>
            <ul style={{ margin: "0 0 14px", paddingLeft: 20 }}>
              {selectedEntries.map((a) => (
                <li key={a.id}>
                  {a.transaction_date || "no date"} — {a.description || "(no description)"} —{" "}
                  {fmtMoney(a.amount)}
                </li>
              ))}
            </ul>

            <div className="row" style={{ justifyContent: "space-between" }}>
              <button className="btn secondary" onClick={() => setStep("select")} disabled={submitting}>
                Back
              </button>
              <button className="btn" onClick={submit} disabled={submitting}>
                {submitting ? "Reconciling…" : "Submit"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
