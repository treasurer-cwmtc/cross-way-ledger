import { useState } from "react";
import { GivingPersonLink, pledgeCampaignsApi } from "../../api/pledgeCampaigns";
import { PcoPerson } from "../../api/reimbursements";

/** Click-to-expand detail for one row on Planning Center > Giving <-> People
 * Link - same shape as PersonDetailModal/DonorDetailModal. Also where the
 * manual override actually happens now (moved off the row itself, so the
 * table can be a plain sortable/filterable list like every other one). */
export default function GivingPeopleLinkDetailModal({
  link,
  people,
  onClose,
  onSaved,
}: {
  link: GivingPersonLink;
  people: PcoPerson[] | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [picked, setPicked] = useState(link.person_id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function onEsc(ev: React.KeyboardEvent) {
    if (ev.key === "Escape") onClose();
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      await pledgeCampaignsApi.setGivingPeopleLink(link.donor_id, picked || null);
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function clearLink() {
    setPicked("");
    setSaving(true);
    setError("");
    try {
      await pledgeCampaignsApi.setGivingPeopleLink(link.donor_id, null);
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

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
        style={{ maxWidth: 480, width: "90%", maxHeight: "85vh", overflowY: "auto" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <h3 style={{ marginTop: 0 }}>{link.donor_name || link.donor_id}</h3>
          <button className="link" onClick={onClose}>
            Close
          </button>
        </div>

        {error && <div className="error">{error}</div>}

        <table style={{ marginBottom: 16 }}>
          <tbody>
            <tr>
              <td className="subtitle">Donor ID</td>
              <td>{link.donor_id}</td>
            </tr>
            <tr>
              <td className="subtitle">Linked person</td>
              <td>{link.person_name || "— unmatched —"}</td>
            </tr>
            <tr>
              <td className="subtitle">Source</td>
              <td>
                {link.match_source === "manual"
                  ? "Manually linked"
                  : link.match_source === "auto"
                  ? "Auto-matched (shared PCO ID)"
                  : "—"}
              </td>
            </tr>
          </tbody>
        </table>

        <h4>Change link</h4>
        <p className="subtitle" style={{ marginTop: 0 }}>
          Pick this donor's People record by hand, or clear it to unlink.
        </p>
        <div className="row" style={{ alignItems: "center", gap: 8 }}>
          <select
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
            style={{ flex: 1, minWidth: 220 }}
            disabled={!people}
          >
            <option value="">— choose a person —</option>
            {(people ?? []).map((p) => (
              <option key={p.person_id} value={p.person_id}>
                {p.name} ({p.email})
              </option>
            ))}
          </select>
          <button className="btn" onClick={save} disabled={saving || !picked}>
            {saving ? "Saving…" : "Save"}
          </button>
          {link.person_id && (
            <button className="btn secondary" onClick={clearLink} disabled={saving}>
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
