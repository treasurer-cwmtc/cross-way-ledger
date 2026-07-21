import { useEffect, useState } from "react";
import { pledgeCampaignsApi, PledgeDashboard, PledgeDashboardPoint } from "../../api/pledgeCampaigns";

function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

/** Parse a plain "YYYY-MM-DD" date (no time component) as a local-timezone
 * Date - `new Date("YYYY-MM-DD")` parses it as UTC midnight instead, which
 * `.toLocaleDateString()` then renders as the previous day in any timezone
 * behind UTC (this app's Central time included). Every other date-only
 * field in this app sidesteps the issue by printing the ISO string as-is
 * instead of round-tripping through Date - this chart needs a real Date
 * for its x-axis math, so it parses the components directly instead. */
function parseLocalDate(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** A small dependency-free line chart: cumulative giving over time against
 * the campaign goal, with a hover tooltip per point showing the rolling
 * total plus that specific day's pledged/actual amount. Kept as inline SVG
 * rather than pulling in a charting library, matching this app's existing
 * "no new dependency" bias (AccountPicker did the same for its combobox). */
function TimelineChart({ dashboard }: { dashboard: PledgeDashboard }) {
  const { timeline, goal_amount } = dashboard;
  const [hover, setHover] = useState<PledgeDashboardPoint | null>(null);

  if (timeline.length < 2) {
    return <p className="subtitle">Not enough dated giving yet to chart a trend.</p>;
  }

  const width = 720;
  const height = 240;
  const padding = { top: 12, right: 16, bottom: 36, left: 70 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const dates = timeline.map((p) => parseLocalDate(p.date).getTime());
  const minDate = Math.min(...dates);
  const maxDate = Math.max(...dates);
  const dateSpan = Math.max(maxDate - minDate, 1);

  const maxValue = Math.max(goal_amount, ...timeline.map((p) => p.running_total));

  const x = (d: number) => padding.left + ((d - minDate) / dateSpan) * plotW;
  const y = (v: number) => padding.top + plotH - (v / maxValue) * plotH;

  const linePath = timeline
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(parseLocalDate(p.date).getTime())},${y(p.running_total)}`)
    .join(" ");

  const goalY = y(goal_amount);

  // A handful of evenly-spaced x-axis date labels (not just the two ends) -
  // "more dates on the x axis" per direct feedback that only min/max wasn't
  // enough to read the trend against.
  const labelCount = Math.min(6, timeline.length);
  const axisLabels = Array.from({ length: labelCount }, (_, i) => {
    const t = minDate + (dateSpan * i) / (labelCount - 1 || 1);
    return t;
  });

  return (
    <div style={{ position: "relative" }}>
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
        {timeline.map((p, i) => {
          const cx = x(parseLocalDate(p.date).getTime());
          const cy = y(p.running_total);
          const active = hover?.date === p.date;
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={active ? 5 : 2.5}
              fill="var(--primary)"
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHover(p)}
              onMouseLeave={() => setHover((h) => (h?.date === p.date ? null : h))}
            />
          );
        })}

        {/* X-axis date labels */}
        {axisLabels.map((t, i) => (
          <text
            key={i}
            x={x(t)}
            y={height - 6}
            textAnchor={i === 0 ? "start" : i === axisLabels.length - 1 ? "end" : "middle"}
            fontSize={10.5}
            fill="var(--muted)"
          >
            {new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </text>
        ))}
      </svg>

      {hover && (
        <div
          style={{
            position: "absolute",
            left: `${(x(parseLocalDate(hover.date).getTime()) / width) * 100}%`,
            top: `${(y(hover.running_total) / height) * 100}%`,
            transform: "translate(-50%, -115%)",
            background: "var(--card-bg, #fff)",
            border: "1px solid var(--border, #ddd)",
            borderRadius: 6,
            padding: "8px 10px",
            fontSize: 12,
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            pointerEvents: "none",
            whiteSpace: "nowrap",
            zIndex: 2,
          }}
        >
          <div style={{ fontWeight: 600 }}>{parseLocalDate(hover.date).toLocaleDateString()}</div>
          <div>Rolling total: {fmtMoney(hover.running_total)}</div>
          {hover.pledged_amount > 0 && <div>Pledged that day: {fmtMoney(hover.pledged_amount)}</div>}
          {hover.actual_amount > 0 && <div>Received that day: {fmtMoney(hover.actual_amount)}</div>}
        </div>
      )}
    </div>
  );
}

export default function PledgeCampaignStatus({ campaignId }: { campaignId: number }) {
  const [dashboard, setDashboard] = useState<PledgeDashboard | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setDashboard(null);
    pledgeCampaignsApi
      .dashboard(campaignId)
      .then(setDashboard)
      .catch((err) => setError((err as Error).message));
  }, [campaignId]);

  if (error) return <div className="error">{error}</div>;
  if (!dashboard) return <p className="subtitle">Loading…</p>;

  const pct = Math.min(dashboard.percent_of_goal, 100);

  return (
    <div>
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
            <b>{fmtMoney(dashboard.campaign.starting_balance)}</b>
            <span>Starting Balance</span>
          </div>
          <div className="stat">
            <b>{fmtMoney(dashboard.goal_amount)}</b>
            <span>Pledge Goal</span>
          </div>
          <div className="stat">
            <b>{fmtMoney(dashboard.total_pledged)}</b>
            <span>Pledged Amount</span>
          </div>
          <div className="stat">
            <b>{fmtMoney(dashboard.total_actual)}</b>
            <span>Received Amount</span>
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
