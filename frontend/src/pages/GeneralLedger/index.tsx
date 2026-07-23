import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { accountsApi, ChartAccount } from "../../api/accounts";
import { bankAccountsApi, BankAccount } from "../../api/bankAccounts";
import { generalLedgerApi, GeneralLedgerLine } from "../../api/generalLedger";
import { ledgerApi, ReconciliationEntry } from "../../api/ledger";
import { accrualApi, AccrualEntry } from "../../api/accrual";
import { budgetApi, BudgetEntry } from "../../api/budget";
import { restrictedTransfersApi, RestrictedTransferEntry } from "../../api/restrictedTransfers";
import { settingsApi } from "../../api/settings";
import { dateParts, setPriorYearEndDate } from "../ledger/columns";
import {
  DateColumnFilter,
  DateFilterValue,
  TextColumnFilter,
  dateMatchesFilter,
} from "../../components/ColumnFilter";
import { ColGroup, ColResizeHandle, useColumnWidths } from "../../components/ColumnResize";
import TransactionModal from "../ledger/TransactionModal";
import BudgetDetailModal from "../Budget/DetailModal";
import RestrictedTransferDetailModal from "../RestrictedNetAssets/DetailModal";

type SortKey =
  | "transaction_date"
  | "posted_date"
  | "reconciled"
  | "statement_description"
  | "description"
  | "bank_account"
  | "method"
  | "amount"
  | "check_invoice_name"
  | "bank_description";

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
  const [transferEntries, setTransferEntries] = useState<RestrictedTransferEntry[]>([]);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [year, setYear] = useState<string>("");
  const [sourceFilter, setSourceFilter] = useState<string>("");
  const [sort, setSort] = useState<{ key: SortKey | null; dir: "asc" | "desc" }>({
    key: "posted_date",
    dir: "desc",
  });
  const [transactionDateFilter, setTransactionDateFilter] = useState<DateFilterValue | null>(null);
  const [datePostedFilter, setDatePostedFilter] = useState<DateFilterValue | null>(null);
  const [reconciledFilter, setReconciledFilter] = useState<Set<string> | null>(null);
  const [descriptionFilter, setDescriptionFilter] = useState<Set<string> | null>(null);
  const [statementDescriptionFilter, setStatementDescriptionFilter] = useState<Set<string> | null>(null);
  const [bankAccountFilter, setBankAccountFilter] = useState<Set<string> | null>(null);
  const [bankDescriptionFilter, setBankDescriptionFilter] = useState<Set<string> | null>(null);
  const [methodFilter, setMethodFilter] = useState<Set<string> | null>(null);
  const [checkInvoiceNameFilter, setCheckInvoiceNameFilter] = useState<Set<string> | null>(null);
  // A prominent, always-visible Posted Date range in the toolbar - separate
  // from the per-column filter icon (which already supports a range mode,
  // but is easy to miss) since reports are usually pulled for a specific
  // stretch of time rather than a whole year.
  const [postedFrom, setPostedFrom] = useState("");
  const [postedTo, setPostedTo] = useState("");

  const { widths, startResize } = useColumnWidths("general-ledger");

  const [openReconId, setOpenReconId] = useState<number | null>(null);
  const [openAccrualId, setOpenAccrualId] = useState<number | null>(null);
  const [openBudgetId, setOpenBudgetId] = useState<number | null>(null);
  const [openTransferId, setOpenTransferId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [gl, recon, accrual, budget, transfers, a, b, cutoff] = await Promise.all([
        generalLedgerApi.list(),
        ledgerApi.list(),
        accrualApi.list(),
        budgetApi.list(),
        restrictedTransfersApi.list(),
        accountsApi.listAccounts(),
        bankAccountsApi.list(),
        settingsApi.get("prior_year_end_date"),
      ]);
      setPriorYearEndDate(cutoff.value); // affects dateParts()'s CY/PY derivation below
      setLines(gl);
      setReconEntries(recon);
      setAccrualEntries(accrual);
      setBudgetEntries(budget);
      setTransferEntries(transfers);
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
      case "transaction_date":
        return l.transaction_date || "";
      case "posted_date":
        return l.posted_date || "";
      case "reconciled":
        return l.reconciled ? "Yes" : "No";
      case "statement_description":
        return l.statement_description;
      case "description":
        return l.description;
      case "bank_account":
        return l.bank_account_name;
      case "method":
        return l.method;
      case "amount":
        return l.amount;
      case "check_invoice_name":
        return l.check_invoice_name;
      case "bank_description":
        return l.bank_description;
    }
  }

  const yearOptions = useMemo(
    () => Array.from(new Set(lines.flatMap((l) => (l.posted_date ? [l.posted_date.slice(0, 4)] : [])))).sort(
      (a, b) => Number(b) - Number(a)
    ),
    [lines]
  );
  const transactionDateMonthOptions = useMemo(
    () => Array.from(new Set(lines.flatMap((l) => (l.transaction_date ? [l.transaction_date.slice(0, 7)] : [])))).sort(),
    [lines]
  );
  const datePostedMonthOptions = useMemo(
    () => Array.from(new Set(lines.flatMap((l) => (l.posted_date ? [l.posted_date.slice(0, 7)] : [])))).sort(),
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
  const bankAccountOptions = useMemo(
    () => Array.from(new Set(lines.map((l) => l.bank_account_name || "—"))).sort(),
    [lines]
  );
  const bankDescriptionOptions = useMemo(
    () => Array.from(new Set(lines.map((l) => l.bank_description || "—"))).sort(),
    [lines]
  );
  const methodOptions = useMemo(
    () => Array.from(new Set(lines.map((l) => l.method || "—"))).sort(),
    [lines]
  );
  const checkInvoiceNameOptions = useMemo(
    () => Array.from(new Set(lines.map((l) => l.check_invoice_name || "—"))).sort(),
    [lines]
  );

  const visible = useMemo(() => {
    let out = lines.filter((l) => {
      if (year && l.posted_date?.slice(0, 4) !== year) return false;
      if (sourceFilter && l.source !== sourceFilter) return false;
      if (!dateMatchesFilter(l.transaction_date, transactionDateFilter)) return false;
      if (!dateMatchesFilter(l.posted_date, datePostedFilter)) return false;
      if (postedFrom && (!l.posted_date || l.posted_date < postedFrom)) return false;
      if (postedTo && (!l.posted_date || l.posted_date > postedTo)) return false;
      if (reconciledFilter && !reconciledFilter.has(l.reconciled ? "Yes" : "No")) return false;
      if (descriptionFilter && !descriptionFilter.has(l.description || "—")) return false;
      if (
        statementDescriptionFilter &&
        !statementDescriptionFilter.has(l.statement_description || "— uncategorized —")
      )
        return false;
      if (bankAccountFilter && !bankAccountFilter.has(l.bank_account_name || "—")) return false;
      if (bankDescriptionFilter && !bankDescriptionFilter.has(l.bank_description || "—")) return false;
      if (methodFilter && !methodFilter.has(l.method || "—")) return false;
      if (checkInvoiceNameFilter && !checkInvoiceNameFilter.has(l.check_invoice_name || "—")) return false;
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
    transactionDateFilter,
    datePostedFilter,
    postedFrom,
    postedTo,
    reconciledFilter,
    descriptionFilter,
    statementDescriptionFilter,
    bankAccountFilter,
    bankDescriptionFilter,
    methodFilter,
    checkInvoiceNameFilter,
    sort,
  ]);

  const total = visible.reduce((sum, l) => sum + l.amount, 0);

  function onRowClick(l: GeneralLedgerLine) {
    if (l.source === "reconciliation") setOpenReconId(l.id);
    else if (l.source === "accrual") setOpenAccrualId(l.id);
    else if (l.source === "restricted_transfer") setOpenTransferId(Math.abs(l.id));
    else setOpenBudgetId(l.id);
  }

  const openRecon = openReconId ? reconEntries.find((e) => e.id === openReconId) || null : null;
  const openAccrual = openAccrualId ? accrualEntries.find((e) => e.id === openAccrualId) || null : null;
  const openBudget = openBudgetId ? budgetEntries.find((e) => e.id === openBudgetId) || null : null;
  const openTransfer = openTransferId
    ? transferEntries.find((e) => e.id === openTransferId) || null
    : null;

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
  async function onUpdateTransfer(id: number, patch: Parameters<typeof restrictedTransfersApi.update>[1]) {
    const updated = await restrictedTransfersApi.update(id, patch);
    setTransferEntries((prev) => prev.map((e) => (e.id === id ? updated : e)));
    await load();
  }
  async function onDeleteTransfer(id: number) {
    await restrictedTransfersApi.delete(id);
    setOpenTransferId(null);
    await load();
  }

  function exportToExcel() {
    const rows = visible.map((l) => {
      const txn = dateParts(l.transaction_date);
      const posted = dateParts(l.posted_date);
      return {
        "Transaction Date": l.transaction_date || "",
        "Date Posted": l.posted_date || "",
        Reconciled: l.reconciled ? "Yes" : "No",
        "Statement Description": l.statement_description,
        Description: l.description,
        "Bank Account": l.bank_account_name,
        Method: l.method,
        Amount: l.amount,
        "Check/Invoice Name": l.check_invoice_name,
        "Bank Description": l.bank_description,
        Notes: l.notes,
        IsReimbursement: l.is_reimbursement ? "Yes" : "No",
        Category: l.category,
        Statement: l.statement_category,
        Item: l.statement_item,
        ItemDetail: l.statement_detail,
        TransactionDateMonthName: txn.monthName,
        TransactionDateMonthYear: txn.monthYear,
        TransactionDateYear: txn.year,
        TransactionDateCYPY: txn.cyPy,
        PostedDateMonthName: posted.monthName,
        PostedDateMonthYear: posted.monthYear,
        PostedDateYear: posted.year,
        PostedDateCYPY: posted.cyPy,
        Grouping: l.grouping,
        IsYouthChaplainShare: l.is_youth_chaplain_share,
        IsMissions: l.is_missions,
        Type: l.category === "Budget" ? "Income" : l.category,
      };
    });
    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "General Ledger");
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const datePart = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const timePart = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    XLSX.writeFile(workbook, `${datePart}_GeneralLedger_${timePart}.xlsx`);
  }

  return (
    <div>
      <h2 className="page-title">General Ledger</h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Every Actual, Accrual, Budget, and Restricted Net Assets line in one
        place - the base every financial report is built from. Click a row to
        open its detail popup and edit it right here. Every column sorts and
        filters. Scroll right for Bank Description.
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
            <option value="restricted_transfer">Restricted Net Assets</option>
          </select>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <span>Posted Date:</span>
          <input type="date" value={postedFrom} onChange={(e) => setPostedFrom(e.target.value)} />
          <span>to</span>
          <input type="date" value={postedTo} onChange={(e) => setPostedTo(e.target.value)} />
          {(postedFrom || postedTo) && (
            <button
              className="link"
              onClick={() => {
                setPostedFrom("");
                setPostedTo("");
              }}
            >
              Clear
            </button>
          )}
        </label>
        <button className="btn secondary" onClick={exportToExcel} disabled={visible.length === 0}>
          Export to Excel
        </button>
        <span className="pill" style={{ marginLeft: "auto" }}>
          {visible.length} lines · ${total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </span>
      </div>
      {error && <div className="error">{error}</div>}

      <div className="card">
        <div className="table-wrap">
          <table className="resizable-cols">
            <ColGroup
              columns={[
                "transaction_date",
                "posted_date",
                "reconciled",
                "statement_description",
                "description",
                "bank_account",
                "method",
                "amount",
                "check_invoice_name",
                "bank_description",
              ]}
              widths={widths}
            />
            <thead>
              <tr>
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
                  label="Reconciled"
                  sortKey="reconciled"
                  activeSort={sort}
                  onSort={onSort}
                  filter={
                    <TextColumnFilter
                      label="Reconciled"
                      options={["Yes", "No"]}
                      selected={reconciledFilter}
                      onChange={setReconciledFilter}
                    />
                  }
                  resizeHandle={<ColResizeHandle col="reconciled" startResize={startResize} />}
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
                  resizeHandle={<ColResizeHandle col="bank_account" startResize={startResize} />}
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
                  resizeHandle={<ColResizeHandle col="method" startResize={startResize} />}
                />
                <SortableHeader
                  label="Amount"
                  sortKey="amount"
                  activeSort={sort}
                  onSort={onSort}
                  resizeHandle={<ColResizeHandle col="amount" startResize={startResize} />}
                />
                <SortableHeader
                  label="Check/Invoice Name"
                  sortKey="check_invoice_name"
                  activeSort={sort}
                  onSort={onSort}
                  filter={
                    <TextColumnFilter
                      label="Check/Invoice Name"
                      options={checkInvoiceNameOptions}
                      selected={checkInvoiceNameFilter}
                      onChange={setCheckInvoiceNameFilter}
                    />
                  }
                  resizeHandle={<ColResizeHandle col="check_invoice_name" startResize={startResize} />}
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
                    <td style={{ whiteSpace: "nowrap" }}>{l.transaction_date || "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{l.posted_date || "—"}</td>
                    <td>{l.reconciled ? "Yes" : "No"}</td>
                    <td>{l.statement_description || "— uncategorized —"}</td>
                    <td>{l.description || "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{l.bank_account_name || "—"}</td>
                    <td>{l.method || "—"}</td>
                    <td className="num" style={{ whiteSpace: "nowrap" }}>
                      ${l.amount.toFixed(2)}
                    </td>
                    <td>{l.check_invoice_name || "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{l.bank_description || "—"}</td>
                  </tr>
                ))}
              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ color: "var(--muted)" }}>
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
      {openTransfer && (
        <RestrictedTransferDetailModal
          entry={openTransfer}
          accounts={accounts}
          onUpdate={onUpdateTransfer}
          onDelete={onDeleteTransfer}
          onClose={() => setOpenTransferId(null)}
        />
      )}
    </div>
  );
}
