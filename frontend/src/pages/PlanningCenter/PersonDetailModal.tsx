import { useEffect, useState } from "react";
import { PcoPerson, ReimbursementAssignment, reimbursementsApi } from "../../api/reimbursements";
import { GivingPersonLink, pledgeCampaignsApi } from "../../api/pledgeCampaigns";

/** Click-to-expand detail for one row on the Planning Center > People page:
 * full profile at the top, plus the two things elsewhere in the app that
 * key off this same person_id/email - which Chart-of-Accounts they can
 * submit reimbursements against, and whether they're linked to a Giving
 * donor record (see pco_giving_people_link) - so a treasurer can see
 * everything about this person without hunting across three pages. Same
 * click-a-row-for-detail shape as DonorDetailModal. */
export default function PersonDetailModal({ person, onClose }: { person: PcoPerson; onClose: () => void }) {
  const [assignments, setAssignments] = useState<ReimbursementAssignment[] | null>(null);
  const [assignmentsError, setAssignmentsError] = useState("");
  const [givingLink, setGivingLink] = useState<GivingPersonLink | null | undefined>(undefined);
  const [givingError, setGivingError] = useState("");

  useEffect(() => {
    setAssignments(null);
    setAssignmentsError("");
    if (!person.email) {
      setAssignments([]);
      return;
    }
    reimbursementsApi
      .getAssignments(person.email)
      .then(setAssignments)
      .catch((err) => setAssignmentsError((err as Error).message));
  }, [person.email]);

  useEffect(() => {
    setGivingLink(undefined);
    setGivingError("");
    pledgeCampaignsApi
      .listGivingPeopleLinks()
      .then((links) => setGivingLink(links.find((l) => l.person_id === person.person_id) ?? null))
      .catch((err) => setGivingError((err as Error).message));
  }, [person.person_id]);

  function onEsc(ev: React.KeyboardEvent) {
    if (ev.key === "Escape") onClose();
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
        style={{ maxWidth: 520, width: "90%", maxHeight: "85vh", overflowY: "auto" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <h3 style={{ marginTop: 0 }}>{person.name || person.person_id}</h3>
          <button className="link" onClick={onClose}>
            Close
          </button>
        </div>

        <table style={{ marginBottom: 16 }}>
          <tbody>
            <tr>
              <td className="subtitle">Person ID</td>
              <td>{person.person_id}</td>
            </tr>
            <tr>
              <td className="subtitle">Status</td>
              <td>
                <span className={"pill" + (person.status === "active" ? " bank" : "")}>
                  {person.status ? person.status.charAt(0).toUpperCase() + person.status.slice(1) : "—"}
                </span>
              </td>
            </tr>
            <tr>
              <td className="subtitle">Email</td>
              <td>{person.email || "—"}</td>
            </tr>
            <tr>
              <td className="subtitle">Phone</td>
              <td>{person.phone_number || "—"}</td>
            </tr>
          </tbody>
        </table>

        <h4 style={{ marginBottom: 8 }}>Reimbursement access</h4>
        {person.status !== "active" && (
          <p className="subtitle" style={{ marginTop: 0 }}>
            Status isn't "Active" - can't log into the portal regardless of any assignments below.
          </p>
        )}
        {assignmentsError && <div className="error">{assignmentsError}</div>}
        {!assignments && !assignmentsError && <p className="subtitle">Loading…</p>}
        {assignments && assignments.length === 0 && (
          <p className="subtitle">No Chart-of-Accounts assignments - can't submit reimbursements yet.</p>
        )}
        {assignments && assignments.length > 0 && (
          <ul style={{ margin: "0 0 16px", paddingLeft: 20 }}>
            {assignments.map((a) => (
              <li key={a.account_no}>
                {a.account_no} · {a.statement_description}
              </li>
            ))}
          </ul>
        )}

        <h4 style={{ marginBottom: 8 }}>Giving App link</h4>
        {givingError && <div className="error">{givingError}</div>}
        {givingLink === undefined && !givingError && <p className="subtitle">Loading…</p>}
        {givingLink === null && (
          <p className="subtitle">Not linked to a Giving donor record.</p>
        )}
        {givingLink && (
          <p className="subtitle" style={{ marginTop: 0 }}>
            Linked to donor {givingLink.donor_name || givingLink.donor_id} (
            {givingLink.match_source === "manual" ? "manually linked" : "auto-linked"}) - see
            Planning Center &gt; Donors for gift history.
          </p>
        )}
      </div>
    </div>
  );
}
