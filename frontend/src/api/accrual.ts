// The Accrual ledger: hand-entered entries (no Upload run to import from),
// same shape and split/undo-split mechanics as the Reconciliation ledger.
// Used by pages/Accrual/*.
import { BASE, authHeaders, j } from "./client";
import { LedgerEntry, LedgerEntryUpdate, SplitLine } from "../pages/ledger/types";

export type AccrualEntry = LedgerEntry;
export type AccrualEntryUpdate = LedgerEntryUpdate;
export type { SplitLine };

export interface AccrualEntryCreate {
  transaction_date?: string | null;
  posted_date?: string | null;
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

export interface SplitGroup {
  parent: AccrualEntry;
  children: AccrualEntry[];
}

export const accrualApi = {
  list: (year?: number) =>
    fetch(`${BASE}/api/accrual${year ? `?year=${year}` : ""}`, { headers: authHeaders() }).then(j<AccrualEntry[]>),

  create: (payload: AccrualEntryCreate) =>
    fetch(`${BASE}/api/accrual`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    }).then(j<AccrualEntry>),

  update: (id: number, payload: AccrualEntryUpdate) =>
    fetch(`${BASE}/api/accrual/${id}`, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    }).then(j<AccrualEntry>),

  delete: (id: number) =>
    fetch(`${BASE}/api/accrual/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then(j<void>),

  split: (id: number, lines: SplitLine[]) =>
    fetch(`${BASE}/api/accrual/${id}/split`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ lines }),
    }).then(j<AccrualEntry[]>),

  unsplit: (parentId: number) =>
    fetch(`${BASE}/api/accrual/${parentId}/unsplit`, {
      method: "POST",
      headers: authHeaders(),
    }).then(j<AccrualEntry>),

  splitGroup: (parentId: number) =>
    fetch(`${BASE}/api/accrual/split-group/${parentId}`, {
      headers: authHeaders(),
    }).then(j<SplitGroup>),
};
