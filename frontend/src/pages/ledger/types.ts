// Shared shape between the Reconciliation ledger and the Accrual ledger -
// two distinct backend tables/endpoints, but structurally identical rows
// (same Chart-of-Accounts-driven derived fields, same split/undo-split
// mechanics), so the register/popup/split UI in this folder is written once
// against this interface and reused by both pages/Reconciliation and
// pages/Accrual.

export interface LedgerEntry {
  id: number;
  transaction_date: string | null; // YYYY-MM-DD
  date_posted: string | null;
  reconciled: boolean;
  is_reimbursement: boolean;
  account_no: string;
  description: string;
  bank_account_id: number | null;
  bank_account_name: string;
  method: string;
  amount: number;
  check_invoice_name: string;
  bank_description: string;
  notes: string;
  split_parent_id: number | null;
  // Derived live from the linked Chart of Accounts row - read-only.
  statement_description: string;
  category: string;
  statement_category: string;
  statement_item: string;
  statement_detail: string;
  grouping: string;
  is_youth_chaplain_share: string;
  is_missions: string;
}

export interface LedgerEntryUpdate {
  transaction_date?: string | null;
  date_posted?: string | null;
  reconciled?: boolean;
  is_reimbursement?: boolean;
  account_no?: string;
  description?: string;
  bank_account_id?: number | null;
  method?: string;
  amount?: number;
  check_invoice_name?: string;
  bank_description?: string;
  notes?: string;
}

export interface SplitLine {
  description?: string;
  account_no?: string;
  amount: number;
  notes?: string;
  check_invoice_name?: string;
}
