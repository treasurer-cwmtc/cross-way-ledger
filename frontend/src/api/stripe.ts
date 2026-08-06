// The synced Stripe transaction staging table - the automated counterpart
// to the Upload wizard's old manual Stripe CSV upload. Used by pages/Stripe
// and by the Upload wizard's Step2/Step3 (which read the same staged data
// via reconcile.ts's stripeFundCheck/mergeStripe rather than uploading a
// file).
import { BASE, authHeaders, j } from "./client";

export interface StripeTransaction {
  stripe_id: string;
  type: string;
  source: string;
  amount: number;
  fee: number;
  net: number;
  created: string;
  description: string;
  transfer: string;
  transfer_date: string;
  fund: string;
  donor: string;
  synced_at: string;
}

export interface StripeTransactionsResult {
  transactions: StripeTransaction[];
  last_synced_at: string | null;
  default_lookback_days: number;
}

export interface StripeSyncResult {
  fetched: number;
  added: number;
  updated: number;
  last_synced_at: string;
}

export const stripeApi = {
  list: () =>
    fetch(`${BASE}/api/stripe/transactions`, { headers: authHeaders() }).then(
      j<StripeTransactionsResult>
    ),

  /** days overrides the backend's configured default lookback window for
   * just this sync - e.g. a one-off historical backfill - without changing
   * what future "Sync now" clicks default to. */
  syncNow: (days?: number) =>
    fetch(`${BASE}/api/stripe/sync${days ? `?days=${days}` : ""}`, {
      method: "POST",
      headers: authHeaders(),
    }).then(j<StripeSyncResult>),
};
