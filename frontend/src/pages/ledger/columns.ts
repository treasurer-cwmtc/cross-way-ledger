import { LedgerEntry } from "./types";

export type CellType = "checkbox" | "date" | "text" | "currency" | "select" | "account" | "readonly";

export interface ColumnDef {
  key: string;
  label: string;
  type: CellType;
  /** Whether this row has a value for this column - drives the green/red
   * header bar and the "show only bad rows" filter. Checkbox columns are
   * always considered populated (a boolean always has a value). */
  isPopulated: (e: LedgerEntry) => boolean;
  /** Read-only display text, for derived (non-editable) columns. */
  getDisplay?: (e: LedgerEntry) => string;
}

const nonEmpty = (v: string | null | undefined) => !!v && v.trim() !== "";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// CY/PY is "is this date after the Prior Year End cutoff" - matching the
// legacy sheet's Configurations!B2 ("Prior Year Date"), which the treasurer
// updates by hand at year-end rather than deriving from today's real date.
// Set via setPriorYearEndDate() once the /api/settings value loads. Shared
// across both the Reconciliation and Accrual pages (one setting, edited
// from the Reconciliation page).
let priorYearEndDate = `${new Date().getUTCFullYear() - 1}-12-31`;

export function setPriorYearEndDate(iso: string) {
  priorYearEndDate = iso;
}

export function dateParts(iso: string | null): { monthName: string; monthYear: string; year: string; cyPy: string } {
  if (!iso) return { monthName: "", monthYear: "", year: "", cyPy: "" };
  const [y, m] = iso.split("-").map(Number);
  return {
    monthName: MONTH_NAMES[m - 1] || "",
    monthYear: `${String(m).padStart(2, "0")}-${y}`,
    year: String(y),
    cyPy: iso > priorYearEndDate ? "CY" : "PY",
  };
}

export const COLUMNS: ColumnDef[] = [
  {
    key: "reconciled",
    label: "Reconciled",
    type: "checkbox",
    isPopulated: () => true,
  },
  {
    key: "is_reimbursement",
    label: "Is Reimbursement",
    type: "checkbox",
    isPopulated: () => true,
  },
  {
    key: "transaction_date",
    label: "Transaction Date",
    type: "date",
    isPopulated: (e) => !!e.transaction_date,
  },
  {
    key: "posted_date",
    label: "Posted Date",
    type: "date",
    isPopulated: (e) => !!e.posted_date,
  },
  {
    key: "statement_description",
    label: "Statement Description",
    type: "account",
    isPopulated: (e) => nonEmpty(e.account_no),
  },
  {
    key: "description",
    label: "Description",
    type: "text",
    isPopulated: (e) => nonEmpty(e.description),
  },
  {
    key: "bank_account",
    label: "Bank Account",
    type: "select",
    isPopulated: (e) => e.bank_account_id != null,
  },
  {
    key: "method",
    label: "Method",
    type: "select",
    isPopulated: (e) => nonEmpty(e.method),
  },
  {
    key: "amount",
    label: "Amount",
    type: "currency",
    isPopulated: (e) => e.amount !== null && e.amount !== undefined,
  },
  {
    key: "check_invoice_name",
    label: "Check/Invoice Name",
    type: "text",
    isPopulated: (e) => nonEmpty(e.check_invoice_name),
  },
  {
    key: "bank_description",
    label: "Bank Description",
    type: "text",
    isPopulated: (e) => nonEmpty(e.bank_description),
  },
  {
    key: "notes",
    label: "Notes",
    type: "text",
    isPopulated: (e) => nonEmpty(e.notes),
  },
  {
    key: "category",
    label: "Category",
    type: "readonly",
    isPopulated: (e) => nonEmpty(e.category),
    getDisplay: (e) => e.category,
  },
  {
    key: "type",
    label: "Type",
    type: "readonly",
    isPopulated: (e) => nonEmpty(e.category),
    // Matches the legacy sheet exactly: Type mirrors Category, except Budget
    // rows are always "Income" regardless of what they actually represent -
    // a quirk in the source data (confirmed in Import-ChartOfAccounts!L),
    // not a real distinction, but reproduced here for fidelity.
    getDisplay: (e) => (e.category === "Budget" ? "Income" : e.category),
  },
  {
    key: "statement_category",
    label: "Statement",
    type: "readonly",
    isPopulated: (e) => nonEmpty(e.statement_category),
    getDisplay: (e) => e.statement_category,
  },
  {
    key: "statement_item",
    label: "Item",
    type: "readonly",
    isPopulated: (e) => nonEmpty(e.statement_item),
    getDisplay: (e) => e.statement_item,
  },
  {
    key: "statement_detail",
    label: "Item Detail",
    type: "readonly",
    isPopulated: (e) => nonEmpty(e.statement_detail),
    getDisplay: (e) => e.statement_detail,
  },
  {
    key: "grouping",
    label: "Grouping",
    type: "readonly",
    isPopulated: (e) => nonEmpty(e.grouping),
    getDisplay: (e) => e.grouping,
  },
  {
    key: "is_youth_chaplain_share",
    label: "Youth Chaplain Share",
    type: "readonly",
    isPopulated: (e) => nonEmpty(e.is_youth_chaplain_share),
    getDisplay: (e) => e.is_youth_chaplain_share,
  },
  {
    key: "is_missions",
    label: "Missions",
    type: "readonly",
    isPopulated: (e) => nonEmpty(e.is_missions),
    getDisplay: (e) => e.is_missions,
  },
  {
    key: "txn_month_name",
    label: "Txn Month",
    type: "readonly",
    isPopulated: (e) => !!e.transaction_date,
    getDisplay: (e) => dateParts(e.transaction_date).monthName,
  },
  {
    key: "txn_month_year",
    label: "Txn Month-Year",
    type: "readonly",
    isPopulated: (e) => !!e.transaction_date,
    getDisplay: (e) => dateParts(e.transaction_date).monthYear,
  },
  {
    key: "txn_year",
    label: "Txn Year",
    type: "readonly",
    isPopulated: (e) => !!e.transaction_date,
    getDisplay: (e) => dateParts(e.transaction_date).year,
  },
  {
    key: "txn_cy_py",
    label: "Txn CY/PY",
    type: "readonly",
    isPopulated: (e) => !!e.transaction_date,
    getDisplay: (e) => dateParts(e.transaction_date).cyPy,
  },
  {
    key: "posted_month_name",
    label: "Posted Month",
    type: "readonly",
    isPopulated: (e) => !!e.posted_date,
    getDisplay: (e) => dateParts(e.posted_date).monthName,
  },
  {
    key: "posted_month_year",
    label: "Posted Month-Year",
    type: "readonly",
    isPopulated: (e) => !!e.posted_date,
    getDisplay: (e) => dateParts(e.posted_date).monthYear,
  },
  {
    key: "posted_year",
    label: "Posted Year",
    type: "readonly",
    isPopulated: (e) => !!e.posted_date,
    getDisplay: (e) => dateParts(e.posted_date).year,
  },
  {
    key: "posted_cy_py",
    label: "Posted CY/PY",
    type: "readonly",
    isPopulated: (e) => !!e.posted_date,
    getDisplay: (e) => dateParts(e.posted_date).cyPy,
  },
];

export const METHOD_OPTIONS = ["Stripe", "Check", "Debit", "Zelle", "Wire", "Deposit", "Other"];
