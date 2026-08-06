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
}

export interface StripeFundCheckResult {
  funds: StripeFundCheckItem[];
  all_covered: boolean;
}

export interface DuplicateCheckResult {
  duplicate_line_ids: number[];
  count: number;
}

export const reconcileApi = {
  reconcile: (bankFile: File, stripeFile: File) => {
    const fd = new FormData();
    fd.append("bank_file", bankFile);
    fd.append("stripe_file", stripeFile);
    return fetch(`${BASE}/api/reconcile`, {
      method: "POST",
      headers: authHeaders(),
      body: fd,
    }).then(j<ReconRun>);
  },

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

  /** Wizard step 3: match the Stripe file against this run's bank-payout
   * placeholders. Every other line (including edits from step 1) survives.
   * stripeFileLink carries the archived-to-Drive copy's link the same way
   * bankOnly's bankFileLink does. */
  mergeStripe: (runId: number, stripeFile: File, stripeFileLink?: string) => {
    const fd = new FormData();
    fd.append("stripe_file", stripeFile);
    if (stripeFileLink) fd.append("stripe_file_link", stripeFileLink);
    return fetch(`${BASE}/api/reconcile/${runId}/merge-stripe`, {
      method: "POST",
      headers: authHeaders(),
      body: fd,
    }).then(j<ReconRun>);
  },

  /** Re-applies bank-keyword rules to still-uncategorized lines - call after
   * adding a rule mid-wizard to recategorize live. */
  recategorize: (runId: number) =>
    fetch(`${BASE}/api/reconcile/${runId}/recategorize`, {
      method: "POST",
      headers: authHeaders(),
    }).then(j<ReconRun>),

  /** Wizard step 2: which donation funds in this Stripe file don't yet have
   * a stripe_fund rule. Stateless - no run created. */
  stripeFundCheck: (stripeFile: File) => {
    const fd = new FormData();
    fd.append("stripe_file", stripeFile);
    return fetch(`${BASE}/api/reconcile/stripe-fund-check`, {
      method: "POST",
      headers: authHeaders(),
      body: fd,
    }).then(j<StripeFundCheckResult>);
  },

  /** Wizard step 4: which of this run's lines would be skipped as
   * already-imported if pushed to Actual right now. Read-only. */
  duplicateCheck: (runId: number) =>
    fetch(`${BASE}/api/reconcile/${runId}/duplicate-check`, {
      headers: authHeaders(),
    }).then(j<DuplicateCheckResult>),

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
