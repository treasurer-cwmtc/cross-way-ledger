// Shared "which campaign is active" logic for the Status/Pledges/Actuals
// pages. Today there's exactly one (Phase 2), but pledge_campaigns is a
// real table so future campaigns just show up here without code changes -
// this picks the first active one, with a dropdown once there's ever more
// than one to choose from.
import { useEffect, useState } from "react";
import { pledgeCampaignsApi, PledgeCampaign } from "../../api/pledgeCampaigns";

export function useCampaign() {
  const [campaigns, setCampaigns] = useState<PledgeCampaign[] | null>(null);
  const [campaignId, setCampaignId] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    pledgeCampaignsApi
      .list()
      .then((list) => {
        setCampaigns(list);
        const active = list.find((c) => c.is_active) ?? list[0];
        if (active) setCampaignId(active.id);
      })
      .catch((err) => setError((err as Error).message));
  }, []);

  const campaign = campaigns?.find((c) => c.id === campaignId) ?? null;
  return { campaigns, campaign, campaignId, setCampaignId, error };
}
