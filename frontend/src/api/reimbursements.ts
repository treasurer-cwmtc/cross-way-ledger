// Reimbursements module, treasurer-side: PCO People import, per-email
// Chart-of-Accounts assignments, and the review queue. Uses the app's
// normal authHeaders()/j() - unlike api/reimbursementPortal.ts, which is the
// separately-authenticated submitter-facing half of this same backend
// router. Used by pages/Reimbursements/*.
import { BASE, authHeaders, j } from "./client";

export interface PcoPerson {
  person_id: string;
  name: string;
  email: string;
  phone_number: string;
  // PCO's own Person.status ("active", "inactive", etc.) - only "active"
  // people can log into the Reimbursement portal (see backend's
  // is_allowed_reimbursement_submitter), but every status is synced and
  // shown here.
  status: string;
}

export interface PcoPeopleImportSummary {
  people_imported: number;
  last_synced_at: string | null;
}

export interface PcoLastSynced {
  last_synced_at: string | null;
}

export interface PcoListOption {
  id: string;
  name: string;
}

export interface ReimbursementGateList {
  list_id: string | null;
  list_name: string | null;
  member_count: number;
}

export interface ReimbursementAssignment {
  account_no: string;
  statement_description: string;
}

export interface ReimbursementAccessSummary {
  email: string;
  name: string;
  account_nos: string[];
}

export interface ReimbursementLine {
  id: number;
  account_no: string;
  statement_description: string;
  amount: number;
  description: string;
  transaction_date: string | null;
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

export const reimbursementsApi = {
  importPcoPeople: (file: File) => {
    const form = new FormData();
    form.append("people_file", file);
    return fetch(`${BASE}/api/reimbursements/pco-people/import`, {
      method: "POST",
      headers: authHeaders(),
      body: form,
    }).then(j<PcoPeopleImportSummary>);
  },

  listPcoPeople: () =>
    fetch(`${BASE}/api/reimbursements/pco-people`, { headers: authHeaders() }).then(j<PcoPerson[]>),

  /** Live counterpart to importPcoPeople - pulls every member (any status)
   * straight from the PCO People API instead of a manual CSV upload. */
  syncPcoPeople: () =>
    fetch(`${BASE}/api/reimbursements/pco-people/sync`, {
      method: "POST",
      headers: authHeaders(),
    }).then(j<PcoPeopleImportSummary>),

  getPcoPeopleLastSynced: () =>
    fetch(`${BASE}/api/reimbursements/pco-people/last-synced`, { headers: authHeaders() }).then(
      j<PcoLastSynced>
    ),

  listPcoLists: () =>
    fetch(`${BASE}/api/reimbursements/pco-lists`, { headers: authHeaders() }).then(
      j<PcoListOption[]>
    ),

  getGateList: () =>
    fetch(`${BASE}/api/reimbursements/reimbursement-gate-list`, { headers: authHeaders() }).then(
      j<ReimbursementGateList>
    ),

  setGateList: (listId: string | null) =>
    fetch(`${BASE}/api/reimbursements/reimbursement-gate-list`, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ list_id: listId }),
    }).then(j<ReimbursementGateList>),

  getAssignments: (email: string) =>
    fetch(`${BASE}/api/reimbursements/assignments?email=${encodeURIComponent(email)}`, {
      headers: authHeaders(),
    }).then(j<ReimbursementAssignment[]>),

  setAssignments: (email: string, accountNos: string[]) =>
    fetch(`${BASE}/api/reimbursements/assignments?email=${encodeURIComponent(email)}`, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ account_nos: accountNos }),
    }).then(j<ReimbursementAssignment[]>),

  getAssignmentsSummary: () =>
    fetch(`${BASE}/api/reimbursements/assignments-summary`, { headers: authHeaders() }).then(
      j<ReimbursementAccessSummary[]>
    ),

  list: (status?: string) =>
    fetch(`${BASE}/api/reimbursements${status ? `?status=${status}` : ""}`, {
      headers: authHeaders(),
    }).then(j<Reimbursement[]>),

  get: (id: number) =>
    fetch(`${BASE}/api/reimbursements/${id}`, { headers: authHeaders() }).then(j<Reimbursement>),

  updateStatus: (id: number, status: string, notes?: string) =>
    fetch(`${BASE}/api/reimbursements/${id}/status`, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ status, notes }),
    }).then(j<Reimbursement>),
};
