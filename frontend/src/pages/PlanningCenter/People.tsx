import { useEffect, useMemo, useState } from "react";
import { PcoPerson, reimbursementsApi } from "../../api/reimbursements";
import { fmtRelative } from "../../lib/fmtRelative";
import { TextColumnFilter } from "../../components/ColumnFilter";

/** Planning Center > People - active PCO People, synced live from the
 * People API. This is the Reimbursement portal's login allowlist (see
 * PlanningCenter/ReimbursementAccess.tsx for the optional List-based
 * narrowing on top of it) - moved out of the Reimbursements page itself so
 * every PCO-sourced screen lives in one place. */
export default function PlanningCenterPeople() {
  const [people, setPeople] = useState<PcoPerson[] | null>(null);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [nameFilter, setNameFilter] = useState<Set<string> | null>(null);

  function load() {
    reimbursementsApi.listPcoPeople().then(setPeople).catch((e) => setError((e as Error).message));
    reimbursementsApi
      .getPcoPeopleLastSynced()
      .then((r) => setLastSyncedAt(r.last_synced_at))
      .catch(() => {});
  }

  useEffect(load, []);

  async function syncNow() {
    setSyncing(true);
    setError("");
    setMsg("");
    try {
      const result = await reimbursementsApi.syncPcoPeople();
      setMsg(`Synced ${result.people_imported} active people from Planning Center.`);
      setLastSyncedAt(result.last_synced_at);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  async function upload() {
    if (!file) return;
    setError("");
    setMsg("");
    try {
      const result = await reimbursementsApi.importPcoPeople(file);
      setMsg(`Imported ${result.people_imported} people.`);
      setFile(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const nameOptions = useMemo(
    () => Array.from(new Set((people ?? []).map((p) => p.name || "—"))).sort(),
    [people]
  );
  const visible = useMemo(
    () => (people ?? []).filter((p) => !nameFilter || nameFilter.has(p.name || "—")),
    [people, nameFilter]
  );

  return (
    <div>
      <h2 className="page-title">Planning Center · People</h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Active PCO People, synced live from the People API - this is the allowlist for who can
        log into the Reimbursement portal (see Reimbursement Access to narrow it to a specific
        List instead of every active person).
      </p>
      <div className="row" style={{ alignItems: "center" }}>
        <button className="btn" onClick={syncNow} disabled={syncing}>
          {syncing ? "Syncing…" : "Sync now"}
        </button>
        <span className="pill">Last synced: {fmtRelative(lastSyncedAt)}</span>
      </div>
      {msg && <div className="ok">{msg}</div>}
      {error && <div className="error">{error}</div>}

      <details style={{ marginTop: 12, marginBottom: 12 }}>
        <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--muted)" }}>
          Import from a CSV file instead (fallback if the API sync is unavailable)
        </summary>
        <div className="row" style={{ marginTop: 8 }}>
          <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <button className="btn" onClick={upload} disabled={!file}>
            Import
          </button>
        </div>
      </details>

      {!people && !error && <p className="subtitle">Loading…</p>}
      {people && (
        <div className="card">
          <div className="row" style={{ marginBottom: 8, alignItems: "center" }}>
            <span className="subtitle" style={{ margin: 0 }}>
              {people.length} people on file.
            </span>
            <TextColumnFilter label="Name" options={nameOptions} selected={nameFilter} onChange={setNameFilter} />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Phone</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr key={p.person_id}>
                    <td>{p.name}</td>
                    <td>{p.email}</td>
                    <td>{p.phone_number}</td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={3} className="subtitle">
                      No people match.
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
