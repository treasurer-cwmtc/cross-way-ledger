// The Asset Ledger: a simple standalone equipment/inventory reference list
// (mirrors the treasurer's existing "Equipment List" Google Sheet). Not
// linked to Chart of Accounts / General Ledger. Used by pages/Assets/*.
import { BASE, authHeaders, j } from "./client";

export interface Asset {
  id: number;
  purchase_date: string | null;
  category: string;
  item: string;
  count: number;
  cost: number;
  total: number; // count * cost - derived server-side, never editable directly
  notes: string;
  receipt_file_id: string;
  receipt_file_name: string;
  receipt_web_view_link: string;
}

export interface AssetCreate {
  purchase_date?: string | null;
  category?: string;
  item?: string;
  count?: number;
  cost?: number;
  notes?: string;
  receipt_file_id?: string;
  receipt_file_name?: string;
  receipt_web_view_link?: string;
}

export interface AssetUpdate extends AssetCreate {}

export interface AssetImportResult {
  imported: number;
  skipped: number;
}

export const assetsApi = {
  list: () => fetch(`${BASE}/api/assets`, { headers: authHeaders() }).then(j<Asset[]>),

  /** Distinct categories already in use, for the free-text-with-typeahead
   * category field (a fixed dropdown was explicitly not wanted). */
  categories: () =>
    fetch(`${BASE}/api/assets/categories`, { headers: authHeaders() }).then(j<string[]>),

  create: (payload: AssetCreate) =>
    fetch(`${BASE}/api/assets`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    }).then(j<Asset>),

  update: (id: number, payload: AssetUpdate) =>
    fetch(`${BASE}/api/assets/${id}`, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    }).then(j<Asset>),

  delete: (id: number) =>
    fetch(`${BASE}/api/assets/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then(j<void>),

  /** Bulk-imports an exported copy of the Equipment List sheet (Purchase
   * Date, Category, Item, Count, Cost columns). No dedup - re-importing
   * the same export creates a second copy of everything. */
  importCsv: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return fetch(`${BASE}/api/assets/import`, {
      method: "POST",
      headers: authHeaders(),
      body: fd,
    }).then(j<AssetImportResult>);
  },
};
