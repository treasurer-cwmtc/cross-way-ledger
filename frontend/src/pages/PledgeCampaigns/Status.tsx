import { useEffect, useState } from "react";
import { pledgeCampaignsApi, PledgeDashboard } from "../../api/pledgeCampaigns";
import { useCampaign } from "./useCampaign";

function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

/** A small dependency-free line chart: cumulative giving over time against
 * the campaign goal. Kept as inline SVG rather than pulling in a charting
 * library, matching this app's existing "no new dependency" bias
 * (AccountPicker did the same for its combobox). */
function TimelineChart({ dashboard }: { dashboard: PledgeDashboard }) {
  const { timeline, goal_amount } = dashboard;
  if (timeline.length < 2) {
    return <p className="subtitle">Not enough dated giving yet to chart a trend.</p>;
  }

  const width = 720;
  const height = 220;
  const padding = { top: 12, right: 16, bottom: 24, left: 70 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const dates = timeline.map((p) => new Date(p.date).getTime());
  const minDate = Math.min(...dates);
  const maxDate = Math.max(...dates);
  const dateSpan = Math.max(maxDate - minDate, 1);

  const maxValue = Math.max(goal_amount, ...timeline.map((p) => p.running_total));

  const x = (d: number) => padding.left + ((d - minDate) / dateSpan) * plotW;
  const y = (v: number) => padding.top + plotH - (v / maxValue) * plotH;

  const linePath = timeline
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(new Date(p.date).getTime())},${y(p.running_total)}`)
    .join(" ");

  const goalY = y(goal_amount);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto" }}>
      {/* Goal reference line */}
      <line
        x1={padding.left}
        y1={goalY}
        x2={width - padding.right}
        y2={goalY}
        stroke="var(--red)"
        strokeDasharray="4 4"
        strokeWidth={1}
      />
      <text x={width - padding.right} y={goalY - 6} textAnchor="end" fontSize={11} fill="var(--red)">
        Goal: {fmtMoney(goal_amount)}
      </text>

      {/* Cumulative giving line */}
      <path d={linePath} fill="none" stroke="var(--primary)" strokeWidth={2.5} />
      {timeline.map((p, i) => (
        <circle
          key={i}
          cx={x(new Date(p.date).getTime())}
          cy={y(p.running_total)}
          r={2.5}
          fill="var(--primary)"
        />
      ))}

      {/* Axis labels */}
      <text x={padding.left} y={height - 4} fontSize={11} fill="var(--muted)">
        {new Date(minDate).toLocaleDateString()}
      </text>
      <text x={width - padding.right} y={height - 4} textAnchor="end" fontSize={11} fill="var(--muted)">
        {new Date(maxDate).toLocaleDateString()}
      </text>
    </svg>
  );
}

export default function PledgeCampaignStatus() {
  const { campaign, campaignId, error: campaignError } = useCampaign();
  const [dashboard, setDashboard] = useState<PledgeDashboard | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (campaignId == null) return;
    pledgeCampaignsApi
      .dashboard(campaignId)
      .then(setDashboard)
      .catch((err) => setError((err as Error).message));
  }, [campaignId]);

  if (campaignError || error) return <div className="error">{campaignError || error}</div>;
  if (!campaign) return <p className="subtitle">Loading…</p>;
  if (!dashboard) return <p className="subtitle">Loading…</p>;

  const pct = Math.min(dashboard.percent_of_goal, 100);

  return (
    <div>
      <h2 className="page-title">{campaign.name} Status</h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Quick progress overview - see Pledges and Actuals for the full detail.
      </p>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Progress toward goal</h3>
        <div className="goal-progress-track">
          <div className="goal-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="goal-progress-label">
          <span>{fmtMoney(dashboard.total_raised)} raised</span>
          <span>{dashboard.percent_of_goal}% of {fmtMoney(dashboard.goal_amount)} goal</span>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>At a glance</h3>
        <div className="stats">
          <div className="stat">
            <b>{fmtMoney(dashboard.total_pledged)}</b>
            <span>Total Pledged</span>
          </div>
          <div className="stat">
            <b>{fmtMoney(dashboard.total_actual)}</b>
            <span>Received (this campaign)</span>
          </div>
          <div className="stat">
            <b>{fmtMoney(dashboard.total_raised)}</b>
            <span>Total Raised (incl. starting balance)</span>
          </div>
          <div className="stat">
            <b>{dashboard.pledge_count}</b>
            <span>Number of Pledges</span>
          </div>
          <div className="stat">
            <b>{dashboard.donation_count}</b>
            <span>Number of Gifts</span>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Giving over time</h3>
        <TimelineChart dashboard={dashboard} />
      </div>
    </div>
  );
}
