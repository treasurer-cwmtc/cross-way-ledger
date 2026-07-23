// The General Ledger: a read-only union of Reconciliation + Accrual +
// Budget rows. Used by pages/GeneralLedger. Every other financial report
// should read from this same view rather than re-deriving its own.
import { BASE, authHeaders, j } from "./client";

export interface GeneralLedgerLine {
  source: "reconciliation" | "accrual" | "budget" | "restricted_transfer";
  id: number;
  transaction_date: string | null;
  posted_date: string | null;
  reconciled: boolean;
  description: string;
  account_no: string;
  statement_description: string;
  category: string;
  statement_category: string;
  statement_item: string;
  statement_detail: string;
  grouping: string;
  is_youth_chaplain_share: string;
  is_missions: string;
  bank_account_name: string;
  bank_description: string;
  method: string;
  amount: number;
  check_invoice_name: string;
  notes: string;
  is_reimbursement: boolean;
  source_file_name: string;
  source_file_link: string;
}

export const generalLedgerApi = {
  list: (year?: number) =>
    fetch(`${BASE}/api/general-ledger${year ? `?year=${year}` : ""}`, {
      headers: authHeaders(),
    }).then(j<GeneralLedgerLine[]>),
};
