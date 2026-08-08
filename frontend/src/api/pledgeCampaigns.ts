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
  // Which PCO Form this campaign syncs pledges from live - blank means it
  // still uses the manual CSV pledge import (see PledgeFormMapping below).
  pco_form_id: string;
}

export interface PledgeCampaignCreate {
  name: string;
  goal_amount?: number;
  starting_balance?: number;
}

export interface PledgeCampaignUpdate {
  name?: string;
  fund_name?: string;
  goal_amount?: number;
  starting_balance?: number;
  is_active?: boolean;
  pco_form_id?: string;
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
  source_file_name: string;
  source_file_link: string;
}

export interface CampaignDonation {
  id: number;
  donor_id: string | null;
  donor_first_name: string;
  donor_last_name: string;
  donor_email: string;
  fund: string;
  received_date: string | null;
  amount: number;
  net_amount: number;
  method: string;
  source_file_name: string;
  source_file_link: string;
}

export interface PledgeImportSummary {
  pledges_imported: number;
  pledges_matched: number;
  pledges_unmatched: number;
  new_pledges: Pledge[];
  updated_pledges: Pledge[];
}

/** One row of the combined Details tab - either a pledge (has_pledge true,
 * with its own due_date), or - for someone who gave to this fund but never
 * submitted a pledge form - a synthesized row with pledged_amount 0 and no
 * due_date. donor_id is null only for the one row grouping every donation
 * that never matched any donor record at all. `key` is opaque - pass it
 * straight to detail() to open the popup.
 *
 * When the matched donor has a joint giver with no pledge of their own,
 * actual_amount already includes that spouse's donations (folded in
 * server-side) - joint_giver_* here is just for display/context. */
export interface CampaignDetailRow {
  key: string;
  donor_id: string | null;
  first_name: string;
  last_name: string;
  email: string;
  pledged_amount: number;
  actual_amount: number;
  due_date: string | null;
  has_pledge: boolean;
  joint_giver_id: string;
  joint_giver_first_name: string;
  joint_giver_last_name: string;
  source_file_name: string;
  source_file_link: string;
}

export interface CampaignDetail {
  pledge: Pledge | null;
  donor_id: string | null;
  joint_giver_id: string;
  joint_giver_first_name: string;
  joint_giver_last_name: string;
  first_name: string;
  last_name: string;
  email: string;
  gifts: CampaignDonation[];
}

export interface DonorImportSummary {
  donors_imported: number;
  pledges_matched: number;
  pledges_unmatched: number;
}

export interface PcoFormOption {
  id: string;
  name: string;
  active: boolean;
}

export interface PcoFormFieldOption {
  id: string;
  label: string;
  field_type: string;
}

export interface PledgeFormMapping {
  campaign_id: number;
  initial_amount_field_id: string;
  due_date_field_id: string;
  monthly_amount_field_id: string;
  contact_method_field_id: string;
}

export interface PledgeFormMappingUpdate {
  form_id: string;
  initial_amount_field_id: string;
  due_date_field_id: string;
  monthly_amount_field_id: string;
  contact_method_field_id: string;
}

export interface PledgeFormSyncSummary {
  campaign_id: number;
  pledges_imported: number;
  pledges_matched: number;
  pledges_unmatched: number;
}

export interface GivingPersonLink {
  donor_id: string;
  donor_name: string;
  person_id: string | null;
  person_name: string | null;
  match_source: "auto" | "manual" | null;
}

export interface PledgeDashboardPoint {
  date: string;
  running_pledged_total: number;
  running_actual_total: number;
  pledged_amount: number;
  actual_amount: number;
}

export interface PledgeDashboard {
  campaign: PledgeCampaign;
  total_pledged: number;
  total_actual: number;
  total_raised: number;
  // Money already given by someone with no pledge on file - counts toward
  // the goal alongside total_pledged, since a gift already in hand is at
  // least as strong a commitment as a pledge.
  unpledged_actual: number;
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

  update: (campaignId: number, payload: PledgeCampaignUpdate) =>
    fetch(`${BASE}/api/pledge-campaigns/${campaignId}`, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    }).then(j<PledgeCampaign>),

  /** Step 2: choose which fund (from donationsApi.funds()) this campaign
   * tracks, plus the pledge form export. sourceFile identifies the Drive
   * archive copy (see lib/googleDrive.ts::uploadCampaignImportFile) -
   * omitted if that upload failed, which never blocks the data import. */
  importPledges: (
    campaignId: number,
    fundName: string,
    pledgeFile: File,
    sourceFile?: { name: string; url: string }
  ) => {
    const fd = new FormData();
    fd.append("fund_name", fundName);
    fd.append("pledge_file", pledgeFile);
    if (sourceFile) {
      fd.append("source_file_name", sourceFile.name);
      fd.append("source_file_link", sourceFile.url);
    }
    return fetch(`${BASE}/api/pledge-campaigns/${campaignId}/import/pledges`, {
      method: "POST",
      headers: authHeaders(),
      body: fd,
    }).then(j<PledgeImportSummary>);
  },

  /** Step 3: the donor list - re-runs matching for this campaign's pledges
   * once uploaded. */
  importDonors: (campaignId: number, donorFile: File, sourceFile?: { name: string; url: string }) => {
    const fd = new FormData();
    fd.append("donor_file", donorFile);
    if (sourceFile) {
      fd.append("source_file_name", sourceFile.name);
      fd.append("source_file_link", sourceFile.url);
    }
    return fetch(`${BASE}/api/pledge-campaigns/${campaignId}/import/donors`, {
      method: "POST",
      headers: authHeaders(),
      body: fd,
    }).then(j<DonorImportSummary>);
  },

  /** Live counterpart to importDonors - pulls donor profiles from the
   * Giving API instead of a manual CSV upload. Not campaign-scoped (donors
   * never were), so this re-runs matching across every active campaign. */
  syncDonors: () =>
    fetch(`${BASE}/api/pco/giving/donors/sync`, {
      method: "POST",
      headers: authHeaders(),
    }).then(j<DonorImportSummary>),

  getDonorsLastSynced: () =>
    fetch(`${BASE}/api/pco/giving/donors/last-synced`, { headers: authHeaders() }).then(
      j<{ last_synced_at: string | null }>
    ),

  /** Every PCO Form in the account, for the wizard's "Sync from a Planning
   * Center Form" picker. */
  listPcoForms: () =>
    fetch(`${BASE}/api/pco/forms`, { headers: authHeaders() }).then(j<PcoFormOption[]>),

  listPcoFormFields: (formId: string) =>
    fetch(`${BASE}/api/pco/forms/${encodeURIComponent(formId)}/fields`, {
      headers: authHeaders(),
    }).then(j<PcoFormFieldOption[]>),

  getPledgeFormMapping: (campaignId: number) =>
    fetch(`${BASE}/api/pledge-campaigns/${campaignId}/pledge-form-mapping`, {
      headers: authHeaders(),
    }).then(j<PledgeFormMapping>),

  /** Saves the field mapping and - in the same call - sets/changes which
   * form the campaign syncs from (see PledgeFormMappingUpdate). */
  setPledgeFormMapping: (campaignId: number, payload: PledgeFormMappingUpdate) =>
    fetch(`${BASE}/api/pledge-campaigns/${campaignId}/pledge-form-mapping`, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    }).then(j<PledgeFormMapping>),

  /** Manual "Sync now" for a campaign already configured with a form. */
  syncCampaignPledges: (campaignId: number) =>
    fetch(`${BASE}/api/pco/forms/${campaignId}/sync`, {
      method: "POST",
      headers: authHeaders(),
    }).then(j<PledgeFormSyncSummary>),

  listGivingPeopleLinks: () =>
    fetch(`${BASE}/api/pco/giving/people-links`, { headers: authHeaders() }).then(
      j<GivingPersonLink[]>
    ),

  setGivingPeopleLink: (donorId: string, personId: string | null) =>
    fetch(`${BASE}/api/pco/giving/people-links/${encodeURIComponent(donorId)}`, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ person_id: personId }),
    }).then(j<GivingPersonLink>),

  dashboard: (campaignId: number) =>
    fetch(`${BASE}/api/pledge-campaigns/${campaignId}/dashboard`, {
      headers: authHeaders(),
    }).then(j<PledgeDashboard>),

  setPledgeMatch: (campaignId: number, pledgeId: number, donorId: string | null) =>
    fetch(`${BASE}/api/pledge-campaigns/${campaignId}/pledges/${pledgeId}/match`, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ donor_id: donorId }),
    }).then(j<Pledge>),

  /** The combined Details tab: pledges plus anyone who gave without
   * pledging. */
  details: (campaignId: number) =>
    fetch(`${BASE}/api/pledge-campaigns/${campaignId}/details`, {
      headers: authHeaders(),
    }).then(j<CampaignDetailRow[]>),

  detail: (campaignId: number, key: string) =>
    fetch(`${BASE}/api/pledge-campaigns/${campaignId}/details/${encodeURIComponent(key)}`, {
      headers: authHeaders(),
    }).then(j<CampaignDetail>),
};
