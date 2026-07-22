import { useEffect, useState } from "react";
import { donorsApi, Donor, DonorGift } from "../api/donors";
import { ColGroup, ColResizeHandle, useColumnWidths } from "../components/ColumnResize";

function fmtMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

function sourceFileCell(name: string, link: string) {
  if (!name) return "—";
  return link ? (
    <a href={link} target="_blank" rel="noreferrer">
      {name}
    </a>
  ) : (
    name
  );
}

/** Click-to-expand detail for one row on the Giving App - Donors page:
 * full profile at the top (including the joint-giver link, if any - useful
 * for spotting a household where one spouse pledges and the other gives),
 * every gift they've made across every fund at the bottom. */
export default function DonorDetailModal({ donor, onClose }: { donor: Donor; onClose: () => void }) {
  const [gifts, setGifts] = useState<DonorGift[] | null>(null);
  const [error, setError] = useState("");
  const { widths, startResize } = useColumnWidths("donor-gift-history");

  useEffect(() => {
    setGifts(null);
    donorsApi
      .gifts(donor.donor_id)
      .then(setGifts)
      .catch((err) => setError((err as Error).message));
  }, [donor.donor_id]);

  function onEsc(ev: React.KeyboardEvent) {
    if (ev.key === "Escape") onClose();
  }

  const giftTotal = gifts?.reduce((sum, g) => sum + g.net_amount, 0) ?? 0;

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
            {`${donor.first_name} ${donor.last_name}`.trim() || donor.donor_id}
          </h3>
          <button className="link" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="stats" style={{ marginBottom: 16 }}>
          <div className="stat">
            <b>{donor.donation_count}</b>
            <span># Gifts</span>
          </div>
          <div className="stat">
            <b>{fmtMoney(donor.total_given)}</b>
            <span>Lifetime Total</span>
          </div>
          <div className="stat">
            <b>{donor.first_donated || "—"}</b>
            <span>First Donated</span>
          </div>
        </div>

        <table style={{ marginBottom: 16 }}>
          <tbody>
            <tr>
              <td className="subtitle">Donor ID</td>
              <td>{donor.donor_id}</td>
            </tr>
            <tr>
              <td className="subtitle">Email</td>
              <td>{donor.email || "—"}</td>
            </tr>
            <tr>
              <td className="subtitle">Phone</td>
              <td>{donor.phone_number || "—"}</td>
            </tr>
            <tr>
              <td className="subtitle">Address</td>
              <td>
                {[donor.city, donor.state, donor.zip_code].filter(Boolean).join(", ") || "—"}
              </td>
            </tr>
            <tr>
              <td className="subtitle">Joint giver</td>
              <td>
                {donor.joint_giver_id
                  ? `${donor.joint_giver_first_name} ${donor.joint_giver_last_name}`.trim() ||
                    donor.joint_giver_id
                  : "—"}
              </td>
            </tr>
            <tr>
              <td className="subtitle">Source file</td>
              <td>{sourceFileCell(donor.source_file_name, donor.source_file_link)}</td>
            </tr>
          </tbody>
        </table>

        <h4>Gift history (every fund)</h4>
        {error && <div className="error">{error}</div>}
        {!gifts && !error && <p className="subtitle">Loading…</p>}
        {gifts && gifts.length === 0 && <p className="subtitle">No gifts recorded.</p>}
        {gifts && gifts.length > 0 && (
          <div className="table-wrap">
            <p className="subtitle" style={{ marginTop: 0 }}>
              {gifts.length} gifts, {fmtMoney(giftTotal)} total.
            </p>
            <table className="resizable-cols">
              <ColGroup
                columns={["date", "fund", "net_amount", "method", "source_file"]}
                widths={widths}
              />
              <thead>
                <tr>
                  <th>
                    Date
                    <ColResizeHandle col="date" startResize={startResize} />
                  </th>
                  <th>
                    Fund
                    <ColResizeHandle col="fund" startResize={startResize} />
                  </th>
                  <th>
                    Net Amount
                    <ColResizeHandle col="net_amount" startResize={startResize} />
                  </th>
                  <th>
                    Method
                    <ColResizeHandle col="method" startResize={startResize} />
                  </th>
                  <th>
                    Source file
                    <ColResizeHandle col="source_file" startResize={startResize} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {gifts.map((g) => (
                  <tr key={g.id}>
                    <td>{g.received_date || ""}</td>
                    <td>{g.fund}</td>
                    <td>{fmtMoney(g.net_amount)}</td>
                    <td>{g.method}</td>
                    <td>{sourceFileCell(g.source_file_name, g.source_file_link)}</td>
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
