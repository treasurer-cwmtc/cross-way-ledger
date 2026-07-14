// Chart of Accounts endpoints. Used by pages/Accounts/* and (read-only, for
// its account picker) pages/Rules.tsx.
import { BASE, authHeaders, j } from "./client";

export interface StatementCategory {
  id: number;
  category: string; // Budget | Expense | Income
  no: string;
  name: string;
}

export interface StatementItem {
  id: number;
  statement_category_id: number;
  no: string;
  name: string;
}

export interface ChartAccount {
  account_no: string;
  statement_item_id: number;
  category: string;
  statement_category: string;
  statement_category_no: string;
  statement_item: string;
  statement_item_no: string;
  statement_detail: string;
  statement_detail_no: string;
  statement_description: string;
  is_tax_deductible: string;
  is_mandatory: string;
  grouping: string;
  is_youth_chaplain_share: string;
  is_missions: string;
}

export interface ChartAccountCreate {
  statement_item_id: number;
  statement_detail?: string;
  statement_description?: string;
  is_tax_deductible?: string;
  is_mandatory?: string;
  grouping?: string;
  is_youth_chaplain_share?: string;
  is_missions?: string;
}

export interface AccountNoPreview {
  account_no: string;
  statement_category_no: string;
  statement_item_no: string;
  statement_detail_no: string;
}

export const accountsApi = {
  listAccounts: (category?: string) =>
    fetch(`${BASE}/api/accounts${category ? `?category=${category}` : ""}`, {
      headers: authHeaders(),
    }).then(j<ChartAccount[]>),

  listStatementCategories: (category?: string) =>
    fetch(`${BASE}/api/accounts/statement-categories${category ? `?category=${category}` : ""}`, {
      headers: authHeaders(),
    }).then(j<StatementCategory[]>),

  createStatementCategory: (category: string, name: string) =>
    fetch(`${BASE}/api/accounts/statement-categories`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ category, name }),
    }).then(j<StatementCategory>),

  deleteStatementCategory: (id: number) =>
    fetch(`${BASE}/api/accounts/statement-categories/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then(j<void>),

  listStatementItems: (statementCategoryId?: number) =>
    fetch(
      `${BASE}/api/accounts/statement-items${
        statementCategoryId ? `?statement_category_id=${statementCategoryId}` : ""
      }`,
      { headers: authHeaders() }
    ).then(j<StatementItem[]>),

  createStatementItem: (statementCategoryId: number, name: string) =>
    fetch(`${BASE}/api/accounts/statement-items`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ statement_category_id: statementCategoryId, name }),
    }).then(j<StatementItem>),

  deleteStatementItem: (id: number) =>
    fetch(`${BASE}/api/accounts/statement-items/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then(j<void>),

  previewAccountNo: (payload: ChartAccountCreate) =>
    fetch(`${BASE}/api/accounts/preview-number`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    }).then(j<AccountNoPreview>),

  createAccount: (payload: ChartAccountCreate) =>
    fetch(`${BASE}/api/accounts`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    }).then(j<ChartAccount>),

  updateAccount: (accountNo: string, payload: Partial<ChartAccount>) =>
    fetch(`${BASE}/api/accounts/${accountNo}`, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    }).then(j<ChartAccount>),

  deleteAccount: (accountNo: string) =>
    fetch(`${BASE}/api/accounts/${accountNo}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then(j<void>),
};
