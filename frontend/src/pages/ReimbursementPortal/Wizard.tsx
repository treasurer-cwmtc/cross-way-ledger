import { useState } from "react";
import {
  Reimbursement,
  ReimbursementAssignment,
  ReimbursementLineIn,
  reimbursementPortalApi,
} from "../../api/reimbursementPortal";
import AssignedAccountPicker from "./AssignedAccountPicker";

function fmtMoney(n: number): string {
  return `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

interface WizardLine extends ReimbursementLineIn {
  key: number;
  uploading?: boolean;
}

let nextKey = 1;

function emptyLine(): WizardLine {
  return {
    key: nextKey++,
    account_no: "",
    amount: 0,
    description: "",
    transaction_date: new Date().toISOString().slice(0, 10),
  };
}

/** Two-step submission wizard - reused for both a brand-new request and
 * editing an existing Pending one (see mode/existing). Step 1 add lines,
 * step 2 verify totals and submit together (combined per feedback - both
 * steps were really "finishing the submission"). */
export default function ReimbursementWizard(props: {
  coas: ReimbursementAssignment[];
  existing?: Reimbursement;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState(props.existing?.name || "");
  const [lines, setLines] = useState<WizardLine[]>(() =>
    props.existing
      ? props.existing.lines.map((l) => ({
          key: nextKey++,
          account_no: l.account_no,
          amount: l.amount,
          description: l.description,
          transaction_date: l.transaction_date,
          receipt_file_id: l.receipt_file_id,
          receipt_file_name: l.receipt_file_name,
          receipt_web_view_link: l.receipt_web_view_link,
        }))
      : [emptyLine()]
  );
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const accountByNo = new Map(props.coas.map((a) => [a.account_no, a]));

  function updateLine(key: number, patch: Partial<WizardLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(key: number) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  }

  async function attachReceipt(key: number, file: File) {
    updateLine(key, { uploading: true });
    try {
      const result = await reimbursementPortalApi.uploadReceipt(file);
      updateLine(key, {
        uploading: false,
        receipt_file_id: result.file_id,
        receipt_file_name: result.file_name,
        receipt_web_view_link: result.web_view_link,
      });
    } catch (e) {
      updateLine(key, { uploading: false });
      setError((e as Error).message);
    }
  }

  const total = lines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
  const canProceed = lines.every(
    (l) => l.transaction_date && l.account_no && Number(l.amount) > 0 && l.receipt_file_id
  );

  async function submit() {
    setError("");
    setSubmitting(true);
    try {
      const payload: ReimbursementLineIn[] = lines.map((l) => ({
        account_no: l.account_no,
        amount: Number(l.amount),
        description: l.description,
        transaction_date: l.transaction_date || null,
        receipt_file_id: l.receipt_file_id,
        receipt_file_name: l.receipt_file_name,
        receipt_web_view_link: l.receipt_web_view_link,
      }));
      if (props.existing) {
        await reimbursementPortalApi.updateMyRequest(props.existing.id, payload, name.trim());
      } else {
        await reimbursementPortalApi.submit(payload, name.trim());
      }
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="card">
        <h3 style={{ marginTop: 0 }}>
          {props.existing ? "Request updated" : "Request submitted"}
        </h3>
        <p className="subtitle">
          A confirmation email was sent to you, and the treasurer has been notified.
        </p>
        <button className="btn" onClick={props.onDone}>
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>
        {props.existing ? "Edit request" : "New reimbursement request"} — Step {step} of 2
      </h3>

      <label className="field" style={{ maxWidth: 360 }}>
        <span>Request name</span>
        <input
          type="text"
          value={name}
          placeholder="e.g. VBS supplies run"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <p className="subtitle" style={{ marginTop: -6 }}>
        We'll pick a name automatically if you leave this blank - feel free to change it to
        something easier to recognize later.
      </p>

      {step === 1 && (
        <>
          {lines.map((line, i) => (
            <div
              key={line.key}
              className="card"
              style={{ marginBottom: 14, padding: 16, background: "var(--bg-alt, #f8f9fa)" }}
            >
              <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                <b>Item {i + 1}</b>
                {lines.length > 1 && (
                  <button className="link" onClick={() => removeLine(line.key)}>
                    Remove
                  </button>
                )}
              </div>

              <div className="row" style={{ gap: 16 }}>
                <label className="field" style={{ maxWidth: 200 }}>
                  <span>Transaction Date (required)</span>
                  <input
                    type="date"
                    required
                    value={line.transaction_date || ""}
                    onChange={(e) => updateLine(line.key, { transaction_date: e.target.value })}
                  />
                </label>
                <label className="field" style={{ flex: 1 }}>
                  <span>Account (required)</span>
                  <AssignedAccountPicker
                    value={line.account_no}
                    accounts={props.coas}
                    onChange={(accountNo) => updateLine(line.key, { account_no: accountNo })}
                  />
                </label>
              </div>

              <div className="row" style={{ gap: 16 }}>
                <label className="field" style={{ flex: 1 }}>
                  <span>Description</span>
                  <input
                    type="text"
                    placeholder="What was this for?"
                    value={line.description}
                    onChange={(e) => updateLine(line.key, { description: e.target.value })}
                  />
                </label>
                <label className="field" style={{ maxWidth: 160 }}>
                  <span>Amount (required)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    placeholder="0.00"
                    value={line.amount || ""}
                    onChange={(e) => updateLine(line.key, { amount: Number(e.target.value) })}
                  />
                </label>
              </div>

              <label className="field">
                <span>Receipt (required)</span>
                {line.receipt_file_name ? (
                  <div className="row" style={{ alignItems: "center", gap: 10 }}>
                    {line.receipt_web_view_link ? (
                      <a href={line.receipt_web_view_link} target="_blank" rel="noreferrer">
                        {line.receipt_file_name}
                      </a>
                    ) : (
                      <span>{line.receipt_file_name}</span>
                    )}
                    <button
                      className="link"
                      onClick={() =>
                        updateLine(line.key, {
                          receipt_file_id: undefined,
                          receipt_file_name: undefined,
                          receipt_web_view_link: undefined,
                        })
                      }
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <input
                    type="file"
                    onChange={(e) => e.target.files?.[0] && attachReceipt(line.key, e.target.files[0])}
                    disabled={line.uploading}
                  />
                )}
                {line.uploading && <span className="subtitle">Uploading…</span>}
              </label>
            </div>
          ))}
          <button className="btn secondary" onClick={addLine} style={{ marginTop: 10 }}>
            + Add another line
          </button>
          <div className="row" style={{ marginTop: 16, gap: 8 }}>
            <button className="btn" onClick={() => setStep(2)} disabled={!canProceed}>
              Next: verify &amp; submit
            </button>
            <button className="btn secondary" onClick={props.onCancel}>
              Cancel
            </button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <table>
            <thead>
              <tr>
                <th>Transaction Date</th>
                <th>Account</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key}>
                  <td>{l.transaction_date || "—"}</td>
                  <td>
                    {l.account_no}
                    {accountByNo.get(l.account_no) && (
                      <span className="subtitle"> · {accountByNo.get(l.account_no)!.statement_description}</span>
                    )}
                  </td>
                  <td>{fmtMoney(Number(l.amount))}</td>
                </tr>
              ))}
              <tr>
                <td></td>
                <td>
                  <b>Total</b>
                </td>
                <td>
                  <b>{fmtMoney(total)}</b>
                </td>
              </tr>
            </tbody>
          </table>
          <p className="subtitle" style={{ marginTop: 12, marginBottom: 0 }}>
            Submitting {lines.length} line{lines.length === 1 ? "" : "s"} totaling{" "}
            <b>{fmtMoney(total)}</b>. You and the treasurer will both be emailed with the details.
          </p>
          <div className="row" style={{ marginTop: 16, gap: 8 }}>
            <button className="btn" onClick={submit} disabled={submitting}>
              {submitting
                ? "Submitting…"
                : props.existing
                ? "Save changes"
                : "Submit request"}
            </button>
            <button className="btn secondary" onClick={() => setStep(1)}>
              Back
            </button>
          </div>
        </>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
