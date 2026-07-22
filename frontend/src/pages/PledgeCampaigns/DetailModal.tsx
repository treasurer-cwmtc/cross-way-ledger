import { useEffect, useState } from "react";
import { pledgeCampaignsApi, CampaignDetail } from "../../api/pledgeCampaigns";
import { donorsApi, Donor } from "../../api/donors";
import DonorPicker from "./DonorPicker";
import PledgePicker, { PledgeOption } from "./PledgePicker";
import { ColGroup, ColResizeHandle, useColumnWidths } from "../../components/ColumnResize";

function fmtMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

/** Click-to-expand detail for one Details-tab row: pledge info (and the
 * ability to fix a missed auto-match) at the top when this row has a
 * pledge, that donor's individual gift history for this fund at the
 * bottom always - the aggregate Received Amount on the table row isn't
 * enough to see date-by-date. A row with no pledge (someone who gave
 * without ever submitting a pledge form) just skips the top section. */
export default function DetailModal({
  campaignId,
  detailKey,
  hideDonorNames,
  pledgeOptions,
  onClose,
  onMatchChanged,
}: {
  campaignId: number;
  detailKey: string;
  hideDonorNames: boolean;
  pledgeOptions: PledgeOption[];
  onClose: () => void;
  onMatchChanged: () => void;
}) {
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [donors, setDonors] = useState<Donor[]>([]);
  const [error, setError] = useState("");
  const { widths, startResize } = useColumnWidths("campaign-detail-gifts");

  function reload() {
    pledgeCampaignsApi
      .detail(campaignId, detailKey)
      .then(setDetail)
      .catch((err) => setError((err as Error).message));
  }

  useEffect(() => {
    setDetail(null);
    reload();
    donorsApi.list().then(setDonors).catch(() => {
      /* donor lookup is best-effort here - the picker just shows fewer matches */
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailKey]);

  function onEsc(ev: React.KeyboardEvent) {
    if (ev.key === "Escape") onClose();
  }

  if (error) {
    return (
      <div className="modal-overlay" onClick={onClose} role="presentation" style={overlayStyle}>
        <div className="card" onClick={(ev) => ev.stopPropagation()} style={cardStyle}>
          <div className="error">{error}</div>
          <button className="link" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="modal-overlay" onClick={onClose} role="presentation" style={overlayStyle}>
        <div className="card" onClick={(ev) => ev.stopPropagation()} style={cardStyle}>
          <p className="subtitle">Loading…</p>
        </div>
      </div>
    );
  }

  const p = detail.pledge;
  const giftTotal = detail.gifts.reduce((sum, g) => sum + g.net_amount, 0);
  // Only worth its own column when gifts could actually come from more than
  // one person - i.e. the joint-giver fold is in effect for this pledge.
  const showGiverColumn = !hideDonorNames && !!detail.joint_giver_id;
  const title = hideDonorNames
    ? `Donor #${detail.donor_id || "?"}`
    : `${detail.first_name} ${detail.last_name}`.trim() || "Giving detail";

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      onKeyDown={onEsc}
      role="presentation"
      style={overlayStyle}
    >
      <div className="card" onClick={(ev) => ev.stopPropagation()} style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <h3 style={{ marginTop: 0 }}>{title}</h3>
          <button className="link" onClick={onClose}>
            Close
          </button>
        </div>

        {p ? (
          <>
            <div className="stats" style={{ marginBottom: 16 }}>
              <div className="stat">
                <b>{fmtMoney(p.initial_amount)}</b>
                <span>Pledged Amount</span>
              </div>
              <div className="stat">
                <b>{fmtMoney(giftTotal)}</b>
                <span>Received Amount</span>
                {detail.joint_giver_id && !hideDonorNames && (
                  <span className="subtitle">
                    {" "}
                    (includes giving from joint giver:{" "}
                    {`${detail.joint_giver_first_name} ${detail.joint_giver_last_name}`.trim() ||
                      detail.joint_giver_id}
                    )
                  </span>
                )}
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
                  <td>{sourceFileCell(p.source_file_name, p.source_file_link)}</td>
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
                    <tr>
                      <td className="subtitle">Joint giver</td>
                      <td>
                        {detail.joint_giver_id
                          ? `${detail.joint_giver_first_name} ${detail.joint_giver_last_name}`.trim() ||
                            detail.joint_giver_id
                          : "—"}
                      </td>
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
                            .then(() => {
                              onMatchChanged();
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
          </>
        ) : (
          <div style={{ marginBottom: 16 }}>
            <p className="subtitle" style={{ marginTop: 0 }}>
              No pledge on file - this giving isn't tied to a pledge form submission.
            </p>
            {detail.donor_id && !hideDonorNames && (
              <label className="field">
                <span>Link this giving to a pledge (in case the automatic match missed it)</span>
                <PledgePicker
                  options={pledgeOptions}
                  onChange={(pledgeId) =>
                    pledgeCampaignsApi
                      .setPledgeMatch(campaignId, pledgeId, detail.donor_id)
                      .then(() => {
                        onMatchChanged();
                        onClose();
                      })
                      .catch((err) => setError((err as Error).message))
                  }
                />
              </label>
            )}
          </div>
        )}

        <h4>Gift history (this fund)</h4>
        {detail.gifts.length === 0 && (
          <p className="subtitle">No gifts recorded.</p>
        )}
        {detail.gifts.length > 0 && (
          <div className="table-wrap">
            <table className="resizable-cols">
              <ColGroup
                columns={[
                  "date",
                  ...(showGiverColumn ? ["giver"] : []),
                  "net_amount",
                  "method",
                  "source_file",
                ]}
                widths={widths}
              />
              <thead>
                <tr>
                  <th>
                    Date
                    <ColResizeHandle col="date" startResize={startResize} />
                  </th>
                  {showGiverColumn && (
                    <th>
                      Giver
                      <ColResizeHandle col="giver" startResize={startResize} />
                    </th>
                  )}
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
                {detail.gifts.map((g) => (
                  <tr key={g.id}>
                    <td>{g.received_date || ""}</td>
                    {showGiverColumn && (
                      <td>{`${g.donor_first_name} ${g.donor_last_name}`.trim() || g.donor_id || "—"}</td>
                    )}
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

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 50,
};

const cardStyle: React.CSSProperties = {
  maxWidth: 560,
  width: "90%",
  maxHeight: "85vh",
  overflowY: "auto",
};
