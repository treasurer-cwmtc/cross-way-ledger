import { useEffect, useState } from "react";
import { pledgeCampaignsApi, Pledge, PledgeDetail } from "../../api/pledgeCampaigns";
import { donorsApi, Donor } from "../../api/donors";
import DonorPicker from "./DonorPicker";

function fmtMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

/** Click-to-expand detail for one pledge: pledge info (and the ability to
 * fix a missed auto-match) at the top, that donor's individual gift
 * history for this fund at the bottom - the aggregate Received Amount on
 * the table row isn't enough to see date-by-date. */
export default function PledgeDetailModal({
  campaignId,
  pledge,
  hideDonorNames,
  onClose,
  onMatchChanged,
}: {
  campaignId: number;
  pledge: Pledge;
  hideDonorNames: boolean;
  onClose: () => void;
  onMatchChanged: (updated: Pledge) => void;
}) {
  const [detail, setDetail] = useState<PledgeDetail | null>(null);
  const [donors, setDonors] = useState<Donor[]>([]);
  const [error, setError] = useState("");

  function reload() {
    pledgeCampaignsApi
      .pledgeDetail(campaignId, pledge.id)
      .then(setDetail)
      .catch((err) => setError((err as Error).message));
  }

  useEffect(() => {
    reload();
    donorsApi.list().then(setDonors).catch(() => {
      /* donor lookup is best-effort here - the picker just shows fewer matches */
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pledge.id]);

  function onEsc(ev: React.KeyboardEvent) {
    if (ev.key === "Escape") onClose();
  }

  const p = detail?.pledge ?? pledge;

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
        style={{ maxWidth: 560, width: "90%", maxHeight: "85vh", overflowY: "auto" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <h3 style={{ marginTop: 0 }}>
            {hideDonorNames ? `Pledge #${p.donor_id || p.id}` : `${p.first_name} ${p.last_name}`.trim() || "Pledge"}
          </h3>
          <button className="link" onClick={onClose}>
            Close
          </button>
        </div>

        {error && <div className="error">{error}</div>}

        <div className="stats" style={{ marginBottom: 16 }}>
          <div className="stat">
            <b>{fmtMoney(p.initial_amount)}</b>
            <span>Pledged Amount</span>
          </div>
          <div className="stat">
            <b>{fmtMoney(p.actual_amount)}</b>
            <span>Received Amount</span>
          </div>
          <div className="stat">
            <b>{p.due_date || "—"}</b>
            <span>Delivery by Date</span>
          </div>
        </div>

        <table style={{ marginBottom: 16 }}>
          <tbody>
            <tr>
              <td className="subtitle">Submitted</td>
              <td>{p.date_submitted ? new Date(p.date_submitted).toLocaleDateString() : "—"}</td>
            </tr>
            <tr>
              <td className="subtitle">Donor ID</td>
              <td>{p.donor_id || "—"}</td>
            </tr>
            <tr>
              <td className="subtitle">Source file</td>
              <td>
                {p.source_file_name ? (
                  p.source_file_link ? (
                    <a href={p.source_file_link} target="_blank" rel="noreferrer">
                      {p.source_file_name}
                    </a>
                  ) : (
                    p.source_file_name
                  )
                ) : (
                  "—"
                )}
              </td>
            </tr>
            {!hideDonorNames && (
              <>
                <tr>
                  <td className="subtitle">Name</td>
                  <td>
                    {p.first_name} {p.last_name}
                  </td>
                </tr>
                <tr>
                  <td className="subtitle">Email</td>
                  <td>{p.email}</td>
                </tr>
              </>
            )}
            {!hideDonorNames && (
              <tr>
                <td className="subtitle">Matched donor</td>
                <td>
                  <DonorPicker
                    value={p.donor_id}
                    donors={donors}
                    onChange={(donorId) =>
                      pledgeCampaignsApi
                        .setPledgeMatch(campaignId, p.id, donorId)
                        .then((updated) => {
                          onMatchChanged(updated);
                          reload();
                        })
                        .catch((err) => setError((err as Error).message))
                    }
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <h4>Gift history (this fund)</h4>
        {!detail && <p className="subtitle">Loading…</p>}
        {detail && detail.gifts.length === 0 && (
          <p className="subtitle">No gift yet - this pledge hasn't been matched to a donation.</p>
        )}
        {detail && detail.gifts.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Net Amount</th>
                  <th>Method</th>
                </tr>
              </thead>
              <tbody>
                {detail.gifts.map((g) => (
                  <tr key={g.id}>
                    <td>{g.received_date || ""}</td>
                    <td>{fmtMoney(g.net_amount)}</td>
                    <td>{g.method}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
