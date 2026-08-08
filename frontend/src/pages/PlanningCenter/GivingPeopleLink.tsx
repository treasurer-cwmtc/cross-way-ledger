import { useEffect, useMemo, useState } from "react";
import { GivingPersonLink, pledgeCampaignsApi } from "../../api/pledgeCampaigns";
import { PcoPerson, reimbursementsApi } from "../../api/reimbursements";
import { TextColumnFilter } from "../../components/ColumnFilter";
import { ColGroup, ColResizeHandle, useColumnWidths } from "../../components/ColumnResize";
import GivingPeopleLinkDetailModal from "./GivingPeopleLinkDetailModal";

type SortKey = "donor_name" | "person_name" | "match_source";

function sourceLabel(l: GivingPersonLink): string {
  if (l.match_source === "manual") return "Manual";
  if (l.match_source === "auto") return "Auto";
  return "Unmatched";
}

function sortValue(l: GivingPersonLink, key: SortKey): string {
  switch (key) {
    case "donor_name":
      return l.donor_name || l.donor_id;
    case "person_name":
      return l.person_name || "";
    case "match_source":
      return sourceLabel(l);
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

/** Planning Center > Giving <-> People Link - PCO's Giving and People APIs
 * already share one organization-wide person ID space, so most Giving
 * donors auto-link to their People record on every Donor sync (matching
 * donor_id straight to person_id). This page surfaces that mapping and
 * lets a treasurer manually link a donor that didn't auto-match (e.g. a
 * guest/one-time online giver who was never a synced Person). Visibility/
 * override only - nothing else in the app reads this mapping yet.
 * Sortable/filterable columns, click a row for detail - same standard as
 * every other table in the app (People.tsx, Donors.tsx, Stripe, etc.); the
 * manual-link picker lives in the detail modal now instead of inline. */
export default function GivingPeopleLink() {
  const [links, setLinks] = useState<GivingPersonLink[] | null>(null);
  const [people, setPeople] = useState<PcoPerson[] | null>(null);
  const [error, setError] = useState("");
  const [onlyUnmatched, setOnlyUnmatched] = useState(false);
  const [openLink, setOpenLink] = useState<GivingPersonLink | null>(null);

  const [sort, setSort] = useState<{ key: SortKey | null; dir: "asc" | "desc" }>({
    key: "donor_name",
    dir: "asc",
  });
  const [donorFilter, setDonorFilter] = useState<Set<string> | null>(null);
  const [personFilter, setPersonFilter] = useState<Set<string> | null>(null);
  const [sourceFilter, setSourceFilter] = useState<Set<string> | null>(null);
  const { widths, startResize } = useColumnWidths("pco-giving-people-link");

  function load() {
    setError("");
    pledgeCampaignsApi.listGivingPeopleLinks().then(setLinks).catch((e) => setError((e as Error).message));
    reimbursementsApi.listPcoPeople().then(setPeople).catch((e) => setError((e as Error).message));
  }

  useEffect(load, []);

  function onSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }
    );
  }

  const donorOptions = useMemo(
    () => Array.from(new Set((links ?? []).map((l) => l.donor_name || l.donor_id))).sort(),
    [links]
  );
  const personOptions = useMemo(
    () => Array.from(new Set((links ?? []).map((l) => l.person_name || "— unmatched —"))).sort(),
    [links]
  );
  const sourceOptions = useMemo(
    () => Array.from(new Set((links ?? []).map(sourceLabel))).sort(),
    [links]
  );

  const visible = useMemo(() => {
    if (!links) return [];
    let out = links.filter((l) => {
      if (onlyUnmatched && l.match_source) return false;
      if (donorFilter && !donorFilter.has(l.donor_name || l.donor_id)) return false;
      if (personFilter && !personFilter.has(l.person_name || "— unmatched —")) return false;
      if (sourceFilter && !sourceFilter.has(sourceLabel(l))) return false;
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
  }, [links, sort, onlyUnmatched, donorFilter, personFilter, sourceFilter]);

  return (
    <div>
      <h2 className="page-title">Planning Center · Giving ↔ People Link</h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Most Giving donors auto-link to their People record (Planning Center shares one ID space
        between the two). Anyone left unmatched here - usually a guest or one-time online giver -
        can be linked by hand. Click a row for full detail.
      </p>

      {error && <div className="error">{error}</div>}

      <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <input type="checkbox" checked={onlyUnmatched} onChange={(e) => setOnlyUnmatched(e.target.checked)} />
        Show only unmatched donors
      </label>

      {!links && !error && <p className="subtitle">Loading…</p>}
      {links && (
        <div className="card">
          <div className="row" style={{ marginBottom: 8, alignItems: "center" }}>
            <span className="subtitle" style={{ margin: 0 }}>
              {links.length} donors on file.
            </span>
          </div>
          <div className="table-wrap">
            <table className="resizable-cols">
              <ColGroup columns={["donor_name", "person_name", "match_source"]} widths={widths} />
              <thead>
                <tr>
                  <SortableHeader
                    label="Donor"
                    sortKey="donor_name"
                    activeSort={sort}
                    onSort={onSort}
                    filter={
                      <TextColumnFilter
                        label="Donor"
                        options={donorOptions}
                        selected={donorFilter}
                        onChange={setDonorFilter}
                      />
                    }
                    resizeHandle={<ColResizeHandle col="donor_name" startResize={startResize} />}
                  />
                  <SortableHeader
                    label="Linked Person"
                    sortKey="person_name"
                    activeSort={sort}
                    onSort={onSort}
                    filter={
                      <TextColumnFilter
                        label="Linked Person"
                        options={personOptions}
                        selected={personFilter}
                        onChange={setPersonFilter}
                      />
                    }
                    resizeHandle={<ColResizeHandle col="person_name" startResize={startResize} />}
                  />
                  <SortableHeader
                    label="Source"
                    sortKey="match_source"
                    activeSort={sort}
                    onSort={onSort}
                    filter={
                      <TextColumnFilter
                        label="Source"
                        options={sourceOptions}
                        selected={sourceFilter}
                        onChange={setSourceFilter}
                      />
                    }
                    resizeHandle={<ColResizeHandle col="match_source" startResize={startResize} />}
                  />
                </tr>
              </thead>
              <tbody>
                {visible.map((l) => (
                  <tr key={l.donor_id} onClick={() => setOpenLink(l)} style={{ cursor: "pointer" }}>
                    <td>{l.donor_name || l.donor_id}</td>
                    <td>{l.person_name || "— unmatched —"}</td>
                    <td>
                      <span className={"pill" + (l.match_source ? " bank" : "")}>{sourceLabel(l)}</span>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={3} className="subtitle">
                      {links.length === 0
                        ? "No donors on file."
                        : onlyUnmatched
                        ? "Every donor is linked."
                        : "No donors match the current filters."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {openLink && (
        <GivingPeopleLinkDetailModal
          link={openLink}
          people={people}
          onClose={() => setOpenLink(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
