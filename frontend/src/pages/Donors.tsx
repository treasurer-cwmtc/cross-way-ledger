import { useEffect, useMemo, useState } from "react";
import { donorsApi, Donor } from "../api/donors";
import DonorDetailModal from "./DonorDetailModal";
import { TextColumnFilter } from "../components/ColumnFilter";
import { ColGroup, ColResizeHandle, useColumnWidths } from "../components/ColumnResize";

type SortKey = "name" | "email" | "city" | "state" | "joint_giver";

function sortValue(d: Donor, key: SortKey): string | number {
  switch (key) {
    case "name":
      return `${d.first_name} ${d.last_name}`.trim();
    case "email":
      return d.email;
    case "city":
      return d.city;
    case "state":
      return d.state;
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
  const [nameFilter, setNameFilter] = useState<Set<string> | null>(null);
  const [emailFilter, setEmailFilter] = useState<Set<string> | null>(null);
  const [cityFilter, setCityFilter] = useState<Set<string> | null>(null);
  const [stateFilter, setStateFilter] = useState<Set<string> | null>(null);
  const [jointGiverFilter, setJointGiverFilter] = useState<Set<string> | null>(null);
  const { widths, startResize } = useColumnWidths("donors-list");

  useEffect(() => {
    donorsApi.list().then(setDonors).catch((err) => setError((err as Error).message));
  }, []);

  function onSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }
    );
  }

  const nameOptions = useMemo(
    () => Array.from(new Set((donors ?? []).map((d) => `${d.first_name} ${d.last_name}`.trim()))).sort(),
    [donors]
  );
  const emailOptions = useMemo(() => Array.from(new Set((donors ?? []).map((d) => d.email))).sort(), [donors]);
  const cityOptions = useMemo(() => Array.from(new Set((donors ?? []).map((d) => d.city))).sort(), [donors]);
  const stateOptions = useMemo(() => Array.from(new Set((donors ?? []).map((d) => d.state))).sort(), [donors]);
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
      const name = `${d.first_name} ${d.last_name}`.trim();
      const jointGiver = `${d.joint_giver_first_name} ${d.joint_giver_last_name}`.trim();
      if (nameFilter && !nameFilter.has(name)) return false;
      if (emailFilter && !emailFilter.has(d.email)) return false;
      if (cityFilter && !cityFilter.has(d.city)) return false;
      if (stateFilter && !stateFilter.has(d.state)) return false;
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
  }, [donors, sort, nameFilter, emailFilter, cityFilter, stateFilter, jointGiverFilter]);

  if (error) return <div className="error">{error}</div>;
  if (!donors) return <p className="subtitle">Loading…</p>;

  return (
    <div>
      <h2 className="page-title">Giving App - Donors</h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        The donor list from the Giving App, refreshed by each pledge campaign's import wizard -
        shared across any reporting that needs it. {donors.length} donors on file. Click a row for
        full detail and gift history.
      </p>

      <div className="table-wrap">
        <table className="resizable-cols">
          <ColGroup columns={["name", "email", "city", "state", "joint_giver"]} widths={widths} />
          <thead>
            <tr>
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
                <td>
                  {d.donor_id} · {d.first_name} {d.last_name}
                </td>
                <td>{d.email}</td>
                <td>{d.city}</td>
                <td>{d.state}</td>
                <td>
                  {d.joint_giver_id
                    ? `${d.joint_giver_id} · ${`${d.joint_giver_first_name} ${d.joint_giver_last_name}`.trim() || d.joint_giver_id}`
                    : ""}
                </td>
              </tr>
            ))}
            {visibleDonors.length === 0 && (
              <tr>
                <td colSpan={5} className="subtitle">
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
