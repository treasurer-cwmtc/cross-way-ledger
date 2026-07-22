// Categorization rules endpoints. Used by pages/Rules.tsx.
import { BASE, authHeaders, j } from "./client";

export interface Rule {
  id: number;
  rule_type: "bank_keyword" | "stripe_fund";
  pattern: string;
  account_no: string;
  // Friendly "who/what" name (e.g. "Sams Club") stamped onto a matched
  // bank line's Description field - only meaningful for bank_keyword rules.
  description: string;
  priority: number;
  active: boolean;
  created_at: string;
}

export const rulesApi = {
  listRules: (ruleType?: string) =>
    fetch(`${BASE}/api/rules${ruleType ? `?rule_type=${ruleType}` : ""}`, {
      headers: authHeaders(),
    }).then(j<Rule[]>),

  createRule: (r: Partial<Rule>) =>
    fetch(`${BASE}/api/rules`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(r),
    }).then(j<Rule>),

  updateRule: (id: number, r: Partial<Rule>) =>
    fetch(`${BASE}/api/rules/${id}`, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(r),
    }).then(j<Rule>),

  deleteRule: (id: number) =>
    fetch(`${BASE}/api/rules/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then(j<void>),
};
