// Automated Chase bank sync via Plaid - the "Bank Transactions" page. Shape
// mirrors api/stripe.ts closely: connect once (Plaid Link), then Sync now
// pulls new/changed transactions into a staging table (ledger_plaid) with
// the same columns as a manually-exported Chase CSV (see BankRow in
// backend/app/services/parsers.py) - nothing here touches the ledger by
// itself.
import { BASE, authHeaders, j } from "./client";

export interface PlaidItemSummary {
  id: number;
  item_id: string;
  institution_name: string;
  created_at: string;
}

export interface PlaidTransaction {
  plaid_transaction_id: string;
  item_id: string;
  account_id: string;
  details: string;
  posting_date: string;
  description: string;
  amount: number;
  type: string;
  pending: boolean;
  removed: boolean;
  synced_at: string;
}

export interface PlaidTransactionsResult {
  items: PlaidItemSummary[];
  transactions: PlaidTransaction[];
  last_synced_at: string | null;
}

export interface PlaidSyncResult {
  fetched: number;
  added: number;
  modified: number;
  removed: number;
  last_synced_at: string;
}

export const plaidApi = {
  linkToken: () =>
    fetch(`${BASE}/api/plaid/link-token`, {
      method: "POST",
      headers: authHeaders(),
    }).then(j<{ link_token: string }>),

  exchange: (publicToken: string, institutionName: string) =>
    fetch(`${BASE}/api/plaid/exchange`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ public_token: publicToken, institution_name: institutionName }),
    }).then(j<PlaidItemSummary>),

  disconnect: (itemDbId: number) =>
    fetch(`${BASE}/api/plaid/items/${itemDbId}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then((res) => {
      if (!res.ok) throw new Error("Failed to disconnect.");
    }),

  list: () =>
    fetch(`${BASE}/api/plaid/transactions`, { headers: authHeaders() }).then(
      j<PlaidTransactionsResult>
    ),

  syncNow: () =>
    fetch(`${BASE}/api/plaid/sync`, {
      method: "POST",
      headers: authHeaders(),
    }).then(j<PlaidSyncResult>),
};
