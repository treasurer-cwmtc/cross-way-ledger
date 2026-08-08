import { useEffect, useState } from "react";
import { donationsApi, FundSummary } from "../../api/donations";
import { fmtRelative } from "../../lib/fmtRelative";

function fmtMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

/** Planning Center > Donations - the Giving App's full donation export,
 * synced live (multi-fund donations explode into one row per fund). Not
 * scoped to any one campaign; a Pledge Campaign just claims a fund from
 * what shows up here. Moved out of the Campaign wizard so it has a home
 * outside of setting up a specific campaign. */
export default function PlanningCenterDonations() {
  const [funds, setFunds] = useState<FundSummary[] | null>(null);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  function load() {
    donationsApi.funds().then(setFunds).catch((e) => setError((e as Error).message));
    donationsApi.getLastSynced().then((r) => setLastSyncedAt(r.last_synced_at)).catch(() => {});
  }

  useEffect(load, []);

  async function syncNow() {
    setSyncing(true);
    setError("");
    setMsg("");
    try {
      const result = await donationsApi.sync();
      setFunds(result.funds);
      setMsg(`Synced ${result.fetched} donations (${result.imported} new).`);
      setLastSyncedAt(result.last_synced_at);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  async function upload() {
    if (!file) return;
    setError("");
    setMsg("");
    try {
      const result = await donationsApi.import(file);
      setFunds(result.funds);
      setMsg(`Imported ${result.donations_imported} donations.`);
      setFile(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function removeFund(fundName: string) {
    if (
      !confirm(
        `Delete every donation on file for "${fundName}"? This permanently deletes that data - it can't be undone except by restoring a backup.`
      )
    )
      return;
    try {
      setFunds(await donationsApi.deleteFund(fundName));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <h2 className="page-title">Planning Center · Donations</h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        The Giving App's full donation export, synced live - not scoped to any one campaign. A
        multi-fund donation explodes into one row per fund. A Pledge Campaign picks a fund from
        what's on file here.
      </p>
      <div className="row" style={{ alignItems: "center" }}>
        <button className="btn" onClick={syncNow} disabled={syncing}>
          {syncing ? "Syncing…" : "Sync now"}
        </button>
        <span className="pill">Last synced: {fmtRelative(lastSyncedAt)}</span>
      </div>
      {msg && <div className="ok">{msg}</div>}
      {error && <div className="error">{error}</div>}

      <details style={{ marginTop: 12, marginBottom: 12 }}>
        <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--muted)" }}>
          Import from a CSV file instead (fallback if the API sync is unavailable)
        </summary>
        <div className="row" style={{ marginTop: 8 }}>
          <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <button className="btn" onClick={upload} disabled={!file}>
            Import
          </button>
        </div>
      </details>

      {funds && funds.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Funds on file</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fund</th>
                  <th># Gifts</th>
                  <th>Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {funds.map((f) => (
                  <tr key={f.name}>
                    <td>{f.name}</td>
                    <td>{f.count}</td>
                    <td>{fmtMoney(f.total)}</td>
                    <td>
                      <button className="link" onClick={() => removeFund(f.name)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
