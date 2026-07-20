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
  donation_count: number;
  total_given: number;
}

export const donorsApi = {
  list: () => fetch(`${BASE}/api/donors`, { headers: authHeaders() }).then(j<Donor[]>),
};
