import { useEffect, useMemo, useState } from "react";
import { accountsApi, ChartAccount } from "../../api/accounts";
import { budgetApi, BudgetEntry, BudgetEntryUpdate } from "../../api/budget";
import { settingsApi } from "../../api/settings";
import QuickAddModal from "./QuickAddModal";
import DetailModal from "./DetailModal";
import { ColGroup, ColResizeHandle, useColumnWidths } from "../../components/ColumnResize";

function currentYearFromCutoff(priorYearEndDate: string): number {
  const y = Number(priorYearEndDate.slice(0, 4));
  return Number.isFinite(y) ? y + 1 : new Date().getFullYear();
}

/** The annual Plan ledger for Budget-category accounts - same
 * register + detail-popup + Quick Add pattern as Accrual, just without the
 * fields that don't apply to a planning figure (bank account, method,
 * reconciled, split). A single account can carry multiple lines in a year
 * (e.g. "Salaries and Benefits" gets separate Salary/Health
 * Insurance/Retirement Plan/Social Security lines that sum together for
 * reporting) - see Income Statement. */
export default function Budget() {
  const [year, setYear] = useState<number | null>(null);
  const [entries, setEntries] = useState<BudgetEntry[]>([]);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [openEntryId, setOpenEntryId] = useState<number | null>(null);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [copyFromYear, setCopyFromYear] = useState<number | "">("");
  const [copyStatus, setCopyStatus] = useState("");
  // Every year that already has at least one budget line, e.g. once
  // 2024/2025 are imported - drives the "Copy budget from year" dropdown
  // (only years with something to copy make sense there) and folds into
  // the Year dropdown's own option list.
  const [yearsWithData, setYearsWithData] = useState<number[]>([]);
  const { widths, startResize } = useColumnWidths("budget-list");

  useEffect(() => {
    accountsApi.listAccounts("Budget").then(setAccounts).catch((err) => setError((err as Error).message));
    settingsApi
      .get("prior_year_end_date")
      .then((s) => setYear(currentYearFromCutoff(s.value)))
      .catch((err) => setError((err as Error).message));
    budgetApi
      .list()
      .then((all) =>
        setYearsWithData(
          Array.from(
            new Set(all.flatMap((e) => (e.transaction_date ? [Number(e.transaction_date.slice(0, 4))] : [])))
          ).sort((a, b) => b - a)
        )
      )
      .catch((err) => setError((err as Error).message));
  }, []);

  // The Year selector always offers a sensible range around the app's
  // Current Year even before any data exists for it, plus any data year
  // outside that range (e.g. old history) - never limited to just years
  // that already happen to have entries.
  const yearOptions = useMemo(() => {
    if (year == null) return yearsWithData;
    const range = [year - 3, year - 2, year - 1, year, year + 1];
    return Array.from(new Set([...range, ...yearsWithData])).sort((a, b) => b - a);
  }, [year, yearsWithData]);

  const copyFromYearOptions = useMemo(
    () => yearsWithData.filter((y) => y !== year),
    [yearsWithData, year]
  );

  async function load(y: number) {
    setLoading(true);
    try {
      setEntries(await budgetApi.list(y));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (year != null) load(year);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  async function onUpdate(id: number, patch: BudgetEntryUpdate) {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    try {
      const updated = await budgetApi.update(id, patch);
      setEntries((prev) => prev.map((e) => (e.id === id ? updated : e)));
    } catch (err) {
      setError((err as Error).message);
      if (year != null) await load(year);
    }
  }

  async function onDelete(id: number) {
    if (!confirm("Delete this budget line?")) return;
    try {
      await budgetApi.delete(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function refreshYearsWithData() {
    try {
      const all = await budgetApi.list();
      setYearsWithData(
        Array.from(
          new Set(all.flatMap((e) => (e.transaction_date ? [Number(e.transaction_date.slice(0, 4))] : [])))
        ).sort((a, b) => b - a)
      );
    } catch {
      // Non-critical - the dropdown just won't pick up the new year until
      // the next successful refresh.
    }
  }

  async function onCopyYear() {
    if (year == null || copyFromYear === "" || copyFromYear === year) return;
    setCopyStatus("");
    try {
      const result = await budgetApi.copyYear(copyFromYear, year);
      setCopyStatus(`Copied ${result.copied} lines from ${copyFromYear}.`);
      await load(year);
      await refreshYearsWithData();
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.toLowerCase().includes("already has") && confirm(`${msg} Replace them?`)) {
        try {
          const result = await budgetApi.copyYear(copyFromYear, year, true);
          setCopyStatus(`Copied ${result.copied} lines from ${copyFromYear} (replaced existing).`);
          await load(year);
          await refreshYearsWithData();
        } catch (err2) {
          setError((err2 as Error).message);
        }
      } else {
        setError(msg);
      }
    }
  }

  const total = entries.reduce((sum, e) => sum + e.amount, 0);
  const openEntry = openEntryId ? entries.find((e) => e.id === openEntryId) || null : null;

  return (
    <div>
      <h2 className="page-title">Budget</h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        The annual Plan for every Budget-category account, matching the
        legacy sheet's Budget entries. Feeds the Income Statement's Plan
        column - shares its Statement Category/Item with the real
        Income/Expense account it plans for.
      </p>
      <div className="toolbar">
        <button className="btn" onClick={() => setShowQuickAdd(true)}>
          + Quick add
        </button>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <span>Year:</span>
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
        <span className="pill">Total: ${total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
      </div>
      <div className="toolbar">
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <span>Copy budget from year:</span>
          <select
            value={copyFromYear}
            onChange={(e) => setCopyFromYear(e.target.value ? Number(e.target.value) : "")}
            disabled={copyFromYearOptions.length === 0}
          >
            <option value="">
              {copyFromYearOptions.length === 0 ? "No other years yet" : "Select…"}
            </option>
            {copyFromYearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <button className="btn secondary" onClick={onCopyYear} disabled={copyFromYear === "" || year == null}>
          Copy as starting point for {year ?? "…"}
        </button>
        {copyStatus && <span className="ok">{copyStatus}</span>}
      </div>
      {error && <div className="error">{error}</div>}

      <div className="card">
        <div className="table-wrap">
          <table className="resizable-cols">
            <ColGroup
              columns={["date", "description", "statement_description", "amount", "notes"]}
              widths={widths}
            />
            <thead>
              <tr>
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
                <th className="num">
                  Amount
                  <ColResizeHandle col="amount" startResize={startResize} />
                </th>
                <th>
                  Notes
                  <ColResizeHandle col="notes" startResize={startResize} />
                </th>
              </tr>
            </thead>
            <tbody>
              {!loading &&
                entries.map((e) => (
                  <tr key={e.id} className="register-row" onClick={() => setOpenEntryId(e.id)}>
                    <td>{e.transaction_date || "—"}</td>
                    <td>{e.description || "—"}</td>
                    <td>{e.statement_description || "— uncategorized —"}</td>
                    <td className="num">${e.amount.toFixed(2)}</td>
                    <td>{e.notes}</td>
                  </tr>
                ))}
              {!loading && entries.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ color: "var(--muted)" }}>
                    No budget lines yet for {year} — click Quick Add, or copy last year's as a starting point.
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

      {showQuickAdd && year != null && (
        <QuickAddModal
          accounts={accounts}
          year={year}
          onCreated={(entry) => {
            setEntries((prev) => [entry, ...prev]);
            refreshYearsWithData();
          }}
          onClose={() => setShowQuickAdd(false)}
        />
      )}
    </div>
  );
}
