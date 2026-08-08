import { useEffect, useMemo, useState } from "react";
import { GivingPersonLink, pledgeCampaignsApi } from "../../api/pledgeCampaigns";
import { PcoPerson, reimbursementsApi } from "../../api/reimbursements";

/** Planning Center > Giving <-> People Link - PCO's Giving and People APIs
 * already share one organization-wide person ID space, so most Giving
 * donors auto-link to their People record on every Donor sync (matching
 * donor_id straight to person_id). This page surfaces that mapping and
 * lets a treasurer manually link a donor that didn't auto-match (e.g. a
 * guest/one-time online giver who was never a synced Person). Visibility/
 * override only - nothing else in the app reads this mapping yet. */
export default function GivingPeopleLink() {
  const [links, setLinks] = useState<GivingPersonLink[] | null>(null);
  const [people, setPeople] = useState<PcoPerson[] | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [onlyUnmatched, setOnlyUnmatched] = useState(true);
  const [editingDonorId, setEditingDonorId] = useState<string | null>(null);
  const [picked, setPicked] = useState("");

  function load() {
    setError("");
    pledgeCampaignsApi.listGivingPeopleLinks().then(setLinks).catch((e) => setError((e as Error).message));
    reimbursementsApi.listPcoPeople().then(setPeople).catch((e) => setError((e as Error).message));
  }

  useEffect(load, []);

  const visible = useMemo(
    () => (links ?? []).filter((l) => !onlyUnmatched || !l.match_source),
    [links, onlyUnmatched]
  );

  async function saveLink(donorId: string) {
    setError("");
    setMsg("");
    try {
      await pledgeCampaignsApi.setGivingPeopleLink(donorId, picked || null);
      setEditingDonorId(null);
      setPicked("");
      setMsg("Link saved.");
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <h2 className="page-title">Planning Center · Giving ↔ People Link</h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Most Giving donors auto-link to their People record (Planning Center shares one ID space
        between the two). Anyone left unmatched here - usually a guest or one-time online giver -
        can be linked by hand.
      </p>

      {error && <div className="error">{error}</div>}
      {msg && <div className="ok">{msg}</div>}

      <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <input type="checkbox" checked={onlyUnmatched} onChange={(e) => setOnlyUnmatched(e.target.checked)} />
        Show only unmatched donors
      </label>

      {!links && !error && <p className="subtitle">Loading…</p>}
      {links && (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Donor</th>
                  <th>Linked Person</th>
                  <th>Source</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((l) => (
                  <tr key={l.donor_id}>
                    <td>{l.donor_name || l.donor_id}</td>
                    <td>{l.person_name || "— unmatched —"}</td>
                    <td>{l.match_source ?? ""}</td>
                    <td>
                      {editingDonorId === l.donor_id ? (
                        <span className="row" style={{ gap: 6 }}>
                          <select value={picked} onChange={(e) => setPicked(e.target.value)}>
                            <option value="">— choose a person —</option>
                            {(people ?? []).map((p) => (
                              <option key={p.person_id} value={p.person_id}>
                                {p.name} ({p.email})
                              </option>
                            ))}
                          </select>
                          <button className="link" onClick={() => saveLink(l.donor_id)} disabled={!picked}>
                            Save
                          </button>
                          <button className="link" onClick={() => setEditingDonorId(null)}>
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          className="link"
                          onClick={() => {
                            setEditingDonorId(l.donor_id);
                            setPicked(l.person_id ?? "");
                          }}
                        >
                          {l.match_source === "manual" ? "Change" : "Link…"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={4} className="subtitle">
                      {onlyUnmatched ? "Every donor is linked." : "No donors on file."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
