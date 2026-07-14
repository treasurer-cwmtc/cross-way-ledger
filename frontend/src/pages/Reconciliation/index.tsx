import { useEffect, useMemo, useState } from "react";
import { accountsApi, ChartAccount } from "../../api/accounts";
import { bankAccountsApi, BankAccount } from "../../api/bankAccounts";
import { ledgerApi, ReconciliationEntry, ReconciliationEntryUpdate } from "../../api/ledger";
import { COLUMNS } from "./columns";
import ColumnHeader from "./ColumnHeader";
import EntryRow from "./EntryRow";

export default function Reconciliation() {
  const [entries, setEntries] = useState<ReconciliationEntry[]>([]);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [error, setError] = useState("");
  const [filterColumn, setFilterColumn] = useState<string | null>(null);

  async function load() {
    try {
      const [e, a, b] = await Promise.all([
        ledgerApi.list(),
        accountsApi.listAccounts(),
        bankAccountsApi.list(),
      ]);
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
    if (!confirm("Delete this reconciliation entry?")) return;
    try {
      await ledgerApi.delete(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div>
      <p className="subtitle" style={{ marginTop: 0 }}>
        The permanent, editable ledger — push rows here from the Upload tab. Every
        cell is editable directly in the grid. Statement Description is always
        whatever the linked Chart of Accounts account currently says. Click a
        column header to filter down to just the rows missing that column.
      </p>
      {error && <div className="error">{error}</div>}
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
                {COLUMNS.map((col) => {
                  const c = completeness.get(col.key)!;
                  return (
                    <ColumnHeader
                      key={col.key}
                      label={col.label}
                      complete={c.complete}
                      missingCount={c.missingCount}
                      active={filterColumn === col.key}
                      onToggleFilter={() =>
                        setFilterColumn((prev) => (prev === col.key ? null : col.key))
                      }
                    />
                  );
                })}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleEntries.map((e) => (
                <EntryRow
                  key={e.id}
                  entry={e}
                  accounts={accounts}
                  bankAccounts={bankAccounts}
                  onUpdate={onUpdate}
                  onDelete={onDelete}
                />
              ))}
              {visibleEntries.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length + 1} style={{ color: "var(--muted)" }}>
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
    </div>
  );
}
