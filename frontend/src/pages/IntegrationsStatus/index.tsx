import { Fragment, useEffect, useState } from "react";
import { integrationsApi, IntegrationStatus } from "../../api/integrations";
import { fmtRelative } from "../../lib/fmtRelative";

type Health = "ok" | "error" | "never_synced" | "not_configured";

function health(row: IntegrationStatus): Health {
  if (!row.configured) return "not_configured";
  if (row.last_error) return "error";
  if (!row.last_synced_at) return "never_synced";
  return "ok";
}

const HEALTH_LABEL: Record<Health, string> = {
  ok: "OK",
  error: "Error",
  never_synced: "Never synced",
  not_configured: "Not configured",
};

const HEALTH_PILL_CLASS: Record<Health, string> = {
  ok: "bank",
  error: "danger",
  never_synced: "warn",
  not_configured: "warn",
};

/** Setup > Integrations Status - every external API sync the app makes
 * (Planning Center People/Giving-Donors/Giving-Donations/Pledge Form,
 * Stripe, Plaid) in one place: what it does, when it last succeeded, and
 * what broke last time if anything did. Read-only - each integration's own
 * page still owns its "Sync now" button; this is purely a dashboard so an
 * admin doesn't have to visit six pages to spot a silently-failing sync.
 * Admin-only, same sensitivity level as Users. */
export default function IntegrationsStatus() {
  const [rows, setRows] = useState<IntegrationStatus[] | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function load() {
    integrationsApi.status().then(setRows).catch((e) => setError((e as Error).message));
  }

  useEffect(load, []);

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div>
      <h2 className="page-title">Integrations Status</h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Every external API sync the app makes, its last successful run, and what went wrong the
        last time it failed (if anything). Read-only - use each integration's own page to trigger
        a sync.
      </p>
      {error && <div className="error">{error}</div>}
      {!rows && !error && <p className="subtitle">Loading…</p>}

      {rows && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Integration</th>
                <th>What it does</th>
                <th>Last Synced</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const h = health(row);
                const isExpanded = expanded.has(row.key);
                return (
                  <Fragment key={row.key}>
                    <tr onClick={() => toggle(row.key)} style={{ cursor: "pointer" }}>
                      <td>
                        <b>{row.label}</b>
                      </td>
                      <td>{row.description}</td>
                      <td>{fmtRelative(row.last_synced_at)}</td>
                      <td>
                        <span className={"pill lg " + HEALTH_PILL_CLASS[h]}>{HEALTH_LABEL[h]}</span>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={4}>
                          <table style={{ margin: 0 }}>
                            <tbody>
                              <tr>
                                <td className="subtitle" style={{ whiteSpace: "nowrap" }}>
                                  Sync now endpoint
                                </td>
                                <td>
                                  <code>{row.sync_now_endpoint}</code>
                                </td>
                              </tr>
                              <tr>
                                <td className="subtitle" style={{ whiteSpace: "nowrap" }}>
                                  Scheduled sync endpoint
                                </td>
                                <td>
                                  <code>{row.scheduled_sync_endpoint}</code>{" "}
                                  {!row.scheduled_sync_configured && (
                                    <span className="pill warn">Secret not configured</span>
                                  )}
                                </td>
                              </tr>
                              {!row.configured && (
                                <tr>
                                  <td className="subtitle" style={{ whiteSpace: "nowrap" }}>
                                    Credentials
                                  </td>
                                  <td className="error" style={{ padding: 0 }}>
                                    Not configured - every sync attempt will fail until this
                                    integration's API credentials are set.
                                  </td>
                                </tr>
                              )}
                              {row.last_error && (
                                <tr>
                                  <td className="subtitle" style={{ whiteSpace: "nowrap" }}>
                                    Last error ({fmtRelative(row.last_error_at)})
                                  </td>
                                  <td className="error" style={{ padding: 0 }}>
                                    {row.last_error}
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
