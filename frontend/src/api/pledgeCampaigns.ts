// Pledge Campaigns module: campaign management, the 3-file import, the
// Pledges/Actuals ledgers, and the Status dashboard. Used by
// pages/PledgeCampaigns/*.
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
  fund_name: string;
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

export interface PledgeCampaignDonation {
  id: number;
  campaign_id: number;
  donor_id: string | null;
  received_date: string | null;
  amount: number;
  net_amount: number;
  method: string;
}

export interface PledgeImportSummary {
  donors_imported: number;
  pledges_imported: number;
  donations_imported: number;
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

  importData: (campaignId: number, pledgeFile: File, donationFile: File, donorFile: File) => {
    const fd = new FormData();
    fd.append("pledge_file", pledgeFile);
    fd.append("donation_file", donationFile);
    fd.append("donor_file", donorFile);
    return fetch(`${BASE}/api/pledge-campaigns/${campaignId}/import`, {
      method: "POST",
      headers: authHeaders(),
      body: fd,
    }).then(j<PledgeImportSummary>);
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
    }).then(j<PledgeCampaignDonation[]>),
};
