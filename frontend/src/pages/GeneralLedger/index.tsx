import { useEffect, useMemo, useState } from "react";
import { accountsApi, ChartAccount } from "../../api/accounts";
import { bankAccountsApi, BankAccount } from "../../api/bankAccounts";
import { generalLedgerApi, GeneralLedgerLine } from "../../api/generalLedger";
import { ledgerApi, ReconciliationEntry } from "../../api/ledger";
import { accrualApi, AccrualEntry } from "../../api/accrual";
import { budgetApi, BudgetEntry } from "../../api/budget";
import {
  DateColumnFilter,
  DateFilterValue,
  TextColumnFilter,
  dateMatchesFilter,
} from "../../components/ColumnFilter";
import TransactionModal from "../ledger/TransactionModal";
import BudgetDetailModal from "../Budget/DetailModal";

const SOURCE_LABEL: Record<GeneralLedgerLine["source"], string> = {
  reconciliation: "Actual",
  accrual: "Accrual",
  budget: "Budget",
};

const SOURCE_CLASS: Record<GeneralLedgerLine["source"], string> = {
  reconciliation: "pill bank",
  accrual: "pill stripe",
  budget: "pill warn",
};

type SortKey =
  | "source"
  | "date_posted"
  | "description"
  | "statement_description"
  | "bank_description"
  | "bank_account"
  | "method"
  | "amount";

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

/** Read-only union of every Reconciliation + Accrual + Budget line - the
 * single source financial reports should read from. Every column sorts and
 * (apart from Amount) filters. Click a row to open the same detail modal its
 * own tab (Actual/Accrual/Budget) uses - editing there updates this view too
 * once you close it and it reloads. */
export default function GeneralLedger() {
  const [lines, setLines] = useState<GeneralLedgerLine[]>([]);
  const [reconEntries, setReconEntries] = useState<ReconciliationEntry[]>([]);
  const [accrualEntries, setAccrualEntries] = useState<AccrualEntry[]>([]);
  const [budgetEntries, setBudgetEntries] = useState<BudgetEntry[]>([]);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [year, setYear] = useState<string>("");
  const [sourceFilter, setSourceFilter] = useState<string>("");
  const [sort, setSort] = useState<{ key: SortKey | null; dir: "asc" | "desc" }>({
    key: "date_posted",
    dir: "desc",
  });
  const [datePostedFilter, setDatePostedFilter] = useState<DateFilterValue | null>(null);
  const [descriptionFilter, setDescriptionFilter] = useState<Set<string> | null>(null);
  const [statementDescriptionFilter, setStatementDescriptionFilter] = useState<Set<string> | null>(null);
  const [bankDescriptionFilter, setBankDescriptionFilter] = useState<Set<string> | null>(null);
  const [bankAccountFilter, setBankAccountFilter] = useState<Set<string> | null>(null);
  const [methodFilter, setMethodFilter] = useState<Set<string> | null>(null);

  const [openReconId, setOpenReconId] = useState<number | null>(null);
  const [openAccrualId, setOpenAccrualId] = useState<number | null>(null);
  const [openBudgetId, setOpenBudgetId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [gl, recon, accrual, budget, a, b] = await Promise.all([
        generalLedgerApi.list(),
        ledgerApi.list(),
        accrualApi.list(),
        budgetApi.list(),
        accountsApi.listAccounts(),
        bankAccountsApi.list(),
      ]);
      setLines(gl);
      setReconEntries(recon);
      setAccrualEntries(accrual);
      setBudgetEntries(budget);
      setAccounts(a);
      setBankAccounts(b);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
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

  function sortValue(l: GeneralLedgerLine, key: SortKey): string | number {
    switch (key) {
      case "source":
        return SOURCE_LABEL[l.source];
      case "date_posted":
        return l.date_posted || "";
      case "description":
        return l.description;
      case "statement_description":
        return l.statement_description;
      case "bank_description":
        return l.bank_description;
      case "bank_account":
        return l.bank_account_name;
      case "method":
        return l.method;
      case "amount":
        return l.amount;
    }
  }

  const yearOptions = useMemo(
    () => Array.from(new Set(lines.flatMap((l) => (l.date_posted ? [l.date_posted.slice(0, 4)] : [])))).sort(
      (a, b) => Number(b) - Number(a)
    ),
    [lines]
  );
  const datePostedMonthOptions = useMemo(
    () => Array.from(new Set(lines.flatMap((l) => (l.date_posted ? [l.date_posted.slice(0, 7)] : [])))).sort(),
    [lines]
  );
  const descriptionOptions = useMemo(
    () => Array.from(new Set(lines.map((l) => l.description || "—"))).sort(),
    [lines]
  );
  const statementDescriptionOptions = useMemo(
    () => Array.from(new Set(lines.map((l) => l.statement_description || "— uncategorized —"))).sort(),
    [lines]
  );
  const bankDescriptionOptions = useMemo(
    () => Array.from(new Set(lines.map((l) => l.bank_description || "—"))).sort(),
    [lines]
  );
  const bankAccountOptions = useMemo(
    () => Array.from(new Set(lines.map((l) => l.bank_account_name || "—"))).sort(),
    [lines]
  );
  const methodOptions = useMemo(
    () => Array.from(new Set(lines.map((l) => l.method || "—"))).sort(),
    [lines]
  );

  const visible = useMemo(() => {
    let out = lines.filter((l) => {
      if (year && l.date_posted?.slice(0, 4) !== year) return false;
      if (sourceFilter && l.source !== sourceFilter) return false;
      if (!dateMatchesFilter(l.date_posted, datePostedFilter)) return false;
      if (descriptionFilter && !descriptionFilter.has(l.description || "—")) return false;
      if (
        statementDescriptionFilter &&
        !statementDescriptionFilter.has(l.statement_description || "— uncategorized —")
      )
        return false;
      if (bankDescriptionFilter && !bankDescriptionFilter.has(l.bank_description || "—")) return false;
      if (bankAccountFilter && !bankAccountFilter.has(l.bank_account_name || "—")) return false;
      if (methodFilter && !methodFilter.has(l.method || "—")) return false;
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
    lines,
    year,
    sourceFilter,
    datePostedFilter,
    descriptionFilter,
    statementDescriptionFilter,
    bankDescriptionFilter,
    bankAccountFilter,
    methodFilter,
    sort,
  ]);

  const total = visible.reduce((sum, l) => sum + l.amount, 0);

  function onRowClick(l: GeneralLedgerLine) {
    if (l.source === "reconciliation") setOpenReconId(l.id);
    else if (l.source === "accrual") setOpenAccrualId(l.id);
    else setOpenBudgetId(l.id);
  }

  const openRecon = openReconId ? reconEntries.find((e) => e.id === openReconId) || null : null;
  const openAccrual = openAccrualId ? accrualEntries.find((e) => e.id === openAccrualId) || null : null;
  const openBudget = openBudgetId ? budgetEntries.find((e) => e.id === openBudgetId) || null : null;

  async function onUpdateRecon(id: number, patch: Parameters<typeof ledgerApi.update>[1]) {
    const updated = await ledgerApi.update(id, patch);
    setReconEntries((prev) => prev.map((e) => (e.id === id ? updated : e)));
    await load();
  }
  async function onDeleteRecon(id: number) {
    await ledgerApi.delete(id);
    setOpenReconId(null);
    await load();
  }
  async function onUpdateAccrual(id: number, patch: Parameters<typeof accrualApi.update>[1]) {
    const updated = await accrualApi.update(id, patch);
    setAccrualEntries((prev) => prev.map((e) => (e.id === id ? updated : e)));
    await load();
  }
  async function onDeleteAccrual(id: number) {
    await accrualApi.delete(id);
    setOpenAccrualId(null);
    await load();
  }
  async function onUpdateBudget(id: number, patch: Parameters<typeof budgetApi.update>[1]) {
    const updated = await budgetApi.update(id, patch);
    setBudgetEntries((prev) => prev.map((e) => (e.id === id ? updated : e)));
    await load();
  }
  async function onDeleteBudget(id: number) {
    await budgetApi.delete(id);
    setOpenBudgetId(null);
    await load();
  }

  return (
    <div>
      <h2 className="page-title">General Ledger</h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Every Actual, Accrual, and Budget line in one place - the
        base every financial report is built from. Click a row to open its detail popup and edit
        it right here.
      </p>
      <div className="toolbar">
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <span>Posted Year:</span>
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">All</option>
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <span>Source:</span>
          <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
            <option value="">All</option>
            <option value="reconciliation">Actual</option>
            <option value="accrual">Accrual</option>
            <option value="budget">Budget</option>
          </select>
        </label>
        <span className="pill">
          {visible.length} lines · ${total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </span>
      </div>
      {error && <div className="error">{error}</div>}

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <SortableHeader label="Source" sortKey="source" activeSort={sort} onSort={onSort} />
                <SortableHeader
                  label="Posted Date"
                  sortKey="date_posted"
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
                />
                <SortableHeader
                  label="Bank Account"
                  sortKey="bank_account"
                  activeSort={sort}
                  onSort={onSort}
                  filter={
                    <TextColumnFilter
                      label="Bank Account"
                      options={bankAccountOptions}
                      selected={bankAccountFilter}
                      onChange={setBankAccountFilter}
                    />
                  }
                />
                <SortableHeader
                  label="Method"
                  sortKey="method"
                  activeSort={sort}
                  onSort={onSort}
                  filter={
                    <TextColumnFilter
                      label="Method"
                      options={methodOptions}
                      selected={methodFilter}
                      onChange={setMethodFilter}
                    />
                  }
                />
                <SortableHeader label="Amount" sortKey="amount" activeSort={sort} onSort={onSort} />
              </tr>
            </thead>
            <tbody>
              {!loading &&
                visible.map((l) => (
                  <tr
                    key={`${l.source}-${l.id}`}
                    onClick={() => onRowClick(l)}
                    style={{ cursor: "pointer" }}
                  >
                    <td>
                      <span className={SOURCE_CLASS[l.source]}>{SOURCE_LABEL[l.source]}</span>
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{l.date_posted || "—"}</td>
                    <td>{l.description || "—"}</td>
                    <td>{l.statement_description || "— uncategorized —"}</td>
                    <td style={{ whiteSpace: "normal", wordBreak: "break-word", minWidth: 260 }}>
                      {l.bank_description || "—"}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{l.bank_account_name || "—"}</td>
                    <td>{l.method || "—"}</td>
                    <td className="num" style={{ whiteSpace: "nowrap" }}>
                      ${l.amount.toFixed(2)}
                    </td>
                  </tr>
                ))}
              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ color: "var(--muted)" }}>
                    No lines match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {openRecon && (
        <TransactionModal
          entry={openRecon}
          accounts={accounts}
          bankAccounts={bankAccounts}
          onUpdate={onUpdateRecon}
          onDelete={onDeleteRecon}
          onClose={() => setOpenReconId(null)}
          onReload={load}
          onSplit={(id, splitLines) => ledgerApi.split(id, splitLines)}
          onUnsplit={(parentId) => ledgerApi.unsplit(parentId)}
          splitHint="For an aggregated bank line (e.g. a deposit slip covering several checks)."
        />
      )}
      {openAccrual && (
        <TransactionModal
          entry={openAccrual}
          accounts={accounts}
          bankAccounts={bankAccounts}
          onUpdate={onUpdateAccrual}
          onDelete={onDeleteAccrual}
          onClose={() => setOpenAccrualId(null)}
          onReload={load}
          onSplit={(id, splitLines) => accrualApi.split(id, splitLines)}
          onUnsplit={(parentId) => accrualApi.unsplit(parentId)}
        />
      )}
      {openBudget && (
        <BudgetDetailModal
          entry={openBudget}
          accounts={accounts}
          onUpdate={onUpdateBudget}
          onDelete={onDeleteBudget}
          onClose={() => setOpenBudgetId(null)}
        />
      )}
    </div>
  );
}
