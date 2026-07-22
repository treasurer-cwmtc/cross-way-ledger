import { useEffect, useMemo, useState } from "react";
import { pledgeCampaignsApi, CampaignDetailRow } from "../../api/pledgeCampaigns";
import DetailModal from "./DetailModal";
import { DateColumnFilter, DateFilterValue, TextColumnFilter, dateMatchesFilter } from "../../components/ColumnFilter";

function fmtMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

type SortKey =
  | "donor_id"
  | "name"
  | "email"
  | "pledged_amount"
  | "actual_amount"
  | "due_date"
  | "joint_giver";

function sortValue(r: CampaignDetailRow, key: SortKey): string | number {
  switch (key) {
    case "donor_id":
      return r.donor_id || "";
    case "name":
      return `${r.first_name} ${r.last_name}`.trim();
    case "email":
      return r.email;
    case "pledged_amount":
      return r.pledged_amount;
    case "actual_amount":
      return r.actual_amount;
    case "due_date":
      return r.due_date || "";
    case "joint_giver":
      return `${r.joint_giver_first_name} ${r.joint_giver_last_name}`.trim();
  }
}

function SortableHeader({
  label,
  sortKey,
  activeSort,
  onSort,
  filter,
}: {
  label: string;
  sortKey: SortKey;
  activeSort: { key: SortKey | null; dir: "asc" | "desc" };
  onSort: (key: SortKey) => void;
  filter?: React.ReactNode;
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
    </th>
  );
}

/** Combined Pledges + Actuals view: one row per pledge, plus a row for
 * anyone who gave to this fund without ever submitting a pledge form - so
 * their giving still shows up instead of only living in the raw donation
 * data. Every column sorts by clicking its header; text columns get an
 * Excel-style "choose which values" filter, the date column gets exact
 * date / range / month filtering. Click a row to see full detail, or link
 * a giver-without-a-pledge row to an existing pledge if the automatic
 * match missed it or matched the wrong person. */
export default function Details({
  campaignId,
  hideDonorNames,
}: {
  campaignId: number;
  hideDonorNames: boolean;
}) {
  const [rows, setRows] = useState<CampaignDetailRow[] | null>(null);
  const [error, setError] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey | null; dir: "asc" | "desc" }>({
    key: "due_date",
    dir: "asc",
  });
  const [donorIdFilter, setDonorIdFilter] = useState<Set<string> | null>(null);
  const [nameFilter, setNameFilter] = useState<Set<string> | null>(null);
  const [emailFilter, setEmailFilter] = useState<Set<string> | null>(null);
  const [dueDateFilter, setDueDateFilter] = useState<DateFilterValue | null>(null);
  const [jointGiverFilter, setJointGiverFilter] = useState<Set<string> | null>(null);

  function reload() {
    pledgeCampaignsApi
      .details(campaignId)
      .then(setRows)
      .catch((err) => setError((err as Error).message));
  }

  useEffect(() => {
    setRows(null);
    setDonorIdFilter(null);
    setNameFilter(null);
    setEmailFilter(null);
    setDueDateFilter(null);
    setJointGiverFilter(null);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  function onSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }
    );
  }

  const donorIdOptions = useMemo(
    () => Array.from(new Set((rows ?? []).map((r) => r.donor_id || "—"))).sort(),
    [rows]
  );
  const nameOptions = useMemo(
    () => Array.from(new Set((rows ?? []).map((r) => `${r.first_name} ${r.last_name}`.trim()))).sort(),
    [rows]
  );
  const emailOptions = useMemo(
    () => Array.from(new Set((rows ?? []).map((r) => r.email))).sort(),
    [rows]
  );
  const monthOptions = useMemo(
    () =>
      Array.from(new Set((rows ?? []).flatMap((r) => (r.due_date ? [r.due_date.slice(0, 7)] : [])))).sort(),
    [rows]
  );
  const jointGiverOptions = useMemo(
    () =>
      Array.from(
        new Set((rows ?? []).map((r) => `${r.joint_giver_first_name} ${r.joint_giver_last_name}`.trim()))
      ).sort(),
    [rows]
  );

  const visibleRows = useMemo(() => {
    if (!rows) return [];
    let out = rows.filter((r) => {
      const donorId = r.donor_id || "—";
      const name = `${r.first_name} ${r.last_name}`.trim();
      const jointGiver = `${r.joint_giver_first_name} ${r.joint_giver_last_name}`.trim();
      if (donorIdFilter && !donorIdFilter.has(donorId)) return false;
      if (nameFilter && !nameFilter.has(name)) return false;
      if (emailFilter && !emailFilter.has(r.email)) return false;
      if (!dateMatchesFilter(r.due_date, dueDateFilter)) return false;
      if (jointGiverFilter && !jointGiverFilter.has(jointGiver)) return false;
      return true;
    });
    if (sort.key) {
      const key = sort.key;
      out = [...out].sort((a, b) => {
        const av = sortValue(a, key);
        const bv = sortValue(b, key);
        const res = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
        return sort.dir === "asc" ? res : -res;
      });
    }
    return out;
  }, [rows, sort, donorIdFilter, nameFilter, emailFilter, dueDateFilter, jointGiverFilter]);

  // The pledge rows currently loaded, offered as link targets when fixing a
  // giver-without-a-pledge row's match - built from what's already on the
  // page rather than a separate endpoint.
  const pledgeOptions = useMemo(
    () =>
      (rows ?? [])
        .filter((r) => r.has_pledge)
        .map((r) => ({
          pledgeId: Number(r.key.slice("pledge:".length)),
          label: `${r.first_name} ${r.last_name}`.trim() || r.key,
          email: r.email,
          pledgedAmount: r.pledged_amount,
          matchedDonorId: r.donor_id,
          jointGiverName: `${r.joint_giver_first_name} ${r.joint_giver_last_name}`.trim(),
        })),
    [rows]
  );

  if (error) return <div className="error">{error}</div>;
  if (!rows) return <p className="subtitle">Loading…</p>;

  return (
    <div>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Every pledge form submission, plus anyone who gave to this fund without pledging. Click a
        row to see full detail, or link it to a pledge/donor manually if the automatic email match
        missed it. When a pledge's donor has a joint giver who didn't pledge separately, Received
        Amount already includes that spouse's giving.
      </p>

      <div className="table-wrap">
        <table>
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
              />
              {!hideDonorNames && (
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
                />
              )}
              {!hideDonorNames && (
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
                />
              )}
              <SortableHeader label="Pledged Amount" sortKey="pledged_amount" activeSort={sort} onSort={onSort} />
              <SortableHeader label="Received Amount" sortKey="actual_amount" activeSort={sort} onSort={onSort} />
              <SortableHeader
                label="Delivery by Date"
                sortKey="due_date"
                activeSort={sort}
                onSort={onSort}
                filter={
                  <DateColumnFilter
                    label="Delivery by Date"
                    monthOptions={monthOptions}
                    value={dueDateFilter}
                    onChange={setDueDateFilter}
                  />
                }
              />
              {!hideDonorNames && (
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
                />
              )}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length > 0 && (
              <tr style={{ fontWeight: 700, background: "var(--primary-light)" }}>
                <td>Total ({visibleRows.length})</td>
                {!hideDonorNames && <td />}
                {!hideDonorNames && <td />}
                <td>{fmtMoney(visibleRows.reduce((sum, r) => sum + r.pledged_amount, 0))}</td>
                <td>{fmtMoney(visibleRows.reduce((sum, r) => sum + r.actual_amount, 0))}</td>
                <td />
                {!hideDonorNames && <td />}
              </tr>
            )}
            {visibleRows.map((r) => (
              <tr
                key={r.key}
                onClick={() => setOpenKey(r.key)}
                style={{ cursor: "pointer" }}
                title={r.source_file_name ? `Imported from: ${r.source_file_name}` : undefined}
              >
                <td>{r.donor_id || "—"}</td>
                {!hideDonorNames && (
                  <td>
                    {r.first_name} {r.last_name}
                    {!r.has_pledge && !r.first_name && !r.last_name && (
                      <span className="subtitle"> (gave, no pledge on file)</span>
                    )}
                  </td>
                )}
                {!hideDonorNames && <td>{r.email}</td>}
                <td>{r.has_pledge ? fmtMoney(r.pledged_amount) : "—"}</td>
                <td>{fmtMoney(r.actual_amount)}</td>
                <td>{r.due_date || ""}</td>
                {!hideDonorNames && (
                  <td>
                    {r.joint_giver_id
                      ? `${r.joint_giver_first_name} ${r.joint_giver_last_name}`.trim() || r.joint_giver_id
                      : ""}
                  </td>
                )}
              </tr>
            ))}
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={hideDonorNames ? 4 : 7} className="subtitle">
                  {rows.length === 0 ? "No pledges or giving on file yet." : "No rows match the current filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {openKey && (
        <DetailModal
          campaignId={campaignId}
          detailKey={openKey}
          hideDonorNames={hideDonorNames}
          pledgeOptions={pledgeOptions}
          onClose={() => setOpenKey(null)}
          onMatchChanged={reload}
        />
      )}
    </div>
  );
}
