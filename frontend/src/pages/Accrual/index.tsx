import { useEffect, useMemo, useState } from "react";
import { accountsApi, ChartAccount } from "../../api/accounts";
import { accrualApi, AccrualEntry, AccrualEntryUpdate } from "../../api/accrual";
import { bankAccountsApi, BankAccount } from "../../api/bankAccounts";
import { getCurrentFiscalYear, settingsApi } from "../../api/settings";
import { COLUMNS, setPriorYearEndDate } from "../ledger/columns";
import ColumnHealthStrip from "../ledger/ColumnHealthStrip";
import RegisterRow from "../ledger/RegisterRow";
import TransactionModal from "../ledger/TransactionModal";
import QuickAddModal from "./QuickAddModal";
import { ColGroup, ColResizeHandle, useColumnWidths } from "../../components/ColumnResize";

const YEAR_OPTION_SPAN = 5; // current year and the 4 before it

export default function Accrual() {
  const [entries, setEntries] = useState<AccrualEntry[]>([]);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [error, setError] = useState("");
  const [filterColumn, setFilterColumn] = useState<string | null>(null);
  const [openEntryId, setOpenEntryId] = useState<number | null>(null);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [year, setYear] = useState<number | null>(null);
  const { widths, startResize } = useColumnWidths("accrual-list");

  async function load(forYear: number) {
    try {
      const [e, a, b, cutoff] = await Promise.all([
        accrualApi.list(forYear),
        accountsApi.listAccounts(),
        bankAccountsApi.list(),
        settingsApi.get("prior_year_end_date"),
      ]);
      setPriorYearEndDate(cutoff.value); // shared with Reconciliation's CY/PY columns
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

  const completeness = useMemo(() => {
    const map = new Map<string, { complete: boolean; missingCount: number }>();
    for (const col of COLUMNS) {
      const missingCount = entries.filter((e) => !col.isPopulated(e)).length;
      map.set(col.key, { complete: missingCount === 0, missingCount });
    }
    return map;
  }, [entries]);

  const activeColumn = filterColumn ? COLUMNS.find((c) => c.key === filterColumn) : null;
  const visibleEntries = activeColumn
    ? entries.filter((e) => !activeColumn.isPopulated(e))
    : entries;

  async function onUpdate(id: number, patch: AccrualEntryUpdate) {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    try {
      const updated = await accrualApi.update(id, patch);
      setEntries((prev) => prev.map((e) => (e.id === id ? updated : e)));
    } catch (err) {
      setError((err as Error).message);
      if (year != null) await load(year);
    }
  }

  async function onDelete(id: number) {
    if (!confirm("Delete this accrual entry?")) return;
    try {
      await accrualApi.delete(id);
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
          Accrual
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
        Manually-entered ledger for recording an expense or reimbursement as
        incurred, before the actual payment clears the bank and shows up in
        Actual. Same fields (including Bank Account, editable in the detail
        popup), same Chart of Accounts lookup, same split/undo-split as
        Actual.
      </p>
      <div className="toolbar">
        <button className="btn" onClick={() => setShowQuickAdd(true)}>
          + Quick add
        </button>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>
          Opens a form you can keep hitting Enter on to add several entries in a row.
        </span>
      </div>
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
                "date",
                "description",
                "statement_description",
                "bank_description",
                "method",
                "amount",
              ]}
              widths={widths}
            />
            <thead>
              <tr>
                <th>
                  <ColResizeHandle col="expand" startResize={startResize} />
                </th>
                <th>
                  Date
                  <ColResizeHandle col="date" startResize={startResize} />
                </th>
                <th>
                  Description
                  <ColResizeHandle col="description" startResize={startResize} />
                </th>
                <th>
                  Statement Description
                  <ColResizeHandle col="statement_description" startResize={startResize} />
                </th>
                <th>
                  Bank Description
                  <ColResizeHandle col="bank_description" startResize={startResize} />
                </th>
                <th>
                  Method
                  <ColResizeHandle col="method" startResize={startResize} />
                </th>
                <th className="num">
                  Amount
                  <ColResizeHandle col="amount" startResize={startResize} />
                </th>
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
                />
              ))}
              {visibleEntries.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ color: "var(--muted)" }}>
                    {entries.length === 0
                      ? "No entries yet — click Quick Add to enter one."
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
          onSplit={(id, lines) => accrualApi.split(id, lines)}
          onUnsplit={(parentId) => accrualApi.unsplit(parentId)}
          splitHint="For one lump entry that actually covers several people or purchases."
        />
      )}

      {showQuickAdd && (
        <QuickAddModal
          accounts={accounts}
          bankAccounts={bankAccounts}
          onCreated={(entry) => setEntries((prev) => [entry, ...prev])}
          onClose={() => setShowQuickAdd(false)}
        />
      )}
    </div>
  );
}
