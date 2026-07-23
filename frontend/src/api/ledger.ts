// The persistent Reconciliation ledger (distinct from api/reconcile.ts,
// which is the one-off Upload run, and from api/accrual.ts, the manually-
// entered ledger). Used by pages/Reconciliation/* and, for the "push this
// run to Reconciliation" action, pages/Upload.tsx.
import { BASE, authHeaders, j } from "./client";
import { LedgerEntry, LedgerEntryUpdate, SplitLine } from "../pages/ledger/types";

export type ReconciliationEntry = LedgerEntry & { source_run_id: number | null };
export type ReconciliationEntryUpdate = LedgerEntryUpdate;
export type { SplitLine };

export interface ImportResult {
  imported: number;
  skipped_duplicates: number;
}

export interface SplitGroup {
  parent: ReconciliationEntry;
  children: ReconciliationEntry[];
}

export const ledgerApi = {
  list: (year?: number) =>
    fetch(`${BASE}/api/reconciliation${year ? `?year=${year}` : ""}`, { headers: authHeaders() }).then(
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

  split: (id: number, lines: SplitLine[]) =>
    fetch(`${BASE}/api/reconciliation/${id}/split`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ lines }),
    }).then(j<ReconciliationEntry[]>),

  unsplit: (parentId: number) =>
    fetch(`${BASE}/api/reconciliation/${parentId}/unsplit`, {
      method: "POST",
      headers: authHeaders(),
    }).then(j<ReconciliationEntry>),

  splitGroup: (parentId: number) =>
    fetch(`${BASE}/api/reconciliation/split-group/${parentId}`, {
      headers: authHeaders(),
    }).then(j<SplitGroup>),
};
