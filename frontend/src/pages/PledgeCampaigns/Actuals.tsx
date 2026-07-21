import { useEffect, useState } from "react";
import { pledgeCampaignsApi, CampaignDonation } from "../../api/pledgeCampaigns";

function fmtMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

export default function Actuals({
  campaignId,
  fundName,
  hideDonorNames,
}: {
  campaignId: number;
  fundName: string;
  hideDonorNames: boolean;
}) {
  const [donations, setDonations] = useState<CampaignDonation[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setDonations(null);
    pledgeCampaignsApi
      .donations(campaignId)
      .then(setDonations)
      .catch((err) => setError((err as Error).message));
  }, [campaignId]);

  if (error) return <div className="error">{error}</div>;
  if (!donations) return <p className="subtitle">Loading…</p>;

  const total = donations.reduce((sum, d) => sum + d.net_amount, 0);

  return (
    <div>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Every donation imported against the "{fundName}" fund - {donations.length} gifts,{" "}
        {fmtMoney(total)} total.
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Donor ID</th>
              {!hideDonorNames && <th>Name</th>}
              {!hideDonorNames && <th>Email</th>}
              <th>Net Amount</th>
              <th>Method</th>
            </tr>
          </thead>
          <tbody>
            {donations.map((d) => (
              <tr key={d.id}>
                <td>{d.received_date || ""}</td>
                <td>{d.donor_id || "—"}</td>
                {!hideDonorNames && (
                  <td>
                    {d.donor_first_name} {d.donor_last_name}
                  </td>
                )}
                {!hideDonorNames && <td>{d.donor_email}</td>}
                <td>{fmtMoney(d.net_amount)}</td>
                <td>{d.method}</td>
              </tr>
            ))}
            {donations.length === 0 && (
              <tr>
                <td colSpan={hideDonorNames ? 4 : 6} className="subtitle">
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
