// The persistent Giving App donor list - Config > "Giving App - Donors",
// and the lookup behind the Pledges page's donor picker.
import { BASE, authHeaders, j } from "./client";

export interface Donor {
  donor_id: string;
  donor_number: string;
  first_name: string;
  last_name: string;
  email: string;
  phone_number: string;
  city: string;
  state: string;
  zip_code: string;
  joint_giver_id: string;
  joint_giver_first_name: string;
  joint_giver_last_name: string;
  first_donated: string | null;
  donation_count: number;
  total_given: number;
  source_file_name: string;
  source_file_link: string;
}

export interface DonorGift {
  id: number;
  fund: string;
  received_date: string | null;
  amount: number;
  net_amount: number;
  method: string;
  source_file_name: string;
  source_file_link: string;
}

export const donorsApi = {
  list: () => fetch(`${BASE}/api/donors`, { headers: authHeaders() }).then(j<Donor[]>),

  /** Every gift this donor has given, across every fund - not scoped to
   * one campaign, for the Donors page's click-to-expand detail popup. */
  gifts: (donorId: string) =>
    fetch(`${BASE}/api/donors/${encodeURIComponent(donorId)}/gifts`, { headers: authHeaders() }).then(
      j<DonorGift[]>
    ),
};
