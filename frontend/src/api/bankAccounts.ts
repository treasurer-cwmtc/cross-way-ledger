// Bank account lookup list. Used by pages/Upload.tsx (pick one per run) and
// pages/Reconciliation/* (dropdown + display).
import { BASE, authHeaders, j } from "./client";

export interface BankAccount {
  id: number;
  name: string;
  active: boolean;
}

export const bankAccountsApi = {
  list: () =>
    fetch(`${BASE}/api/bank-accounts`, { headers: authHeaders() }).then(j<BankAccount[]>),

  create: (name: string) =>
    fetch(`${BASE}/api/bank-accounts`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name }),
    }).then(j<BankAccount>),

  delete: (id: number) =>
    fetch(`${BASE}/api/bank-accounts/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then(j<void>),
};
