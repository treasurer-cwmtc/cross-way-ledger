import { useState } from "react";
import { ChartAccount } from "../../api/accounts";
import { ReimbursementAccessSummary, reimbursementsApi } from "../../api/reimbursements";
import MultiAccountPicker from "../ledger/MultiAccountPicker";

/** Popup showing (and letting you edit) everything one person is authorized
 * to submit reimbursements against - clicked from the "who has access"
 * list. Mirrors DonorDetailModal.tsx's overlay/card pattern, but unlike
 * that one this is a real editor: saving here is equivalent to re-selecting
 * this person in the People picker below and saving from there, just
 * without leaving the row you clicked. */
export default function AccessDetailModal({
  summary,
  accounts,
  onClose,
  onSaved,
}: {
  summary: ReimbursementAccessSummary;
  accounts: ChartAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [assigned, setAssigned] = useState<string[]>(summary.account_nos);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Budget accounts are planning figures, never real expenses/income - a
  // reimbursement should never be allowed to post against one (same filter
  // as the main assignment editor below).
  const assignableAccounts = accounts.filter((a) => a.category !== "Budget");

  function onEsc(ev: React.KeyboardEvent) {
    if (ev.key === "Escape") onClose();
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      await reimbursementsApi.setAssignments(summary.email, assigned);
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      onKeyDown={onEsc}
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div
        className="card"
        onClick={(ev) => ev.stopPropagation()}
        style={{ maxWidth: 600, width: "90%", maxHeight: "85vh", overflowY: "auto" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <h3 style={{ marginTop: 0 }}>{summary.name || summary.email}</h3>
          <button className="link" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="subtitle" style={{ marginTop: 0 }}>{summary.email}</p>

        <h4 style={{ marginBottom: 6 }}>Authorized Chart-of-Accounts</h4>
        <MultiAccountPicker value={assigned} accounts={assignableAccounts} onChange={setAssigned} />

        <div className="row" style={{ marginTop: 14, gap: 8 }}>
          <button className="btn" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button className="btn secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}
