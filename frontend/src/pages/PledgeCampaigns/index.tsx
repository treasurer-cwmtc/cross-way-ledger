import { useState } from "react";
import { User } from "../../api/auth";
import { useCampaign } from "./useCampaign";
import Status from "./Status";
import Pledges from "./Pledges";
import Actuals from "./Actuals";

type SubTab = "status" | "pledges" | "actuals";

const SUB_TABS: { key: SubTab; label: string; permission: string }[] = [
  { key: "status", label: "Status", permission: "pledge-campaign-status" },
  { key: "pledges", label: "Pledges", permission: "pledge-campaign-pledges" },
  { key: "actuals", label: "Actuals", permission: "pledge-campaign-actuals" },
];

/** Single "Campaign Status" nav entry replacing what used to be three
 * separate pages (Phase 2 Status / Pledges / Actuals) - a shared campaign
 * picker up top, and Status/Pledges/Actuals as sub-tabs underneath, each
 * still gated by its own permission key so a user granted only one of the
 * three still sees just that one. */
export default function PledgeCampaigns({ user }: { user: User }) {
  const { campaigns, campaign, campaignId, setCampaignId, error } = useCampaign();
  const visibleTabs = SUB_TABS.filter((t) => user.is_admin || user.permissions.includes(t.permission));
  const [subTab, setSubTab] = useState<SubTab>(visibleTabs[0]?.key ?? "status");

  if (error) return <div className="error">{error}</div>;
  if (!campaigns) return <p className="subtitle">Loading…</p>;
  if (campaigns.length === 0) {
    return (
      <div>
        <h2 className="page-title">Campaign Status</h2>
        <p className="subtitle">
          No pledge campaigns yet - create one on the Import Campaigns page.
        </p>
      </div>
    );
  }

  const activeTab = visibleTabs.find((t) => t.key === subTab) ? subTab : visibleTabs[0]?.key;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <h2 className="page-title">{campaign ? campaign.name : "Campaign"} Status</h2>
        <label className="field" style={{ maxWidth: 260 }}>
          <span>Campaign</span>
          <select
            value={campaignId ?? ""}
            onChange={(ev) => setCampaignId(Number(ev.target.value))}
          >
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="sub-tabs" style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            className={"btn" + (activeTab === t.key ? "" : " secondary")}
            onClick={() => setSubTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {campaign && campaignId != null && (
        <>
          {activeTab === "status" && <Status campaignId={campaignId} />}
          {activeTab === "pledges" && (
            <Pledges campaignId={campaignId} hideDonorNames={user.hide_donor_names} />
          )}
          {activeTab === "actuals" && (
            <Actuals
              campaignId={campaignId}
              fundName={campaign.fund_name}
              hideDonorNames={user.hide_donor_names}
            />
          )}
        </>
      )}
    </div>
  );
}
