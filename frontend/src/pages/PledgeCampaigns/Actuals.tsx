import { useEffect, useState } from "react";
import { pledgeCampaignsApi, CampaignDonation } from "../../api/pledgeCampaigns";
import { useCampaign } from "./useCampaign";

function fmtMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

export default function Actuals() {
  const { campaign, campaignId, error: campaignError } = useCampaign();
  const [donations, setDonations] = useState<CampaignDonation[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (campaignId == null) return;
    pledgeCampaignsApi
      .donations(campaignId)
      .then(setDonations)
      .catch((err) => setError((err as Error).message));
  }, [campaignId]);

  if (campaignError || error) return <div className="error">{campaignError || error}</div>;
  if (!campaign || !donations) return <p className="subtitle">Loading…</p>;

  const total = donations.reduce((sum, d) => sum + d.net_amount, 0);

  return (
    <div>
      <h2 className="page-title">{campaign.name} Actuals</h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Every donation imported against the "{campaign.fund_name}" fund - {donations.length} gifts,{" "}
        {fmtMoney(total)} total.
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Donor ID</th>
              <th>Amount</th>
              <th>Net Amount</th>
              <th>Method</th>
            </tr>
          </thead>
          <tbody>
            {donations.map((d) => (
              <tr key={d.id}>
                <td>{d.received_date || ""}</td>
                <td>{d.donor_id || "—"}</td>
                <td>{fmtMoney(d.amount)}</td>
                <td>{fmtMoney(d.net_amount)}</td>
                <td>{d.method}</td>
              </tr>
            ))}
            {donations.length === 0 && (
              <tr>
                <td colSpan={5} className="subtitle">
                  No donations imported yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
