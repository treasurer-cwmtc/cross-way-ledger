import { useEffect, useState } from "react";
import { pledgeCampaignsApi, Pledge } from "../../api/pledgeCampaigns";
import { donorsApi, Donor } from "../../api/donors";
import { useCampaign } from "./useCampaign";
import DonorPicker from "./DonorPicker";

function fmtMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

export default function Pledges() {
  const { campaign, campaignId, error: campaignError } = useCampaign();
  const [pledges, setPledges] = useState<Pledge[] | null>(null);
  const [donors, setDonors] = useState<Donor[]>([]);
  const [error, setError] = useState("");

  function reload(id: number) {
    pledgeCampaignsApi.pledges(id).then(setPledges).catch((err) => setError((err as Error).message));
  }

  useEffect(() => {
    if (campaignId == null) return;
    reload(campaignId);
    donorsApi.list().then(setDonors).catch(() => {
      /* donor lookup is best-effort here - the picker just shows fewer matches */
    });
  }, [campaignId]);

  if (campaignError || error) return <div className="error">{campaignError || error}</div>;
  if (!campaign || !pledges) return <p className="subtitle">Loading…</p>;

  return (
    <div>
      <h2 className="page-title">{campaign.name} Pledges</h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Every pledge form submission. A pledge with "no gift yet" is normal - not everyone has
        given yet, but their submission is still tracked. Link it to a donor manually if the
        automatic email match missed it.
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Submitted</th>
              <th>Name</th>
              <th>Email</th>
              <th>Initial Pledge</th>
              <th>Due</th>
              <th>Monthly</th>
              <th>Matched Donor</th>
              <th>Received to Date</th>
            </tr>
          </thead>
          <tbody>
            {pledges.map((p) => (
              <tr key={p.id}>
                <td>{p.date_submitted ? new Date(p.date_submitted).toLocaleDateString() : ""}</td>
                <td>
                  {p.first_name} {p.last_name}
                </td>
                <td>{p.email}</td>
                <td>{fmtMoney(p.initial_amount)}</td>
                <td>{p.due_date || ""}</td>
                <td>{fmtMoney(p.monthly_amount)}</td>
                <td>
                  <DonorPicker
                    value={p.donor_id}
                    donors={donors}
                    onChange={(donorId) =>
                      pledgeCampaignsApi
                        .setPledgeMatch(campaign.id, p.id, donorId)
                        .then(() => reload(campaign.id))
                        .catch((err) => setError((err as Error).message))
                    }
                  />
                  {p.donor_id && (
                    <span className={"match-badge " + (p.match_source === "manual" ? "matched" : "matched")}>
                      {p.match_source === "manual" ? "manually linked" : "auto-matched"}
                    </span>
                  )}
                </td>
                <td>{fmtMoney(p.actual_amount)}</td>
              </tr>
            ))}
            {pledges.length === 0 && (
              <tr>
                <td colSpan={8} className="subtitle">
                  No pledges imported yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
