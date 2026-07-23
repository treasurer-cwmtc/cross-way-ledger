import { useEffect, useMemo, useState } from "react";
import { accountsApi, ChartAccount } from "../../api/accounts";
import { bankAccountsApi, BankAccount } from "../../api/bankAccounts";
import { ledgerApi, ReconciliationEntry, ReconciliationEntryUpdate } from "../../api/ledger";
import { getCurrentFiscalYear, settingsApi } from "../../api/settings";
import {
  DateColumnFilter,
  DateFilterValue,
  TextColumnFilter,
  dateMatchesFilter,
} from "../../components/ColumnFilter";
import { COLUMNS, setPriorYearEndDate } from "../ledger/columns";
import ColumnHealthStrip from "../ledger/ColumnHealthStrip";
import RegisterRow from "../ledger/RegisterRow";
import TransactionModal from "../ledger/TransactionModal";
import { ColGroup, ColResizeHandle, useColumnWidths } from "../../components/ColumnResize";

type SortKey =
  | "posted_date"
  | "transaction_date"
  | "description"
  | "statement_description"
  | "bank_description"
  | "amount";

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

const YEAR_OPTION_SPAN = 5; // current year and the 4 before it

export default function Reconciliation() {
  const [entries, setEntries] = useState<ReconciliationEntry[]>([]);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [error, setError] = useState("");
  const [filterColumn, setFilterColumn] = useState<string | null>(null);
  const [openEntryId, setOpenEntryId] = useState<number | null>(null);
  const [year, setYear] = useState<number | null>(null);

  const [sort, setSort] = useState<{ key: SortKey | null; dir: "asc" | "desc" }>({
    key: "posted_date",
    dir: "desc",
  });
  const [datePostedFilter, setDatePostedFilter] = useState<DateFilterValue | null>(null);
  const [transactionDateFilter, setTransactionDateFilter] = useState<DateFilterValue | null>(null);
  const [descriptionFilter, setDescriptionFilter] = useState<Set<string> | null>(null);
  const [statementDescriptionFilter, setStatementDescriptionFilter] = useState<Set<string> | null>(null);
  const [bankDescriptionFilter, setBankDescriptionFilter] = useState<Set<string> | null>(null);
  const { widths, startResize } = useColumnWidths("actual-ledger");

  async function load(forYear: number) {
    try {
      const [e, a, b, cutoff] = await Promise.all([
        ledgerApi.list(forYear),
        accountsApi.listAccounts(),
        bankAccountsApi.list(),
        settingsApi.get("prior_year_end_date"),
      ]);
      setPriorYearEndDate(cutoff.value); // affects columns.ts CY/PY derivation
      setEntries(e);
      setAccounts(a);
      setBankAccounts(b);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    getCurrentFiscalYear()
      .then(setYear)
      .catch((err) => setError((err as Error).message));
  }, []);

  useEffect(() => {
    if (year != null) load(year);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  const yearOptions = useMemo(() => {
    const base = year ?? new Date().getUTCFullYear();
    return Array.from({ length: YEAR_OPTION_SPAN }, (_, i) => base - i);
  }, [year]);

  function sortValue(e: ReconciliationEntry, key: SortKey): string | number {
    switch (key) {
      case "posted_date":
        return e.posted_date || "";
      case "transaction_date":
        return e.transaction_date || "";
      case "description":
        return e.description;
      case "statement_description":
        return e.statement_description;
      case "bank_description":
        return e.bank_description;
      case "amount":
        return e.amount;
    }
  }

  function onSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }
    );
  }

  const completeness = useMemo(() => {
    const map = new Map<string, { complete: boolean; missingCount: number }>();
    for (const col of COLUMNS) {
      const missingCount = entries.filter((e) => !col.isPopulated(e)).length;
      map.set(col.key, { complete: missingCount === 0, missingCount });
    }
    return map;
  }, [entries]);

  const datePostedMonthOptions = useMemo(
    () => Array.from(new Set(entries.flatMap((e) => (e.posted_date ? [e.posted_date.slice(0, 7)] : [])))).sort(),
    [entries]
  );
  const transactionDateMonthOptions = useMemo(
    () => Array.from(new Set(entries.flatMap((e) => (e.transaction_date ? [e.transaction_date.slice(0, 7)] : [])))).sort(),
    [entries]
  );
  const descriptionOptions = useMemo(
    () => Array.from(new Set(entries.map((e) => e.description || "(no description)"))).sort(),
    [entries]
  );
  const statementDescriptionOptions = useMemo(
    () => Array.from(new Set(entries.map((e) => e.statement_description || "— uncategorized —"))).sort(),
    [entries]
  );
  const bankDescriptionOptions = useMemo(
    () => Array.from(new Set(entries.map((e) => e.bank_description || "—"))).sort(),
    [entries]
  );

  const activeColumn = filterColumn ? COLUMNS.find((c) => c.key === filterColumn) : null;

  const visibleEntries = useMemo(() => {
    let out = activeColumn ? entries.filter((e) => !activeColumn.isPopulated(e)) : entries;
    out = out.filter((e) => {
      if (!dateMatchesFilter(e.posted_date, datePostedFilter)) return false;
      if (!dateMatchesFilter(e.transaction_date, transactionDateFilter)) return false;
      if (descriptionFilter && !descriptionFilter.has(e.description || "(no description)")) return false;
      if (
        statementDescriptionFilter &&
        !statementDescriptionFilter.has(e.statement_description || "— uncategorized —")
      )
        return false;
      if (bankDescriptionFilter && !bankDescriptionFilter.has(e.bank_description || "—")) return false;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    entries,
    activeColumn,
    datePostedFilter,
    transactionDateFilter,
    descriptionFilter,
    statementDescriptionFilter,
    bankDescriptionFilter,
    sort,
  ]);

  async function onUpdate(id: number, patch: ReconciliationEntryUpdate) {
    // Optimistic local update so typing/toggling feels instant.
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    try {
      const updated = await ledgerApi.update(id, patch);
      setEntries((prev) => prev.map((e) => (e.id === id ? updated : e)));
    } catch (err) {
      setError((err as Error).message);
      if (year != null) await load(year); // roll back to server state on failure
    }
  }

  async function onDelete(id: number) {
    if (!confirm("Delete this actual entry?")) return;
    try {
      await ledgerApi.delete(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const openEntry = openEntryId ? entries.find((e) => e.id === openEntryId) || null : null;

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
        <h2 className="page-title" style={{ margin: 0 }}>
          Actual
        </h2>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginLeft: "auto" }}>
          <span>Posted Year:</span>
          <select
            value={year ?? ""}
            onChange={(e) => setYear(e.target.value ? Number(e.target.value) : null)}
          >
            {year != null && !yearOptions.includes(year) && <option value={year}>{year}</option>}
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="subtitle" style={{ marginTop: 0 }}>
        The permanent, editable ledger — push rows here from the Upload tab.
        Click a row to open every field for editing, including Bank Account
        and the source file it came from. Statement Description is always
        whatever the linked Chart of Accounts account currently says. Click a
        chip below to filter down to just the rows missing that column. Every
        column header sorts and filters — Bank Description shows the raw bank
        line in full, wrapping onto extra lines rather than truncating it.
        The Txn/Posted CY/PY columns are driven by the fiscal year date set on
        the Config tab (shared with Accrual).
      </p>
      {error && <div className="error">{error}</div>}

      <ColumnHealthStrip
        columns={COLUMNS}
        completeness={completeness}
        activeKey={filterColumn}
        onToggle={(key) => setFilterColumn((prev) => (prev === key ? null : key))}
      />
      {activeColumn && (
        <div className="toolbar">
          <span className="pill warn">
            Showing only rows missing {activeColumn.label} ({visibleEntries.length})
          </span>
          <button className="link" onClick={() => setFilterColumn(null)}>
            Clear filter
          </button>
        </div>
      )}

      <div className="card">
        <div className="table-wrap">
          <table className="resizable-cols">
            <ColGroup
              columns={[
                "expand",
                "posted_date",
                "transaction_date",
                "description",
                "statement_description",
                "bank_description",
                "amount",
              ]}
              widths={widths}
            />
            <thead>
              <tr>
                <th></th>
                <SortableHeader
                  label="Posted Date"
                  sortKey="posted_date"
                  activeSort={sort}
                  onSort={onSort}
                  filter={
                    <DateColumnFilter
                      label="Posted Date"
                      monthOptions={datePostedMonthOptions}
                      value={datePostedFilter}
                      onChange={setDatePostedFilter}
                    />
                  }
                  resizeHandle={<ColResizeHandle col="posted_date" startResize={startResize} />}
                />
                <SortableHeader
                  label="Transaction Date"
                  sortKey="transaction_date"
                  activeSort={sort}
                  onSort={onSort}
                  filter={
                    <DateColumnFilter
                      label="Transaction Date"
                      monthOptions={transactionDateMonthOptions}
                      value={transactionDateFilter}
                      onChange={setTransactionDateFilter}
                    />
                  }
                  resizeHandle={<ColResizeHandle col="transaction_date" startResize={startResize} />}
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
                  label="Statement Description"
                  sortKey="statement_description"
                  activeSort={sort}
                  onSort={onSort}
                  filter={
                    <TextColumnFilter
                      label="Statement Description"
                      options={statementDescriptionOptions}
                      selected={statementDescriptionFilter}
                      onChange={setStatementDescriptionFilter}
                    />
                  }
                  resizeHandle={<ColResizeHandle col="statement_description" startResize={startResize} />}
                />
                <SortableHeader
                  label="Bank Description"
                  sortKey="bank_description"
                  activeSort={sort}
                  onSort={onSort}
                  filter={
                    <TextColumnFilter
                      label="Bank Description"
                      options={bankDescriptionOptions}
                      selected={bankDescriptionFilter}
                      onChange={setBankDescriptionFilter}
                    />
                  }
                  resizeHandle={<ColResizeHandle col="bank_description" startResize={startResize} />}
                />
                <SortableHeader
                  label="Amount"
                  sortKey="amount"
                  activeSort={sort}
                  onSort={onSort}
                  resizeHandle={<ColResizeHandle col="amount" startResize={startResize} />}
                />
              </tr>
            </thead>
            <tbody>
              {visibleEntries.map((e) => (
                <RegisterRow
                  key={e.id}
                  entry={e}
                  bankAccounts={bankAccounts}
                  onUpdate={onUpdate}
                  onOpen={setOpenEntryId}
                  showBankDescription
                  wideBankDescription
                  showPostedDate
                  hideMethod
                />
              ))}
              {visibleEntries.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ color: "var(--muted)" }}>
                    {entries.length === 0
                      ? "No entries yet — push a completed run from the Upload tab."
                      : "No rows match this filter."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {openEntry && (
        <TransactionModal
          entry={openEntry}
          accounts={accounts}
          bankAccounts={bankAccounts}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onClose={() => setOpenEntryId(null)}
          onReload={() => year != null && load(year)}
          onSplit={(id, lines) => ledgerApi.split(id, lines)}
          onUnsplit={(parentId) => ledgerApi.unsplit(parentId)}
          splitHint="For an aggregated bank line (e.g. a deposit slip covering several checks)."
        />
      )}
    </div>
  );
}
