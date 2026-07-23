import { useEffect, useMemo, useState } from "react";
import { accountsApi, ChartAccount } from "../../api/accounts";
import {
  restrictedTransfersApi,
  RestrictedTransferEntry,
  RestrictedTransferEntryUpdate,
} from "../../api/restrictedTransfers";
import { TextColumnFilter } from "../../components/ColumnFilter";
import { ColGroup, ColResizeHandle, useColumnWidths } from "../../components/ColumnResize";
import QuickAddModal from "./QuickAddModal";
import DetailModal from "./DetailModal";

function fmtMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

type SortKey = "date" | "from" | "to" | "description" | "amount";

function sortValue(e: RestrictedTransferEntry, key: SortKey): string | number {
  switch (key) {
    case "date":
      return e.transaction_date || "";
    case "from":
      return e.from_statement_description;
    case "to":
      return e.to_statement_description;
    case "description":
      return e.description;
    case "amount":
      return e.amount;
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

const COLUMNS = ["date", "from", "to", "description", "amount", "notes"];

/** Permanent reclassifications between two Chart-of-Accounts lines - e.g.
 * releasing money earmarked in a restricted fund into the account being
 * funded. Unlike Accrual, nothing here is meant to later clear against a
 * bank transaction; the transfer itself is the permanent economic event,
 * so it stays on the books the same way Actual entries do. Each row feeds
 * two lines into General Ledger (a decrease on From, an increase on To). */
export default function RestrictedNetAssets() {
  const [entries, setEntries] = useState<RestrictedTransferEntry[] | null>(null);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [error, setError] = useState("");
  const [openEntryId, setOpenEntryId] = useState<number | null>(null);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey | null; dir: "asc" | "desc" }>({
    key: "date",
    dir: "desc",
  });
  const [fromFilter, setFromFilter] = useState<Set<string> | null>(null);
  const [toFilter, setToFilter] = useState<Set<string> | null>(null);
  const [descriptionFilter, setDescriptionFilter] = useState<Set<string> | null>(null);
  const { widths, startResize } = useColumnWidths("restricted-net-assets");

  async function load() {
    try {
      const [e, a] = await Promise.all([restrictedTransfersApi.list(), accountsApi.listAccounts()]);
      setEntries(e);
      setAccounts(a);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function onSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }
    );
  }

  const fromOptions = useMemo(
    () => Array.from(new Set((entries ?? []).map((e) => e.from_statement_description))).sort(),
    [entries]
  );
  const toOptions = useMemo(
    () => Array.from(new Set((entries ?? []).map((e) => e.to_statement_description))).sort(),
    [entries]
  );
  const descriptionOptions = useMemo(
    () => Array.from(new Set((entries ?? []).map((e) => e.description))).sort(),
    [entries]
  );

  const visibleEntries = useMemo(() => {
    if (!entries) return [];
    let out = entries.filter((e) => {
      if (fromFilter && !fromFilter.has(e.from_statement_description)) return false;
      if (toFilter && !toFilter.has(e.to_statement_description)) return false;
      if (descriptionFilter && !descriptionFilter.has(e.description)) return false;
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
  }, [entries, sort, fromFilter, toFilter, descriptionFilter]);

  async function onUpdate(id: number, patch: RestrictedTransferEntryUpdate) {
    setEntries((prev) => (prev ? prev.map((e) => (e.id === id ? { ...e, ...patch } : e)) : prev));
    try {
      const updated = await restrictedTransfersApi.update(id, patch);
      setEntries((prev) => (prev ? prev.map((e) => (e.id === id ? updated : e)) : prev));
    } catch (err) {
      setError((err as Error).message);
      await load();
    }
  }

  async function onDelete(id: number) {
    if (!confirm("Delete this transfer?")) return;
    try {
      await restrictedTransfersApi.delete(id);
      setEntries((prev) => (prev ? prev.filter((e) => e.id !== id) : prev));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (error) return <div className="error">{error}</div>;
  if (!entries) return <p className="subtitle">Loading…</p>;

  const openEntry = openEntryId ? entries.find((e) => e.id === openEntryId) || null : null;

  return (
    <div>
      <h2 className="page-title">Restricted Net Assets</h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Permanent reclassifications between two Chart-of-Accounts lines - e.g. releasing money
        earmarked in a restricted fund into the account being funded. Unlike Accrual, nothing here
        clears against a bank transaction; the transfer itself is the permanent record. Feeds two
        lines into the General Ledger (a decrease on From, an increase on To).
      </p>
      <div className="toolbar">
        <button className="btn" onClick={() => setShowQuickAdd(true)}>
          + Quick add
        </button>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>
          Opens a form you can keep hitting Enter on to add several transfers in a row.
        </span>
      </div>
      {error && <div className="error">{error}</div>}

      <div className="card">
        <div className="table-wrap">
          <table className="resizable-cols">
            <ColGroup columns={COLUMNS} widths={widths} />
            <thead>
              <tr>
                <SortableHeader
                  label="Date"
                  sortKey="date"
                  activeSort={sort}
                  onSort={onSort}
                  resizeHandle={<ColResizeHandle col="date" startResize={startResize} defaultWidth={110} />}
                />
                <SortableHeader
                  label="From"
                  sortKey="from"
                  activeSort={sort}
                  onSort={onSort}
                  filter={
                    <TextColumnFilter label="From" options={fromOptions} selected={fromFilter} onChange={setFromFilter} />
                  }
                  resizeHandle={<ColResizeHandle col="from" startResize={startResize} />}
                />
                <SortableHeader
                  label="To"
                  sortKey="to"
                  activeSort={sort}
                  onSort={onSort}
                  filter={<TextColumnFilter label="To" options={toOptions} selected={toFilter} onChange={setToFilter} />}
                  resizeHandle={<ColResizeHandle col="to" startResize={startResize} />}
                />
                <SortableHeader
                  label="Description"
                  sortKey="description"
                  activeSort={sort}
                  onSort={onSort}
                  filter={
                    <TextColumnFilter
                      label="Description"
                      options={descriptionOptions}
                      selected={descriptionFilter}
                      onChange={setDescriptionFilter}
                    />
                  }
                  resizeHandle={<ColResizeHandle col="description" startResize={startResize} />}
                />
                <SortableHeader
                  label="Amount"
                  sortKey="amount"
                  activeSort={sort}
                  onSort={onSort}
                  resizeHandle={<ColResizeHandle col="amount" startResize={startResize} defaultWidth={110} />}
                />
                <th>
                  Notes
                  <ColResizeHandle col="notes" startResize={startResize} />
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleEntries.map((e) => (
                <tr key={e.id} onClick={() => setOpenEntryId(e.id)} style={{ cursor: "pointer" }}>
                  <td>{e.transaction_date || ""}</td>
                  <td>{e.from_statement_description}</td>
                  <td>{e.to_statement_description}</td>
                  <td>{e.description}</td>
                  <td>{fmtMoney(e.amount)}</td>
                  <td>{e.notes}</td>
                </tr>
              ))}
              {visibleEntries.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} style={{ color: "var(--muted)" }}>
                    {entries.length === 0
                      ? "No transfers yet — click Quick Add to enter one."
                      : "No rows match the current filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {openEntry && (
        <DetailModal
          entry={openEntry}
          accounts={accounts}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onClose={() => setOpenEntryId(null)}
        />
      )}

      {showQuickAdd && (
        <QuickAddModal
          accounts={accounts}
          onCreated={(entry) => setEntries((prev) => (prev ? [entry, ...prev] : [entry]))}
          onClose={() => setShowQuickAdd(false)}
        />
      )}
    </div>
  );
}
