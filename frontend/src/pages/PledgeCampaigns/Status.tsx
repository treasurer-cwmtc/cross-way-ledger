import { useEffect, useState } from "react";
import { pledgeCampaignsApi, PledgeDashboard } from "../../api/pledgeCampaigns";

function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

/** Compact axis-label form: $550,000 -> $550K, $1,200,000 -> $1.2M. */
function fmtMoneyShort(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (abs >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
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

const COLOR_PLEDGED = "var(--amber)";
const COLOR_ACTUAL = "var(--primary)";
const COLOR_GOAL = "var(--red)";

/** A small dependency-free line chart: cumulative pledged vs. cumulative
 * actual (received) giving over time, against the campaign goal. Kept as
 * inline SVG rather than pulling in a charting library, matching this app's
 * existing "no new dependency" bias (AccountPicker did the same for its
 * combobox).
 *
 * Hovering anywhere over the plot (not just a dot) shows a single crosshair
 * that marks all three series - Goal, Pledged, Actual - at that x position
 * and a tooltip with all three numbers, so comparing them doesn't mean
 * hovering three separate lines one at a time. Since every series here is a
 * running total (a step function - it only changes on a day something
 * happened), "the value at this x" is always the last recorded point at or
 * before the hovered date, not an interpolation. */
function TimelineChart({ dashboard }: { dashboard: PledgeDashboard }) {
  const { timeline, goal_amount } = dashboard;
  const [hoverX, setHoverX] = useState<number | null>(null);

  if (timeline.length < 2) {
    return <p className="subtitle">Not enough dated giving yet to chart a trend.</p>;
  }

  const width = 760;
  const height = 320;
  const padding = { top: 28, right: 20, bottom: 42, left: 78 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const plotLeft = padding.left;
  const plotRight = width - padding.right;
  const plotTop = padding.top;
  const plotBottom = height - padding.bottom;

  const points = timeline.map((p) => ({ ...p, t: parseLocalDate(p.date).getTime() }));
  const minDate = points[0].t;
  const maxDate = points[points.length - 1].t;
  const dateSpan = Math.max(maxDate - minDate, 1);

  const maxValue = Math.max(
    goal_amount,
    ...points.map((p) => p.running_pledged_total),
    ...points.map((p) => p.running_actual_total),
    1
  );

  const x = (t: number) => plotLeft + ((t - minDate) / dateSpan) * plotW;
  const y = (v: number) => plotTop + plotH - (v / maxValue) * plotH;
  const xToDate = (px: number) => minDate + ((px - plotLeft) / plotW) * dateSpan;

  const pledgedPath = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t)},${y(p.running_pledged_total)}`).join(" ");
  const actualPath = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t)},${y(p.running_actual_total)}`).join(" ");

  const goalY = y(goal_amount);
  const last = points[points.length - 1];

  // A handful of evenly-spaced x-axis date labels (not just the two ends).
  const xLabelCount = Math.min(6, points.length);
  const xLabels = Array.from({ length: xLabelCount }, (_, i) => minDate + (dateSpan * i) / (xLabelCount - 1 || 1));

  // Y-axis gridlines/labels - 5 evenly spaced ticks from 0 to the max.
  const yTickCount = 5;
  const yTicks = Array.from({ length: yTickCount + 1 }, (_, i) => (maxValue * i) / yTickCount);

  // Step-function lookup: the last point at or before the hovered date.
  function pointAt(t: number): (typeof points)[number] {
    let candidate = points[0];
    for (const p of points) {
      if (p.t > t) break;
      candidate = p;
    }
    return candidate;
  }

  const hoverPoint = hoverX == null ? null : pointAt(xToDate(hoverX));
  const hoverPx = hoverPoint ? x(hoverPoint.t) : null;

  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", gap: 18, marginBottom: 8, fontSize: 12.5 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 14, height: 3, background: COLOR_PLEDGED, display: "inline-block", borderRadius: 2 }} />
          Pledged (running total)
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 14, height: 3, background: COLOR_ACTUAL, display: "inline-block", borderRadius: 2 }} />
          Actual (running total)
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 14,
              height: 0,
              borderTop: `2px dashed ${COLOR_GOAL}`,
              display: "inline-block",
            }}
          />
          Goal
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: "100%", height: "auto", cursor: "crosshair" }}
      >
        {/* Y-axis gridlines + labels */}
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={plotLeft} y1={y(v)} x2={plotRight} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
            <text x={plotLeft - 8} y={y(v) + 4} textAnchor="end" fontSize={10.5} fill="var(--muted)">
              {fmtMoneyShort(v)}
            </text>
          </g>
        ))}

        {/* Goal reference line - label sits above the line with a background
            so it stays legible no matter what crosses behind it. */}
        <line x1={plotLeft} y1={goalY} x2={plotRight} y2={goalY} stroke={COLOR_GOAL} strokeDasharray="4 4" strokeWidth={1.5} />
        <rect x={plotRight - 108} y={Math.max(goalY - 20, 2)} width={108} height={16} fill="var(--card)" opacity={0.9} />
        <text x={plotRight} y={Math.max(goalY - 8, 14)} textAnchor="end" fontSize={11.5} fontWeight={600} fill={COLOR_GOAL}>
          Goal: {fmtMoney(goal_amount)}
        </text>

        {/* Cumulative pledged + actual lines */}
        <path d={pledgedPath} fill="none" stroke={COLOR_PLEDGED} strokeWidth={2.5} />
        <path d={actualPath} fill="none" stroke={COLOR_ACTUAL} strokeWidth={2.5} />

        {/* Latest-value labels at the last dot of each line. The last point
            always sits exactly at plotRight (it's "today"), so a label
            placed to its right - past the edge of the viewBox - gets
            silently clipped; anchoring "end" and placing it to the LEFT of
            the dot instead keeps it fully on-canvas. A background rect
            behind each (same trick as the goal label) keeps it legible
            over the gridlines/lines that cross behind it. */}
        {(() => {
          const pledgedY = y(last.running_pledged_total);
          const actualY = y(last.running_actual_total);
          // If the two latest values are close together, stack their labels
          // further apart than "just above/below the dot" so they don't
          // collide with each other.
          const tooClose = Math.abs(pledgedY - actualY) < 20;
          const pledgedLabelY = tooClose ? Math.min(pledgedY, actualY) - 12 : pledgedY - 8;
          const actualLabelY = tooClose ? Math.max(pledgedY, actualY) + 16 : actualY + 16;
          const labelText = (yPos: number, text: string, color: string) => (
            <>
              <rect
                x={plotRight - 90}
                y={yPos - 12}
                width={90}
                height={16}
                fill="var(--card)"
                opacity={0.9}
              />
              <text x={plotRight - 4} y={yPos} textAnchor="end" fontSize={11.5} fontWeight={700} fill={color}>
                {text}
              </text>
            </>
          );
          return (
            <>
              <circle cx={x(last.t)} cy={pledgedY} r={3.5} fill={COLOR_PLEDGED} />
              <circle cx={x(last.t)} cy={actualY} r={3.5} fill={COLOR_ACTUAL} />
              {labelText(pledgedLabelY, fmtMoney(last.running_pledged_total), COLOR_PLEDGED)}
              {labelText(actualLabelY, fmtMoney(last.running_actual_total), COLOR_ACTUAL)}
            </>
          );
        })()}

        {/* Crosshair: one vertical line + a marker on each of the 3 series,
            at whatever x the mouse is over - not three separate hover targets. */}
        {hoverPoint && hoverPx != null && (
          <>
            <line x1={hoverPx} y1={plotTop} x2={hoverPx} y2={plotBottom} stroke="var(--muted)" strokeWidth={1} strokeDasharray="3 3" />
            <circle cx={hoverPx} cy={y(hoverPoint.running_pledged_total)} r={5} fill={COLOR_PLEDGED} stroke="var(--card)" strokeWidth={1.5} />
            <circle cx={hoverPx} cy={y(hoverPoint.running_actual_total)} r={5} fill={COLOR_ACTUAL} stroke="var(--card)" strokeWidth={1.5} />
            <circle cx={hoverPx} cy={goalY} r={5} fill={COLOR_GOAL} stroke="var(--card)" strokeWidth={1.5} />
          </>
        )}

        {/* X-axis date labels */}
        {xLabels.map((t, i) => (
          <text
            key={i}
            x={x(t)}
            y={height - 8}
            textAnchor={i === 0 ? "start" : i === xLabels.length - 1 ? "end" : "middle"}
            fontSize={10.5}
            fill="var(--muted)"
          >
            {new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </text>
        ))}

        {/* Transparent capture surface for crosshair hover - covers the
            whole plot area, not just the dots, so hovering anywhere works. */}
        <rect
          x={plotLeft}
          y={plotTop}
          width={plotW}
          height={plotH}
          fill="transparent"
          onMouseMove={(ev) => {
            const rect = ev.currentTarget.ownerSVGElement!.getBoundingClientRect();
            const px = ((ev.clientX - rect.left) / rect.width) * width;
            setHoverX(Math.max(plotLeft, Math.min(plotRight, px)));
          }}
          onMouseLeave={() => setHoverX(null)}
        />
      </svg>

      {hoverPoint && hoverPx != null && (
        <div
          style={{
            position: "absolute",
            left: `${(hoverPx / width) * 100}%`,
            top: `${(Math.min(y(hoverPoint.running_pledged_total), y(hoverPoint.running_actual_total), goalY) / height) * 100}%`,
            transform: "translate(-50%, -115%)",
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "8px 10px",
            fontSize: 12,
            boxShadow: "var(--shadow-md)",
            pointerEvents: "none",
            whiteSpace: "nowrap",
            zIndex: 2,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{parseLocalDate(hoverPoint.date).toLocaleDateString()}</div>
          <div style={{ color: COLOR_GOAL }}>Goal: {fmtMoney(goal_amount)}</div>
          <div style={{ color: COLOR_PLEDGED }}>Pledged: {fmtMoney(hoverPoint.running_pledged_total)}</div>
          <div style={{ color: COLOR_ACTUAL }}>Actual: {fmtMoney(hoverPoint.running_actual_total)}</div>
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
          <span>{fmtMoney(dashboard.total_actual)} raised</span>
          <span>
            {dashboard.percent_of_goal}% of {fmtMoney(dashboard.goal_amount)} goal
          </span>
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
