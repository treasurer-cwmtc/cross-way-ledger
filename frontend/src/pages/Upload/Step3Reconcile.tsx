import { Fragment, useMemo, useState } from "react";
import { reconcileApi, ReconLine, ReconRun } from "../../api/reconcile";
import { getCurrentFiscalYear } from "../../api/settings";
import { uploadBankOrStripeFile } from "../../lib/googleDrive";
import { ColGroup, ColResizeHandle, useColumnWidths } from "../../components/ColumnResize";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export default function Step3Reconcile(props: {
  run: ReconRun;
  stripeFile: File | null;
  onRunChange: (run: ReconRun) => void;
  onNext: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const { widths, startResize } = useColumnWidths("upload-step3-by-day");
  const { widths: issueWidths, startResize: startIssueResize } = useColumnWidths(
    "upload-step3-issue-lines"
  );

  const run = props.run;

  async function doReconcile() {
    if (!props.stripeFile) return;
    setBusy(true);
    setError("");
    // Same best-effort Drive archiving as the bank file in Step 1 - a
    // failure here never blocks the actual merge.
    let stripeFileLink: string | undefined;
    try {
      const year = await getCurrentFiscalYear();
      const archived = await uploadBankOrStripeFile(props.stripeFile, year);
      stripeFileLink = archived.url;
    } catch {
      stripeFileLink = undefined;
    }
    try {
      props.onRunChange(await reconcileApi.mergeStripe(run.id, props.stripeFile, stripeFileLink));
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const byDay = useMemo(() => {
    const map = new Map<
      string,
      {
        stripeTotal: number;
        count: number;
        issueLines: ReconLine[];
        adjustmentLines: ReconLine[];
      }
    >();
    for (const l of run.lines) {
      if (l.source !== "stripe") continue;
      const day = l.posted_date || "unknown";
      const row = map.get(day) || {
        stripeTotal: 0,
        count: 0,
        issueLines: [],
        adjustmentLines: [],
      };
      row.stripeTotal += l.amount;
      row.count += 1;
      if (!l.matched) {
        // A "STRIPE PAYOUT ADJUSTMENT" line is expected, harmless fee/timing
        // rounding - its whole purpose is to make the day's total balance
        // exactly, so it shouldn't itself trigger "needs attention". Only
        // genuine failures (couldn't match a payout, or matched one with no
        // donation detail) are real issues.
        if (l.description === "STRIPE PAYOUT ADJUSTMENT") {
          row.adjustmentLines.push(l);
        } else {
          row.issueLines.push(l);
        }
      }
      map.set(day, row);
    }
    return [...map.entries()]
      .map(([day, row]) => {
        // bank_totals_by_day is captured once at merge time - the *original*
        // bank amount for that day, independent of the exploded Stripe
        // lines above. They should always agree by construction, unless a
        // line got edited afterward - that's exactly what this catches.
        const bankTotal = round2(run.bank_totals_by_day?.[day] ?? row.stripeTotal);
        const variance = round2(row.stripeTotal - bankTotal);
        return {
          day,
          ...row,
          bankTotal,
          variance,
          hasIssue: row.issueLines.length > 0 || Math.abs(variance) >= 0.01,
        };
      })
      .sort((a, b) => a.day.localeCompare(b.day));
  }, [run.lines, run.bank_totals_by_day]);

  const totalUnmatched = run.unmatched_stripe_bank_count;
  const totalBankStripeLines = run.matched_payout_count + totalUnmatched;

  return (
    <div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Reconcile</h3>
        <p className="subtitle">
          Match every Stripe bank deposit to its underlying donations, and confirm the
          dollar amounts line up day by day.
        </p>
        {!done && (
          <button className="btn" onClick={doReconcile} disabled={!props.stripeFile || busy}>
            {busy ? "Reconciling…" : "Reconcile"}
          </button>
        )}
        {error && <div className="error">{error}</div>}
      </div>

      {done && (
        <>
          <div className="card">
            <div className="stats">
              <div className="stat">
                <b>{run.matched_payout_count}</b>
                <span>Payouts matched</span>
              </div>
              <div className="stat">
                <b style={{ color: totalUnmatched ? "#dc2626" : undefined }}>{totalUnmatched}</b>
                <span>Unmatched Stripe payouts</span>
              </div>
              <div className="stat">
                <b>{totalBankStripeLines}</b>
                <span>Total Stripe bank lines</span>
              </div>
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>By day</h3>
            <table className="resizable-cols">
              <ColGroup
                columns={["posted_date", "bank_total", "stripe_total", "variance", "lines", "status"]}
                widths={widths}
              />
              <thead>
                <tr>
                  <th>
                    Date posted
                    <ColResizeHandle col="posted_date" startResize={startResize} />
                  </th>
                  <th className="num">
                    Bank total
                    <ColResizeHandle col="bank_total" startResize={startResize} />
                  </th>
                  <th className="num">
                    Stripe total
                    <ColResizeHandle col="stripe_total" startResize={startResize} />
                  </th>
                  <th className="num">
                    Variance
                    <ColResizeHandle col="variance" startResize={startResize} />
                  </th>
                  <th className="num">
                    Lines
                    <ColResizeHandle col="lines" startResize={startResize} />
                  </th>
                  <th>
                    Status
                    <ColResizeHandle col="status" startResize={startResize} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {byDay.map((row) => (
                  <Fragment key={row.day}>
                    <tr
                      className={row.hasIssue ? "register-row" : undefined}
                      onClick={() =>
                        row.hasIssue && setExpandedDay(expandedDay === row.day ? null : row.day)
                      }
                    >
                      <td>{row.day}</td>
                      <td className="num">{row.bankTotal.toFixed(2)}</td>
                      <td className="num">{row.stripeTotal.toFixed(2)}</td>
                      <td
                        className="num"
                        style={{ color: row.variance ? "var(--red)" : undefined }}
                      >
                        {row.variance.toFixed(2)}
                      </td>
                      <td className="num">{row.count}</td>
                      <td>
                        {row.hasIssue ? (
                          <span className="pill warn">
                            Needs attention {expandedDay === row.day ? "▲" : "▼"}
                          </span>
                        ) : (
                          <span className="pill bank">✓ Matched</span>
                        )}
                      </td>
                    </tr>
                    {expandedDay === row.day && (
                      <tr>
                        <td colSpan={6} style={{ background: "var(--bg)" }}>
                          {row.issueLines.length > 0 ? (
                            <table style={{ margin: "4px 0" }} className="resizable-cols">
                              <ColGroup
                                columns={["description", "amount", "whats_wrong"]}
                                widths={issueWidths}
                              />
                              <thead>
                                <tr>
                                  <th>
                                    Description
                                    <ColResizeHandle col="description" startResize={startIssueResize} />
                                  </th>
                                  <th className="num">
                                    Amount
                                    <ColResizeHandle col="amount" startResize={startIssueResize} />
                                  </th>
                                  <th>
                                    What's wrong
                                    <ColResizeHandle col="whats_wrong" startResize={startIssueResize} />
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {row.issueLines.map((l) => (
                                  <tr key={l.id}>
                                    <td>{l.description || l.bank_description}</td>
                                    <td className="num">{l.amount.toFixed(2)}</td>
                                    <td>{l.notes}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <p className="subtitle" style={{ margin: "8px 0" }}>
                              The Stripe total (${row.stripeTotal.toFixed(2)}) no longer matches
                              the bank's original amount for this day (${row.bankTotal.toFixed(2)})
                              - likely because a line's amount was edited after reconciling.
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <div className="toolbar">
            <button className="btn" onClick={props.onNext}>
              Next: Data validation
            </button>
          </div>
        </>
      )}
    </div>
  );
}
