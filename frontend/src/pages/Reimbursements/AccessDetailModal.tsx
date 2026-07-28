import { ChartAccount } from "../../api/accounts";
import { ReimbursementAccessSummary } from "../../api/reimbursements";

/** Read-only popup showing everything one person is authorized to submit
 * reimbursements against - clicked from the "who has access" list.
 * Mirrors DonorDetailModal.tsx's overlay/card pattern. */
export default function AccessDetailModal({
  summary,
  accounts,
  onClose,
}: {
  summary: ReimbursementAccessSummary;
  accounts: ChartAccount[];
  onClose: () => void;
}) {
  const accountByNo = new Map(accounts.map((a) => [a.account_no, a]));

  function onEsc(ev: React.KeyboardEvent) {
    if (ev.key === "Escape") onClose();
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
        style={{ maxWidth: 480, width: "90%", maxHeight: "85vh", overflowY: "auto" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <h3 style={{ marginTop: 0 }}>{summary.name || summary.email}</h3>
          <button className="link" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="subtitle" style={{ marginTop: 0 }}>{summary.email}</p>

        <h4 style={{ marginBottom: 6 }}>Authorized Chart-of-Accounts</h4>
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {summary.account_nos.map((no) => (
              <tr key={no}>
                <td>{no}</td>
                <td>{accountByNo.get(no)?.statement_description || "—"}</td>
              </tr>
            ))}
            {summary.account_nos.length === 0 && (
              <tr>
                <td colSpan={2} className="subtitle">
                  No accounts assigned.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
