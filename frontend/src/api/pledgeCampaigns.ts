// Pledge Campaigns module: campaign management, the Pledges/Actuals
// ledgers, and the Status dashboard. Donations themselves (step 1 of the
// import wizard) live in api/donations.ts, since they're not scoped to any
// one campaign. Used by pages/PledgeCampaigns/*.
import { BASE, authHeaders, j } from "./client";

export interface PledgeCampaign {
  id: number;
  name: string;
  fund_name: string;
  goal_amount: number;
  starting_balance: number;
  is_active: boolean;
}

export interface PledgeCampaignCreate {
  name: string;
  goal_amount?: number;
  starting_balance?: number;
}

export interface Pledge {
  id: number;
  campaign_id: number;
  submission_id: string;
  first_name: string;
  last_name: string;
  email: string;
  date_submitted: string | null;
  initial_amount: number;
  due_date: string | null;
  monthly_amount: number;
  contact_method: string;
  donor_id: string | null;
  match_source: "auto" | "manual" | null;
  actual_amount: number;
}

export interface CampaignDonation {
  id: number;
  donor_id: string | null;
  fund: string;
  received_date: string | null;
  amount: number;
  net_amount: number;
  method: string;
}

export interface PledgeImportSummary {
  pledges_imported: number;
  pledges_matched: number;
  pledges_unmatched: number;
}

export interface DonorImportSummary {
  donors_imported: number;
  pledges_matched: number;
  pledges_unmatched: number;
}

export interface PledgeDashboardPoint {
  date: string;
  running_total: number;
}

export interface PledgeDashboard {
  campaign: PledgeCampaign;
  total_pledged: number;
  total_actual: number;
  total_raised: number;
  pledge_count: number;
  donation_count: number;
  goal_amount: number;
  percent_of_goal: number;
  timeline: PledgeDashboardPoint[];
}

export const pledgeCampaignsApi = {
  list: () =>
    fetch(`${BASE}/api/pledge-campaigns`, { headers: authHeaders() }).then(
      j<PledgeCampaign[]>
    ),

  create: (payload: PledgeCampaignCreate) =>
    fetch(`${BASE}/api/pledge-campaigns`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    }).then(j<PledgeCampaign>),

  /** Step 2: choose which fund (from donationsApi.funds()) this campaign
   * tracks, plus the pledge form export. */
  importPledges: (campaignId: number, fundName: string, pledgeFile: File) => {
    const fd = new FormData();
    fd.append("fund_name", fundName);
    fd.append("pledge_file", pledgeFile);
    return fetch(`${BASE}/api/pledge-campaigns/${campaignId}/import/pledges`, {
      method: "POST",
      headers: authHeaders(),
      body: fd,
    }).then(j<PledgeImportSummary>);
  },

  /** Step 3: the donor list - re-runs matching for this campaign's pledges
   * once uploaded. */
  importDonors: (campaignId: number, donorFile: File) => {
    const fd = new FormData();
    fd.append("donor_file", donorFile);
    return fetch(`${BASE}/api/pledge-campaigns/${campaignId}/import/donors`, {
      method: "POST",
      headers: authHeaders(),
      body: fd,
    }).then(j<DonorImportSummary>);
  },

  dashboard: (campaignId: number) =>
    fetch(`${BASE}/api/pledge-campaigns/${campaignId}/dashboard`, {
      headers: authHeaders(),
    }).then(j<PledgeDashboard>),

  pledges: (campaignId: number) =>
    fetch(`${BASE}/api/pledge-campaigns/${campaignId}/pledges`, {
      headers: authHeaders(),
    }).then(j<Pledge[]>),

  setPledgeMatch: (campaignId: number, pledgeId: number, donorId: string | null) =>
    fetch(`${BASE}/api/pledge-campaigns/${campaignId}/pledges/${pledgeId}/match`, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ donor_id: donorId }),
    }).then(j<Pledge>),

  donations: (campaignId: number) =>
    fetch(`${BASE}/api/pledge-campaigns/${campaignId}/donations`, {
      headers: authHeaders(),
    }).then(j<CampaignDonation[]>),
};
