const BASE = import.meta.env.VITE_API_BASE || "";

export interface ChartAccount {
  account_no: string;
  category: string;
  statement_category: string;
  statement_item: string;
  statement_detail: string;
  statement_description: string;
  is_tax_deductible: string;
  is_mandatory: string;
}

export interface Rule {
  id: number;
  rule_type: "bank_keyword" | "stripe_fund";
  pattern: string;
  account_no: string;
  priority: number;
  active: boolean;
  created_at: string;
}

export interface ReconLine {
  id: number;
  source: "stripe" | "bank";
  transaction_date: string;
  date_posted: string;
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
}

export interface ReconRun {
  id: number;
  created_at: string;
  bank_filename: string;
  stripe_filename: string;
  bank_line_count: number;
  stripe_line_count: number;
  matched_payout_count: number;
  unmatched_stripe_bank_count: number;
  notes: string;
  lines: ReconLine[];
}

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listAccounts: (category?: string) =>
    fetch(`${BASE}/api/accounts${category ? `?category=${category}` : ""}`).then(
      j<ChartAccount[]>
    ),

  uploadAccounts: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return fetch(`${BASE}/api/accounts/upload`, { method: "POST", body: fd }).then(
      j<{ loaded: number }>
    );
  },

  listRules: (ruleType?: string) =>
    fetch(`${BASE}/api/rules${ruleType ? `?rule_type=${ruleType}` : ""}`).then(
      j<Rule[]>
    ),

  createRule: (r: Partial<Rule>) =>
    fetch(`${BASE}/api/rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(r),
    }).then(j<Rule>),

  updateRule: (id: number, r: Partial<Rule>) =>
    fetch(`${BASE}/api/rules/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(r),
    }).then(j<Rule>),

  deleteRule: (id: number) =>
    fetch(`${BASE}/api/rules/${id}`, { method: "DELETE" }).then((res) => {
      if (!res.ok) throw new Error("Delete failed");
    }),

  reconcile: (bankFile: File, stripeFile: File) => {
    const fd = new FormData();
    fd.append("bank_file", bankFile);
    fd.append("stripe_file", stripeFile);
    return fetch(`${BASE}/api/reconcile`, { method: "POST", body: fd }).then(
      j<ReconRun>
    );
  },

  exportUrl: (runId: number) => `${BASE}/api/runs/${runId}/export.csv`,
};
