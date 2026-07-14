// The persistent Reconciliation ledger (distinct from api/reconcile.ts,
// which is the one-off Upload run). Used by pages/Reconciliation/* and, for
// the "push this run to Reconciliation" action, pages/Upload.tsx.
import { BASE, authHeaders, j } from "./client";

export interface ReconciliationEntry {
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
  source_run_id: number | null;
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

export interface ReconciliationEntryUpdate {
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

export interface ImportResult {
  imported: number;
  skipped_duplicates: number;
}

export const ledgerApi = {
  list: () =>
    fetch(`${BASE}/api/reconciliation`, { headers: authHeaders() }).then(
      j<ReconciliationEntry[]>
    ),

  update: (id: number, payload: ReconciliationEntryUpdate) =>
    fetch(`${BASE}/api/reconciliation/${id}`, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    }).then(j<ReconciliationEntry>),

  delete: (id: number) =>
    fetch(`${BASE}/api/reconciliation/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then(j<void>),

  importRun: (runId: number, bankAccountId: number) =>
    fetch(`${BASE}/api/reconciliation/import-run/${runId}`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ bank_account_id: bankAccountId }),
    }).then(j<ImportResult>),
};
