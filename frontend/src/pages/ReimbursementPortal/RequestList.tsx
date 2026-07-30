import { useEffect, useState } from "react";
import { Reimbursement, reimbursementPortalApi } from "../../api/reimbursementPortal";

function fmtMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Submitted",
  paid: "Paid",
  rejected: "Rejected",
};

const STATUS_PILL_CLASS: Record<string, string> = {
  pending: "warn",
  paid: "bank",
  rejected: "danger",
};

/** Submitter's own past/present requests, with notes - editing is only
 * offered while a request is Pending (locked once Paid - there's no
 * separate Approved step; Paid *is* the approval). */
export default function RequestList({ onEdit }: { onEdit: (r: Reimbursement) => void }) {
  const [requests, setRequests] = useState<Reimbursement[]>([]);
  const [error, setError] = useState("");

  async function load() {
    try {
      setRequests(await reimbursementPortalApi.myRequests());
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (error) return <div className="error">{error}</div>;

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>My Reimbursement Requests</h3>
      {requests.length === 0 && <p className="subtitle">No requests yet.</p>}
      {requests.map((r) => (
        <div key={r.id} style={{ borderBottom: "1px solid var(--border)", padding: "12px 0" }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <b>{r.name}</b>
                <span
                  className={"pill lg " + STATUS_PILL_CLASS[r.status]}
                  style={{ flex: "none" }}
                >
                  {STATUS_LABELS[r.status]}
                </span>
              </div>
              <div className="subtitle">
                {new Date(r.submitted_at).toLocaleDateString()} · {fmtMoney(r.total_amount)}
              </div>
            </div>
            {r.status === "pending" && (
              <button
                className="btn secondary"
                onClick={() => onEdit(r)}
                style={{ flex: "none", minWidth: 0 }}
              >
                Edit
              </button>
            )}
          </div>
          {r.notes && (
            <p className="subtitle" style={{ marginBottom: 0 }}>
              Note from treasurer: {r.notes}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
