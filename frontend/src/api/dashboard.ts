// The Home dashboard: quick account overview, Income/Expense YTD vs Budget,
// last data entry date. Used by pages/Home.
import { BASE, authHeaders, j } from "./client";

export interface BankAccountBalance {
  bank_account_id: number;
  name: string;
  balance: number;
}

export interface Dashboard {
  year: number;
  bank_accounts: BankAccountBalance[];
  income_ytd: number;
  income_plan_ytd: number;
  expense_ytd: number;
  expense_plan_ytd: number;
  last_entry_at: string | null;
  outstanding_reimbursements_count: number;
  outstanding_reimbursements_total: number;
}

export const dashboardApi = {
  get: () => fetch(`${BASE}/api/dashboard`, { headers: authHeaders() }).then(j<Dashboard>),
};
