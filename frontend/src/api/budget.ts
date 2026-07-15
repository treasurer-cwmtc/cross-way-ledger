// The Budget ledger: annual Plan line-items for Budget-category (B-prefixed)
// accounts. A single account can carry more than one line in a year (e.g.
// "Salaries and Benefits" has separate Salary/Health Insurance/Retirement
// Plan/Social Security lines that sum together for reporting). Used by
// pages/Budget.
import { BASE, authHeaders, j } from "./client";

export interface BudgetEntry {
  id: number;
  transaction_date: string | null;
  account_no: string;
  description: string;
  amount: number;
  notes: string;
  statement_description: string;
  category: string;
  statement_category: string;
  statement_item: string;
  statement_detail: string;
}

export interface BudgetEntryCreate {
  transaction_date?: string | null;
  account_no?: string;
  description?: string;
  amount?: number;
  notes?: string;
}

export interface BudgetEntryUpdate {
  transaction_date?: string | null;
  account_no?: string;
  description?: string;
  amount?: number;
  notes?: string;
}

export interface BudgetCopyYearResult {
  copied: number;
}

export const budgetApi = {
  list: (year?: number) =>
    fetch(`${BASE}/api/budget${year ? `?year=${year}` : ""}`, { headers: authHeaders() }).then(
      j<BudgetEntry[]>
    ),

  create: (payload: BudgetEntryCreate) =>
    fetch(`${BASE}/api/budget`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    }).then(j<BudgetEntry>),

  update: (id: number, payload: BudgetEntryUpdate) =>
    fetch(`${BASE}/api/budget/${id}`, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    }).then(j<BudgetEntry>),

  delete: (id: number) =>
    fetch(`${BASE}/api/budget/${id}`, { method: "DELETE", headers: authHeaders() }).then(j<void>),

  copyYear: (fromYear: number, toYear: number, overwrite = false) =>
    fetch(`${BASE}/api/budget/copy-year`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ from_year: fromYear, to_year: toYear, overwrite }),
    }).then(j<BudgetCopyYearResult>),
};
