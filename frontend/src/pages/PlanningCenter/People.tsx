import { useEffect, useMemo, useState } from "react";
import { PcoPerson, reimbursementsApi } from "../../api/reimbursements";
import { fmtRelative } from "../../lib/fmtRelative";
import { TextColumnFilter } from "../../components/ColumnFilter";
import { ColGroup, ColResizeHandle, useColumnWidths } from "../../components/ColumnResize";
import PersonDetailModal from "./PersonDetailModal";

type SortKey = "name" | "email" | "phone_number" | "status";

function sortValue(p: PcoPerson, key: SortKey): string {
  switch (key) {
    case "name":
      return p.name || "";
    case "email":
      return p.email || "";
    case "phone_number":
      return p.phone_number || "";
    case "status":
      return p.status || "";
  }
}

function statusLabel(status: string): string {
  if (!status) return "—";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function SortableHeader({
  label,
  sortKey,
  activeSort,
  onSort,
  filter,
  resizeHandle,
}: {
  label: string;
  sortKey: SortKey;
  activeSort: { key: SortKey | null; dir: "asc" | "desc" };
  onSort: (key: SortKey) => void;
  filter?: React.ReactNode;
  resizeHandle?: React.ReactNode;
}) {
  const active = activeSort.key === sortKey;
  return (
    <th>
      <span
        onClick={() => onSort(sortKey)}
        style={{ cursor: "pointer", userSelect: "none", display: "inline-flex", alignItems: "center", gap: 4 }}
      >
        {label}
        <span style={{ fontSize: 10, color: active ? "var(--primary)" : "var(--muted)" }}>
          {active ? (activeSort.dir === "asc" ? "▲" : "▼") : "⇅"}
        </span>
      </span>
      {filter}
      {resizeHandle}
    </th>
  );
}

/** Planning Center > People - every PCO Person, synced live from the People
 * API (any status - "active" is just one value the new Status column can
 * show). Only "active" people can log into the Reimbursement portal (see
 * PlanningCenter/ReimbursementAccess.tsx for the optional List-based
 * narrowing on top of that) - moved out of the Reimbursements page itself
 * so every PCO-sourced screen lives in one place. Every column sorts by
 * clicking its header and gets a checklist filter of distinct values, same
 * as Donors.tsx; click a row to see that person's full detail (see
 * PersonDetailModal). */
export default function PlanningCenterPeople() {
  const [people, setPeople] = useState<PcoPerson[] | null>(null);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [openPerson, setOpenPerson] = useState<PcoPerson | null>(null);
  const [sort, setSort] = useState<{ key: SortKey | null; dir: "asc" | "desc" }>({
    key: "name",
    dir: "asc",
  });
  const [nameFilter, setNameFilter] = useState<Set<string> | null>(null);
  const [emailFilter, setEmailFilter] = useState<Set<string> | null>(null);
  const [phoneFilter, setPhoneFilter] = useState<Set<string> | null>(null);
  const [statusFilter, setStatusFilter] = useState<Set<string> | null>(null);
  const { widths, startResize } = useColumnWidths("pco-people-list");

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
      setMsg(`Synced ${result.people_imported} people from Planning Center.`);
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

  function onSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }
    );
  }

  const nameOptions = useMemo(
    () => Array.from(new Set((people ?? []).map((p) => p.name || "—"))).sort(),
    [people]
  );
  const emailOptions = useMemo(
    () => Array.from(new Set((people ?? []).map((p) => p.email || "—"))).sort(),
    [people]
  );
  const phoneOptions = useMemo(
    () => Array.from(new Set((people ?? []).map((p) => p.phone_number || "—"))).sort(),
    [people]
  );
  const statusOptions = useMemo(
    () => Array.from(new Set((people ?? []).map((p) => statusLabel(p.status)))).sort(),
    [people]
  );

  const visible = useMemo(() => {
    if (!people) return [];
    let out = people.filter((p) => {
      if (nameFilter && !nameFilter.has(p.name || "—")) return false;
      if (emailFilter && !emailFilter.has(p.email || "—")) return false;
      if (phoneFilter && !phoneFilter.has(p.phone_number || "—")) return false;
      if (statusFilter && !statusFilter.has(statusLabel(p.status))) return false;
      return true;
    });
    if (sort.key) {
      const key = sort.key;
      out = [...out].sort((a, b) => {
        const res = sortValue(a, key).localeCompare(sortValue(b, key));
        return sort.dir === "asc" ? res : -res;
      });
    }
    return out;
  }, [people, sort, nameFilter, emailFilter, phoneFilter, statusFilter]);

  return (
    <div>
      <h2 className="page-title">Planning Center · People</h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Every PCO Person, synced live from the People API. Only people with status "Active" can
        log into the Reimbursement portal (see Reimbursement Access to narrow that further to a
        specific List). Click a row for full detail.
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
          </div>
          <div className="table-wrap">
            <table className="resizable-cols">
              <ColGroup columns={["name", "email", "phone_number", "status"]} widths={widths} />
              <thead>
                <tr>
                  <SortableHeader
                    label="Name"
                    sortKey="name"
                    activeSort={sort}
                    onSort={onSort}
                    filter={
                      <TextColumnFilter
                        label="Name"
                        options={nameOptions}
                        selected={nameFilter}
                        onChange={setNameFilter}
                      />
                    }
                    resizeHandle={<ColResizeHandle col="name" startResize={startResize} />}
                  />
                  <SortableHeader
                    label="Email"
                    sortKey="email"
                    activeSort={sort}
                    onSort={onSort}
                    filter={
                      <TextColumnFilter
                        label="Email"
                        options={emailOptions}
                        selected={emailFilter}
                        onChange={setEmailFilter}
                      />
                    }
                    resizeHandle={<ColResizeHandle col="email" startResize={startResize} />}
                  />
                  <SortableHeader
                    label="Phone"
                    sortKey="phone_number"
                    activeSort={sort}
                    onSort={onSort}
                    filter={
                      <TextColumnFilter
                        label="Phone"
                        options={phoneOptions}
                        selected={phoneFilter}
                        onChange={setPhoneFilter}
                      />
                    }
                    resizeHandle={<ColResizeHandle col="phone_number" startResize={startResize} />}
                  />
                  <SortableHeader
                    label="Status"
                    sortKey="status"
                    activeSort={sort}
                    onSort={onSort}
                    filter={
                      <TextColumnFilter
                        label="Status"
                        options={statusOptions}
                        selected={statusFilter}
                        onChange={setStatusFilter}
                      />
                    }
                    resizeHandle={<ColResizeHandle col="status" startResize={startResize} />}
                  />
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr key={p.person_id} onClick={() => setOpenPerson(p)} style={{ cursor: "pointer" }}>
                    <td>{p.name}</td>
                    <td>{p.email}</td>
                    <td>{p.phone_number}</td>
                    <td>
                      <span className={"pill" + (p.status === "active" ? " bank" : "")}>
                        {statusLabel(p.status)}
                      </span>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={4} className="subtitle">
                      {people.length === 0 ? "No people on file." : "No people match the current filters."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {openPerson && <PersonDetailModal person={openPerson} onClose={() => setOpenPerson(null)} />}
    </div>
  );
}
