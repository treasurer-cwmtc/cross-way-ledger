import { useEffect, useMemo, useState } from "react";
import { donorsApi, Donor } from "../api/donors";
import { pledgeCampaignsApi } from "../api/pledgeCampaigns";
import DonorDetailModal from "./DonorDetailModal";
import { TextColumnFilter } from "../components/ColumnFilter";
import { ColGroup, ColResizeHandle, useColumnWidths } from "../components/ColumnResize";
import { fmtRelative } from "../lib/fmtRelative";

type SortKey = "donor_id" | "name" | "email" | "city" | "state" | "joint_giver_id" | "joint_giver";

function sortValue(d: Donor, key: SortKey): string | number {
  switch (key) {
    case "donor_id":
      return d.donor_id || "";
    case "name":
      return `${d.first_name} ${d.last_name}`.trim();
    case "email":
      return d.email;
    case "city":
      return d.city;
    case "state":
      return d.state;
    case "joint_giver_id":
      return d.joint_giver_id || "";
    case "joint_giver":
      return `${d.joint_giver_first_name} ${d.joint_giver_last_name}`.trim();
  }
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

/** The persistent Giving App donor list - "Giving App - Donors" under
 * Setup. Reusable for any reporting, not tied to a single pledge campaign;
 * kept read-only since it's refreshed via each campaign's import wizard
 * rather than hand-edited here. Every column sorts by clicking its header;
 * Name/Email/City/State/Joint Giver get a checklist filter of distinct
 * values. Click a row to see the donor's full profile and gift history
 * across every fund. */
export default function Donors() {
  const [donors, setDonors] = useState<Donor[] | null>(null);
  const [error, setError] = useState("");
  const [openDonor, setOpenDonor] = useState<Donor | null>(null);
  const [sort, setSort] = useState<{ key: SortKey | null; dir: "asc" | "desc" }>({
    key: "name",
    dir: "asc",
  });
  const [donorIdFilter, setDonorIdFilter] = useState<Set<string> | null>(null);
  const [nameFilter, setNameFilter] = useState<Set<string> | null>(null);
  const [emailFilter, setEmailFilter] = useState<Set<string> | null>(null);
  const [cityFilter, setCityFilter] = useState<Set<string> | null>(null);
  const [stateFilter, setStateFilter] = useState<Set<string> | null>(null);
  const [jointGiverIdFilter, setJointGiverIdFilter] = useState<Set<string> | null>(null);
  const [jointGiverFilter, setJointGiverFilter] = useState<Set<string> | null>(null);
  const { widths, startResize } = useColumnWidths("donors-list");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  function load() {
    donorsApi.list().then(setDonors).catch((err) => setError((err as Error).message));
    pledgeCampaignsApi.getDonorsLastSynced().then((r) => setLastSyncedAt(r.last_synced_at)).catch(() => {});
  }

  useEffect(load, []);

  async function syncNow() {
    setSyncing(true);
    setError("");
    setSyncMsg("");
    try {
      const result = await pledgeCampaignsApi.syncDonors();
      setSyncMsg(`Synced ${result.donors_imported} donors (${result.pledges_matched} pledges matched).`);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  function onSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }
    );
  }

  const donorIdOptions = useMemo(
    () => Array.from(new Set((donors ?? []).map((d) => d.donor_id || "—"))).sort(),
    [donors]
  );
  const nameOptions = useMemo(
    () => Array.from(new Set((donors ?? []).map((d) => `${d.first_name} ${d.last_name}`.trim()))).sort(),
    [donors]
  );
  const emailOptions = useMemo(() => Array.from(new Set((donors ?? []).map((d) => d.email))).sort(), [donors]);
  const cityOptions = useMemo(() => Array.from(new Set((donors ?? []).map((d) => d.city))).sort(), [donors]);
  const stateOptions = useMemo(() => Array.from(new Set((donors ?? []).map((d) => d.state))).sort(), [donors]);
  const jointGiverIdOptions = useMemo(
    () => Array.from(new Set((donors ?? []).map((d) => d.joint_giver_id || "—"))).sort(),
    [donors]
  );
  const jointGiverOptions = useMemo(
    () =>
      Array.from(
        new Set((donors ?? []).map((d) => `${d.joint_giver_first_name} ${d.joint_giver_last_name}`.trim()))
      ).sort(),
    [donors]
  );

  const visibleDonors = useMemo(() => {
    if (!donors) return [];
    let out = donors.filter((d) => {
      const donorId = d.donor_id || "—";
      const name = `${d.first_name} ${d.last_name}`.trim();
      const jointGiverId = d.joint_giver_id || "—";
      const jointGiver = `${d.joint_giver_first_name} ${d.joint_giver_last_name}`.trim();
      if (donorIdFilter && !donorIdFilter.has(donorId)) return false;
      if (nameFilter && !nameFilter.has(name)) return false;
      if (emailFilter && !emailFilter.has(d.email)) return false;
      if (cityFilter && !cityFilter.has(d.city)) return false;
      if (stateFilter && !stateFilter.has(d.state)) return false;
      if (jointGiverIdFilter && !jointGiverIdFilter.has(jointGiverId)) return false;
      if (jointGiverFilter && !jointGiverFilter.has(jointGiver)) return false;
      return true;
    });
    if (sort.key) {
      const key = sort.key;
      out = [...out].sort((a, b) => {
        const av = sortValue(a, key);
        const bv = sortValue(b, key);
        const res =
          typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
        return sort.dir === "asc" ? res : -res;
      });
    }
    return out;
  }, [
    donors,
    sort,
    donorIdFilter,
    nameFilter,
    emailFilter,
    cityFilter,
    stateFilter,
    jointGiverIdFilter,
    jointGiverFilter,
  ]);

  if (error) return <div className="error">{error}</div>;
  if (!donors) return <p className="subtitle">Loading…</p>;

  return (
    <div>
      <h2 className="page-title">Planning Center · Donors</h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        The donor list from the Giving App, synced live - shared across any reporting that needs
        it. {donors.length} donors on file. Click a row for full detail and gift history.
      </p>
      <div className="toolbar">
        <button className="btn" onClick={syncNow} disabled={syncing}>
          {syncing ? "Syncing…" : "Sync now"}
        </button>
        <span className="pill">Last synced: {fmtRelative(lastSyncedAt)}</span>
      </div>
      {syncMsg && <div className="ok">{syncMsg}</div>}

      <div className="table-wrap">
        <table className="resizable-cols">
          <ColGroup
            columns={["donor_id", "name", "email", "city", "state", "joint_giver_id", "joint_giver"]}
            widths={widths}
          />
          <thead>
            <tr>
              <SortableHeader
                label="Donor ID"
                sortKey="donor_id"
                activeSort={sort}
                onSort={onSort}
                filter={
                  <TextColumnFilter
                    label="Donor ID"
                    options={donorIdOptions}
                    selected={donorIdFilter}
                    onChange={setDonorIdFilter}
                  />
                }
                resizeHandle={<ColResizeHandle col="donor_id" startResize={startResize} />}
              />
              <SortableHeader
                label="Name"
                sortKey="name"
                activeSort={sort}
                onSort={onSort}
                filter={
                  <TextColumnFilter label="Name" options={nameOptions} selected={nameFilter} onChange={setNameFilter} />
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
                label="City"
                sortKey="city"
                activeSort={sort}
                onSort={onSort}
                filter={
                  <TextColumnFilter label="City" options={cityOptions} selected={cityFilter} onChange={setCityFilter} />
                }
                resizeHandle={<ColResizeHandle col="city" startResize={startResize} />}
              />
              <SortableHeader
                label="State"
                sortKey="state"
                activeSort={sort}
                onSort={onSort}
                filter={
                  <TextColumnFilter
                    label="State"
                    options={stateOptions}
                    selected={stateFilter}
                    onChange={setStateFilter}
                  />
                }
                resizeHandle={<ColResizeHandle col="state" startResize={startResize} />}
              />
              <SortableHeader
                label="Joint Giver ID"
                sortKey="joint_giver_id"
                activeSort={sort}
                onSort={onSort}
                filter={
                  <TextColumnFilter
                    label="Joint Giver ID"
                    options={jointGiverIdOptions}
                    selected={jointGiverIdFilter}
                    onChange={setJointGiverIdFilter}
                  />
                }
                resizeHandle={<ColResizeHandle col="joint_giver_id" startResize={startResize} />}
              />
              <SortableHeader
                label="Joint Giver"
                sortKey="joint_giver"
                activeSort={sort}
                onSort={onSort}
                filter={
                  <TextColumnFilter
                    label="Joint Giver"
                    options={jointGiverOptions}
                    selected={jointGiverFilter}
                    onChange={setJointGiverFilter}
                  />
                }
                resizeHandle={<ColResizeHandle col="joint_giver" startResize={startResize} />}
              />
            </tr>
          </thead>
          <tbody>
            {visibleDonors.map((d) => (
              <tr key={d.donor_id} onClick={() => setOpenDonor(d)} style={{ cursor: "pointer" }}>
                <td>{d.donor_id || "—"}</td>
                <td>
                  {d.first_name} {d.last_name}
                </td>
                <td>{d.email}</td>
                <td>{d.city}</td>
                <td>{d.state}</td>
                <td>{d.joint_giver_id || ""}</td>
                <td>{`${d.joint_giver_first_name} ${d.joint_giver_last_name}`.trim()}</td>
              </tr>
            ))}
            {visibleDonors.length === 0 && (
              <tr>
                <td colSpan={7} className="subtitle">
                  {donors.length === 0 ? "No donors on file." : "No donors match the current filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {openDonor && <DonorDetailModal donor={openDonor} onClose={() => setOpenDonor(null)} />}
    </div>
  );
}
