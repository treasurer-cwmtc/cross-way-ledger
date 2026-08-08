// Reconciliation run endpoints. Used by pages/Upload (the upload wizard).
import { BASE, authHeaders, auth, AuthError, j } from "./client";

export interface ReconLine {
  id: number;
  source: "stripe" | "bank";
  transaction_date: string;
  posted_date: string;
  description: string;
  statement_description: string;
  account_no: string;
  category: string;
  method: string;
  amount: number;
  reference: string;
  bank_description: string;
  matched: boolean;
  notes: string;
  is_stripe_payout: boolean;
}

export interface ReconLineUpdate {
  account_no?: string;
  description?: string;
  category?: string;
  method?: string;
  amount?: number;
  notes?: string;
}

export interface ReconRun {
  id: number;
  created_at: string;
  bank_filename: string;
  stripe_filename: string;
  bank_file_link: string;
  stripe_file_link: string;
  bank_line_count: number;
  stripe_line_count: number;
  matched_payout_count: number;
  unmatched_stripe_bank_count: number;
  notes: string;
  raw_bank_income_total: number;
  raw_bank_expense_total: number;
  bank_totals_by_day: Record<string, number>;
  lines: ReconLine[];
}

export interface StripeFundCheckItem {
  fund: string;
  has_rule: boolean;
  account_no: string;
  account_name: string;
}

export interface StripeFundCheckResult {
  funds: StripeFundCheckItem[];
  all_covered: boolean;
}

export interface DuplicateCheckResult {
  duplicate_line_ids: number[];
  count: number;
}

export interface SyncStatus {
  bank_last_posted: string | null;
  stripe_last_posted: string | null;
  /** Latest posted_date already sitting in ledger_actual - i.e. where a
   * prior reconciliation actually left off, distinct from the two staging
   * dates above (which just reflect the most recent sync). */
  actual_last_posted: string | null;
}

export const reconcileApi = {
  /** Wizard step 1: bank file only - Stripe-payout lines come back as
   * unmatched placeholders, merged in later via mergeStripe(). bankFileLink
   * (if the file was successfully archived to Google Drive first) is
   * carried onto every ReconciliationEntry this run eventually produces, for
   * an audit trail back to the exact file it came from. */
  bankOnly: (bankFile: File, bankFileLink?: string) => {
    const fd = new FormData();
    fd.append("bank_file", bankFile);
    if (bankFileLink) fd.append("bank_file_link", bankFileLink);
    return fetch(`${BASE}/api/reconcile`, {
      method: "POST",
      headers: authHeaders(),
      body: fd,
    }).then(j<ReconRun>);
  },

  updateLine: (lineId: number, patch: ReconLineUpdate) =>
    fetch(`${BASE}/api/reconcile/lines/${lineId}`, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(patch),
    }).then(j<ReconLine>),

  /** Wizard step 3: match this run's bank-payout placeholders against the
   * Stripe data already pulled into the transactions_stripe table by a sync (see
   * pages/Stripe) - no file to upload anymore. Every other line (including
   * edits from step 1) survives. */
  mergeStripe: (runId: number) =>
    fetch(`${BASE}/api/reconcile/${runId}/merge-stripe`, {
      method: "POST",
      headers: authHeaders(),
    }).then(j<ReconRun>),

  /** Re-applies bank-keyword rules to still-uncategorized lines - call after
   * adding a rule mid-wizard to recategorize live. */
  recategorize: (runId: number) =>
    fetch(`${BASE}/api/reconcile/${runId}/recategorize`, {
      method: "POST",
      headers: authHeaders(),
    }).then(j<ReconRun>),

  /** Wizard step 2: which donation funds in the currently-synced Stripe
   * data don't yet have a stripe_fund rule. Stateless - no run created. */
  stripeFundCheck: () =>
    fetch(`${BASE}/api/reconcile/stripe-fund-check`, {
      method: "POST",
      headers: authHeaders(),
    }).then(j<StripeFundCheckResult>),

  /** Wizard step 4: which of this run's lines would be skipped as
   * already-imported if pushed to Actual right now. Read-only. */
  duplicateCheck: (runId: number) =>
    fetch(`${BASE}/api/reconcile/${runId}/duplicate-check`, {
      headers: authHeaders(),
    }).then(j<DuplicateCheckResult>),

  /** Reconciliation page step 1: the most recent transaction date already
   * sitting in each staging table (transactions_bank / transactions_stripe), to help
   * pick where the date range should start. */
  syncStatus: () =>
    fetch(`${BASE}/api/reconcile/sync-status`, { headers: authHeaders() }).then(
      j<SyncStatus>
    ),

  /** Reconciliation page step 1/2: builds a run from the already-synced
   * transactions_bank staging table for the chosen date range, instead of a
   * manual bank-file upload - same downstream shape as bankOnly() above
   * (Stripe-payout lines come back as unmatched placeholders, merged in
   * via mergeStripe() exactly like the old CSV-upload path). Dates are
   * plain YYYY-MM-DD strings (e.g. from an <input type="date">). */
  fromBankSync: (startDate: string, endDate: string) =>
    fetch(
      `${BASE}/api/reconcile/from-bank-sync?start_date=${startDate}&end_date=${endDate}`,
      { method: "POST", headers: authHeaders() }
    ).then(j<ReconRun>),

  exportUrl: (runId: number) => `${BASE}/api/runs/${runId}/export.csv`,

  downloadExport: async (runId: number) => {
    const res = await fetch(`${BASE}/api/runs/${runId}/export.csv`, {
      headers: authHeaders(),
    });
    if (res.status === 401) {
      auth.clear();
      throw new AuthError("Session expired. Please log in again.");
    }
    if (!res.ok) throw new Error("Export failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reconciliation_run_${runId}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
