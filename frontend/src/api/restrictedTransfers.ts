// The Restricted Net Assets ledger: permanent reclassifications between two
// Chart-of-Accounts lines (e.g. releasing money earmarked in a restricted
// fund into the account being funded). Unlike Accrual, nothing here is
// meant to later clear against a bank transaction - the transfer itself is
// the permanent economic event. Used by pages/RestrictedNetAssets/*.
import { BASE, authHeaders, j } from "./client";

export interface RestrictedTransferEntry {
  id: number;
  transaction_date: string | null;
  from_account_no: string;
  from_statement_description: string;
  to_account_no: string;
  to_statement_description: string;
  amount: number;
  description: string;
  notes: string;
}

export interface RestrictedTransferEntryCreate {
  transaction_date?: string | null;
  from_account_no?: string;
  to_account_no?: string;
  amount?: number;
  description?: string;
  notes?: string;
}

export interface RestrictedTransferEntryUpdate {
  transaction_date?: string | null;
  from_account_no?: string;
  to_account_no?: string;
  amount?: number;
  description?: string;
  notes?: string;
}

export const restrictedTransfersApi = {
  list: () =>
    fetch(`${BASE}/api/restricted-transfers`, { headers: authHeaders() }).then(
      j<RestrictedTransferEntry[]>
    ),

  create: (payload: RestrictedTransferEntryCreate) =>
    fetch(`${BASE}/api/restricted-transfers`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    }).then(j<RestrictedTransferEntry>),

  update: (id: number, payload: RestrictedTransferEntryUpdate) =>
    fetch(`${BASE}/api/restricted-transfers/${id}`, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    }).then(j<RestrictedTransferEntry>),

  delete: (id: number) =>
    fetch(`${BASE}/api/restricted-transfers/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then(j<void>),
};
