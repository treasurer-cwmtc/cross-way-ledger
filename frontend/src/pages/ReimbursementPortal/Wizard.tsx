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

function emptyLine(coas: ReimbursementAssignment[]): WizardLine {
  return {
    key: nextKey++,
    account_no: coas[0]?.account_no || "",
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
      : [emptyLine(props.coas)]
  );
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const accountByNo = new Map(props.coas.map((a) => [a.account_no, a]));

  function updateLine(key: number, patch: Partial<WizardLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine(props.coas)]);
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
  const canProceed = lines.every((l) => l.account_no && Number(l.amount) > 0);

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
        await reimbursementPortalApi.updateMyRequest(props.existing.id, payload);
      } else {
        await reimbursementPortalApi.submit(payload);
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

      {step === 1 && (
        <>
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Amount</th>
                <th>Description</th>
                <th>Date</th>
                <th>Receipt</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.key}>
                  <td>
                    <AssignedAccountPicker
                      value={line.account_no}
                      accounts={props.coas}
                      onChange={(accountNo) => updateLine(line.key, { account_no: accountNo })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.amount || ""}
                      onChange={(e) => updateLine(line.key, { amount: Number(e.target.value) })}
                      style={{ width: 100 }}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={line.description}
                      onChange={(e) => updateLine(line.key, { description: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="date"
                      value={line.transaction_date || ""}
                      onChange={(e) => updateLine(line.key, { transaction_date: e.target.value })}
                    />
                  </td>
                  <td>
                    {line.receipt_file_name ? (
                      line.receipt_web_view_link ? (
                        <a href={line.receipt_web_view_link} target="_blank" rel="noreferrer">
                          {line.receipt_file_name}
                        </a>
                      ) : (
                        <span>{line.receipt_file_name}</span>
                      )
                    ) : (
                      <input
                        type="file"
                        onChange={(e) => e.target.files?.[0] && attachReceipt(line.key, e.target.files[0])}
                        disabled={line.uploading}
                      />
                    )}
                  </td>
                  <td>
                    <button className="link" onClick={() => removeLine(line.key)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
                <th>Account</th>
                <th>Date</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key}>
                  <td>
                    {l.account_no}
                    {accountByNo.get(l.account_no) && (
                      <span className="subtitle"> · {accountByNo.get(l.account_no)!.statement_description}</span>
                    )}
                  </td>
                  <td>{l.transaction_date || "—"}</td>
                  <td>{fmtMoney(Number(l.amount))}</td>
                </tr>
              ))}
              <tr>
                <td>
                  <b>Total</b>
                </td>
                <td></td>
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
