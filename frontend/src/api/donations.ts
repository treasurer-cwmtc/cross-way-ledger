// The Giving App donations import - source of truth, not scoped to any one
// campaign. Step 1 of the pledge campaign import wizard.
import { BASE, authHeaders, j } from "./client";

export interface FundSummary {
  name: string;
  count: number;
  total: number;
}

export interface DonationImportSummary {
  donations_imported: number;
  funds: FundSummary[];
}

export const donationsApi = {
  funds: () => fetch(`${BASE}/api/donations/funds`, { headers: authHeaders() }).then(j<FundSummary[]>),

  import: (donationFile: File) => {
    const fd = new FormData();
    fd.append("donation_file", donationFile);
    return fetch(`${BASE}/api/donations/import`, {
      method: "POST",
      headers: authHeaders(),
      body: fd,
    }).then(j<DonationImportSummary>);
  },
};
