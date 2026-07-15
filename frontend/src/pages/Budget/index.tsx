import { useEffect, useState } from "react";
import { accountsApi, ChartAccount } from "../../api/accounts";
import { budgetApi, BudgetEntry, BudgetEntryUpdate } from "../../api/budget";
import { settingsApi } from "../../api/settings";
import QuickAddModal from "./QuickAddModal";
import DetailModal from "./DetailModal";

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

  useEffect(() => {
    accountsApi.listAccounts("Budget").then(setAccounts).catch((err) => setError((err as Error).message));
    settingsApi
      .get("prior_year_end_date")
      .then((s) => setYear(currentYearFromCutoff(s.value)))
      .catch((err) => setError((err as Error).message));
  }, []);

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

  async function onCopyYear() {
    if (year == null || copyFromYear === "" || copyFromYear === year) return;
    setCopyStatus("");
    try {
      const result = await budgetApi.copyYear(copyFromYear, year);
      setCopyStatus(`Copied ${result.copied} lines from ${copyFromYear}.`);
      await load(year);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.toLowerCase().includes("already has") && confirm(`${msg} Replace them?`)) {
        try {
          const result = await budgetApi.copyYear(copyFromYear, year, true);
          setCopyStatus(`Copied ${result.copied} lines from ${copyFromYear} (replaced existing).`);
          await load(year);
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
          <input
            type="number"
            style={{ width: 90 }}
            value={year ?? ""}
            onChange={(e) => setYear(Number(e.target.value) || null)}
          />
        </label>
        <span className="pill">Total: ${total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
      </div>
      <div className="toolbar">
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <span>Copy budget from year:</span>
          <input
            type="number"
            style={{ width: 90 }}
            value={copyFromYear}
            onChange={(e) => setCopyFromYear(e.target.value ? Number(e.target.value) : "")}
            placeholder="e.g. 2025"
          />
        </label>
        <button className="btn secondary" onClick={onCopyYear} disabled={copyFromYear === "" || year == null}>
          Copy as starting point for {year ?? "…"}
        </button>
        {copyStatus && <span className="ok">{copyStatus}</span>}
      </div>
      {error && <div className="error">{error}</div>}

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Statement Description</th>
                <th className="num">Amount</th>
                <th>Notes</th>
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
          onCreated={(entry) => setEntries((prev) => [entry, ...prev])}
          onClose={() => setShowQuickAdd(false)}
        />
      )}
    </div>
  );
}
