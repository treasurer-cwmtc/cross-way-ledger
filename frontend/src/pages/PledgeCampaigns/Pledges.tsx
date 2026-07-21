import { useEffect, useState } from "react";
import { pledgeCampaignsApi, Pledge } from "../../api/pledgeCampaigns";
import PledgeDetailModal from "./PledgeDetailModal";

function fmtMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

export default function Pledges({
  campaignId,
  hideDonorNames,
}: {
  campaignId: number;
  hideDonorNames: boolean;
}) {
  const [pledges, setPledges] = useState<Pledge[] | null>(null);
  const [error, setError] = useState("");
  const [openPledge, setOpenPledge] = useState<Pledge | null>(null);

  function reload() {
    pledgeCampaignsApi
      .pledges(campaignId)
      .then(setPledges)
      .catch((err) => setError((err as Error).message));
  }

  useEffect(() => {
    setPledges(null);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  if (error) return <div className="error">{error}</div>;
  if (!pledges) return <p className="subtitle">Loading…</p>;

  return (
    <div>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Every pledge form submission. A pledge with "no gift yet" is normal - not everyone has
        given yet, but their submission is still tracked. Click a row to see full detail or link
        it to a donor manually if the automatic email match missed it.
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Submitted</th>
              <th>Donor ID</th>
              {!hideDonorNames && <th>Name</th>}
              {!hideDonorNames && <th>Email</th>}
              <th>Pledged Amount</th>
              <th>Received Amount</th>
              <th>Delivery by Date</th>
            </tr>
          </thead>
          <tbody>
            {pledges.map((p) => (
              <tr
                key={p.id}
                onClick={() => setOpenPledge(p)}
                style={{ cursor: "pointer" }}
              >
                <td>{p.date_submitted ? new Date(p.date_submitted).toLocaleDateString() : ""}</td>
                <td>{p.donor_id || "—"}</td>
                {!hideDonorNames && (
                  <td>
                    {p.first_name} {p.last_name}
                  </td>
                )}
                {!hideDonorNames && <td>{p.email}</td>}
                <td>{fmtMoney(p.initial_amount)}</td>
                <td>{fmtMoney(p.actual_amount)}</td>
                <td>{p.due_date || ""}</td>
              </tr>
            ))}
            {pledges.length === 0 && (
              <tr>
                <td colSpan={hideDonorNames ? 5 : 7} className="subtitle">
                  No pledges imported yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {openPledge && (
        <PledgeDetailModal
          campaignId={campaignId}
          pledge={openPledge}
          hideDonorNames={hideDonorNames}
          onClose={() => setOpenPledge(null)}
          onMatchChanged={(updated) => {
            setPledges((prev) => prev?.map((p) => (p.id === updated.id ? updated : p)) ?? prev);
            setOpenPledge(updated);
          }}
        />
      )}
    </div>
  );
}
