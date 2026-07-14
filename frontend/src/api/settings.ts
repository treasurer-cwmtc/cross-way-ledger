// Tiny key/value app settings. Used by pages/Reconciliation (prior_year_end_date).
import { BASE, authHeaders, j } from "./client";

export interface AppSetting {
  key: string;
  value: string;
}

export const settingsApi = {
  get: (key: string) =>
    fetch(`${BASE}/api/settings/${key}`, { headers: authHeaders() }).then(j<AppSetting>),

  update: (key: string, value: string) =>
    fetch(`${BASE}/api/settings/${key}`, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ value }),
    }).then(j<AppSetting>),
};
