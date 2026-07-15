import { useEffect, useMemo, useState } from "react";
import { accountsApi, ChartAccount } from "../../api/accounts";
import { bankAccountsApi, BankAccount } from "../../api/bankAccounts";
import { ledgerApi, ReconciliationEntry, ReconciliationEntryUpdate } from "../../api/ledger";
import { settingsApi } from "../../api/settings";
import { COLUMNS, setPriorYearEndDate } from "../ledger/columns";
import ColumnHealthStrip from "../ledger/ColumnHealthStrip";
import RegisterRow from "../ledger/RegisterRow";
import TransactionModal from "../ledger/TransactionModal";

export default function Reconciliation() {
  const [entries, setEntries] = useState<ReconciliationEntry[]>([]);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [error, setError] = useState("");
  const [filterColumn, setFilterColumn] = useState<string | null>(null);
  const [openEntryId, setOpenEntryId] = useState<number | null>(null);

  async function load() {
    try {
      const [e, a, b, cutoff] = await Promise.all([
        ledgerApi.list(),
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
    load();
  }, []);

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

  async function onUpdate(id: number, patch: ReconciliationEntryUpdate) {
    // Optimistic local update so typing/toggling feels instant.
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    try {
      const updated = await ledgerApi.update(id, patch);
      setEntries((prev) => prev.map((e) => (e.id === id ? updated : e)));
    } catch (err) {
      setError((err as Error).message);
      await load(); // roll back to server state on failure
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
      <p className="subtitle" style={{ marginTop: 0 }}>
        The permanent, editable ledger — push rows here from the Upload tab.
        Click a row to open every field for editing. Statement Description is
        always whatever the linked Chart of Accounts account currently says.
        Click a chip below to filter down to just the rows missing that column.
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
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Date</th>
                <th>Description</th>
                <th>Statement Description</th>
                <th>Bank Account</th>
                <th>Method</th>
                <th className="num">Amount</th>
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
          onReload={load}
          onSplit={(id, lines) => ledgerApi.split(id, lines)}
          onUnsplit={(parentId) => ledgerApi.unsplit(parentId)}
          splitHint="For an aggregated bank line (e.g. a deposit slip covering several checks)."
        />
      )}
    </div>
  );
}
