import { useEffect, useState } from "react";
import { pledgeCampaignsApi, CampaignDetailRow } from "../../api/pledgeCampaigns";
import DetailModal from "./DetailModal";

function fmtMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

/** Combined Pledges + Actuals view: one row per pledge, plus a row for
 * anyone who gave to this fund without ever submitting a pledge form - so
 * their giving still shows up instead of only living in the raw donation
 * data. Click a row to see full detail (pledge info if there is one, gift
 * history always) or link it to a donor manually if the automatic email
 * match missed it. */
export default function Details({
  campaignId,
  hideDonorNames,
}: {
  campaignId: number;
  hideDonorNames: boolean;
}) {
  const [rows, setRows] = useState<CampaignDetailRow[] | null>(null);
  const [error, setError] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);

  function reload() {
    pledgeCampaignsApi
      .details(campaignId)
      .then(setRows)
      .catch((err) => setError((err as Error).message));
  }

  useEffect(() => {
    setRows(null);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  if (error) return <div className="error">{error}</div>;
  if (!rows) return <p className="subtitle">Loading…</p>;

  return (
    <div>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Every pledge form submission, plus anyone who gave to this fund without pledging. Click a
        row to see full detail or link it to a donor manually if the automatic email match missed
        it.
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Donor ID</th>
              {!hideDonorNames && <th>Name</th>}
              {!hideDonorNames && <th>Email</th>}
              <th>Pledged Amount</th>
              <th>Received Amount</th>
              <th>Delivery by Date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.key}
                onClick={() => setOpenKey(r.key)}
                style={{ cursor: "pointer" }}
                title={r.source_file_name ? `Imported from: ${r.source_file_name}` : undefined}
              >
                <td>{r.donor_id || "—"}</td>
                {!hideDonorNames && (
                  <td>
                    {r.first_name} {r.last_name}
                    {!r.has_pledge && !r.first_name && !r.last_name && (
                      <span className="subtitle"> (gave, no pledge on file)</span>
                    )}
                  </td>
                )}
                {!hideDonorNames && <td>{r.email}</td>}
                <td>{r.has_pledge ? fmtMoney(r.pledged_amount) : "—"}</td>
                <td>{fmtMoney(r.actual_amount)}</td>
                <td>{r.due_date || ""}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={hideDonorNames ? 4 : 6} className="subtitle">
                  No pledges or giving on file yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {openKey && (
        <DetailModal
          campaignId={campaignId}
          detailKey={openKey}
          hideDonorNames={hideDonorNames}
          onClose={() => setOpenKey(null)}
          onMatchChanged={reload}
        />
      )}
    </div>
  );
}
