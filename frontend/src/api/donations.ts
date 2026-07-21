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

  /** sourceFile identifies the Drive archive copy of this CSV (see
   * lib/googleDrive.ts::uploadCampaignImportFile) - omitted if that upload
   * failed, which never blocks the data import itself. */
  import: (donationFile: File, sourceFile?: { name: string; url: string }) => {
    const fd = new FormData();
    fd.append("donation_file", donationFile);
    if (sourceFile) {
      fd.append("source_file_name", sourceFile.name);
      fd.append("source_file_link", sourceFile.url);
    }
    return fetch(`${BASE}/api/donations/import`, {
      method: "POST",
      headers: authHeaders(),
      body: fd,
    }).then(j<DonationImportSummary>);
  },

  deleteFund: (fundName: string) =>
    fetch(`${BASE}/api/donations/funds/${encodeURIComponent(fundName)}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then(j<FundSummary[]>),
};
