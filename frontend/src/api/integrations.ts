// Setup > Integrations Status - one read-only dashboard listing every
// external API integration the app syncs from. Admin-only backend
// (routers/integrations.py), same sensitivity level as Users.
import { BASE, authHeaders, j } from "./client";

export interface IntegrationStatus {
  key: string;
  label: string;
  description: string;
  sync_now_endpoint: string;
  scheduled_sync_endpoint: string;
  last_synced_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  configured: boolean;
  scheduled_sync_configured: boolean;
}

export const integrationsApi = {
  status: () =>
    fetch(`${BASE}/api/integrations/status`, { headers: authHeaders() }).then(
      j<IntegrationStatus[]>
    ),
};
