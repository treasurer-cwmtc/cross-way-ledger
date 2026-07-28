// Reimbursements module, submitter-side: the public portal a church member
// uses to log in (email + emailed one-time code, not the app's normal
// login) and submit/track reimbursement requests. Deliberately a separate
// token store from api/client.ts's `auth` - that module's 401 handler calls
// auth.clear(), which would wipe the wrong session if this reused it (see
// the Reimbursements module plan). Used by pages/ReimbursementPortal/*.
import { BASE } from "./client";

const SUBMITTER_TOKEN_KEY = "recon_submitter_token";

export const submitterAuth = {
  get token(): string | null {
    return localStorage.getItem(SUBMITTER_TOKEN_KEY);
  },
  set(token: string) {
    localStorage.setItem(SUBMITTER_TOKEN_KEY, token);
  },
  clear() {
    localStorage.removeItem(SUBMITTER_TOKEN_KEY);
  },
};

export function submitterAuthHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const t = submitterAuth.token;
  return t ? { ...extra, Authorization: `Bearer ${t}` } : extra;
}

export class SubmitterAuthError extends Error {}

async function sj<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    submitterAuth.clear();
    throw new SubmitterAuthError("Please log in again.");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface ReimbursementAssignment {
  account_no: string;
  statement_description: string;
}

export interface ReimbursementLineIn {
  account_no: string;
  amount: number;
  description?: string;
  receipt_file_id?: string;
  receipt_file_name?: string;
  receipt_web_view_link?: string;
}

export interface ReimbursementLine {
  id: number;
  account_no: string;
  statement_description: string;
  amount: number;
  description: string;
  receipt_file_id: string;
  receipt_file_name: string;
  receipt_web_view_link: string;
}

export interface Reimbursement {
  id: number;
  name: string;
  submitter_email: string;
  submitter_name: string;
  status: "pending" | "approved" | "paid" | "rejected";
  notes: string;
  total_amount: number;
  submitted_at: string;
  decided_at: string | null;
  paid_at: string | null;
  lines: ReimbursementLine[];
}

export interface ReceiptUpload {
  file_id: string;
  file_name: string;
  web_view_link: string;
}

export const reimbursementPortalApi = {
  requestOtp: (email: string) =>
    fetch(`${BASE}/api/reimbursements/request-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }).then(sj<{ message: string }>),

  verifyOtp: async (email: string, code: string) => {
    const result = await fetch(`${BASE}/api/reimbursements/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code }),
    }).then(sj<{ token: string; name: string }>);
    submitterAuth.set(result.token);
    return result;
  },

  myCoas: () =>
    fetch(`${BASE}/api/reimbursements/my/coas`, { headers: submitterAuthHeaders() }).then(
      sj<ReimbursementAssignment[]>
    ),

  uploadReceipt: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetch(`${BASE}/api/reimbursements/receipts/upload`, {
      method: "POST",
      headers: submitterAuthHeaders(),
      body: form,
    }).then(sj<ReceiptUpload>);
  },

  submit: (lines: ReimbursementLineIn[]) =>
    fetch(`${BASE}/api/reimbursements/my`, {
      method: "POST",
      headers: submitterAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ lines }),
    }).then(sj<Reimbursement>),

  myRequests: () =>
    fetch(`${BASE}/api/reimbursements/my`, { headers: submitterAuthHeaders() }).then(sj<Reimbursement[]>),

  myRequest: (id: number) =>
    fetch(`${BASE}/api/reimbursements/my/${id}`, { headers: submitterAuthHeaders() }).then(sj<Reimbursement>),

  updateMyRequest: (id: number, lines: ReimbursementLineIn[]) =>
    fetch(`${BASE}/api/reimbursements/my/${id}`, {
      method: "PUT",
      headers: submitterAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ lines }),
    }).then(sj<Reimbursement>),
};
