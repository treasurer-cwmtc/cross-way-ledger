import { useState } from "react";
import { pledgeCampaignsApi, PledgeImportSummary } from "../../api/pledgeCampaigns";
import { useCampaign } from "./useCampaign";

/** Upload the three Giving App exports (pledge form, donations, donors) -
 * same shape as the Bank/Stripe Upload wizard, but a single step since
 * there's no ambiguous categorization to review: matching is deterministic
 * (email lookup) and re-running it is always safe. */
export default function ImportWizard() {
  const { campaigns, campaign, campaignId, setCampaignId, error: campaignError } = useCampaign();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newFund, setNewFund] = useState("");
  const [newGoal, setNewGoal] = useState("");
  const [newStarting, setNewStarting] = useState("");

  const [pledgeFile, setPledgeFile] = useState<File | null>(null);
  const [donationFile, setDonationFile] = useState<File | null>(null);
  const [donorFile, setDonorFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<PledgeImportSummary | null>(null);
  const [error, setError] = useState("");

  async function createCampaign() {
    setBusy(true);
    setError("");
    try {
      const created = await pledgeCampaignsApi.create({
        name: newName,
        fund_name: newFund,
        goal_amount: parseFloat(newGoal) || 0,
        starting_balance: parseFloat(newStarting) || 0,
      });
      setCampaignId(created.id);
      setCreating(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!campaignId || !pledgeFile || !donationFile || !donorFile) return;
    setBusy(true);
    setError("");
    setSummary(null);
    try {
      const result = await pledgeCampaignsApi.importData(
        campaignId,
        pledgeFile,
        donationFile,
        donorFile
      );
      setSummary(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (campaignError) return <div className="error">{campaignError}</div>;

  return (
    <div>
      <h2 className="page-title">Import Pledge Campaign Data</h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Upload fresh exports any time - safe to re-run. Pledges and donors are updated in place;
        donations already imported are skipped automatically.
      </p>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Campaign</h3>
        {!creating && (
          <>
            <label className="field">
              <span>Campaign</span>
              <select
                value={campaignId ?? ""}
                onChange={(ev) => setCampaignId(Number(ev.target.value))}
              >
                {(campaigns || []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn secondary" onClick={() => setCreating(true)}>
              + New campaign
            </button>
          </>
        )}
        {creating && (
          <>
            <label className="field">
              <span>Campaign name</span>
              <input value={newName} onChange={(ev) => setNewName(ev.target.value)} />
            </label>
            <label className="field">
              <span>Fund name (matches the "fund" column in the donations export)</span>
              <input value={newFund} onChange={(ev) => setNewFund(ev.target.value)} />
            </label>
            <label className="field">
              <span>Goal amount</span>
              <input
                type="number"
                value={newGoal}
                onChange={(ev) => setNewGoal(ev.target.value)}
              />
            </label>
            <label className="field">
              <span>Starting balance (already raised toward this fund before this campaign)</span>
              <input
                type="number"
                value={newStarting}
                onChange={(ev) => setNewStarting(ev.target.value)}
              />
            </label>
            <button className="btn" disabled={busy || !newName || !newFund} onClick={createCampaign}>
              Create campaign
            </button>{" "}
            <button className="btn secondary" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </>
        )}
      </div>

      {campaign && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Files</h3>
          <label className="field">
            <span>Pledge form export</span>
            <input type="file" accept=".csv" onChange={(ev) => setPledgeFile(ev.target.files?.[0] ?? null)} />
          </label>
          <label className="field">
            <span>Donations export</span>
            <input
              type="file"
              accept=".csv"
              onChange={(ev) => setDonationFile(ev.target.files?.[0] ?? null)}
            />
          </label>
          <label className="field">
            <span>Donors export</span>
            <input type="file" accept=".csv" onChange={(ev) => setDonorFile(ev.target.files?.[0] ?? null)} />
          </label>
          <button
            className="btn"
            disabled={busy || !pledgeFile || !donationFile || !donorFile}
            onClick={runImport}
          >
            {busy ? "Importing…" : "Import"}
          </button>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      {summary && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Import complete</h3>
          <div className="stats">
            <div className="stat">
              <b>{summary.donors_imported}</b>
              <span>Donors updated</span>
            </div>
            <div className="stat">
              <b>{summary.pledges_imported}</b>
              <span>Pledges updated</span>
            </div>
            <div className="stat">
              <b>{summary.donations_imported}</b>
              <span>New donations</span>
            </div>
            <div className="stat">
              <b>{summary.pledges_matched}</b>
              <span>Pledges matched to a donor</span>
            </div>
            <div className="stat">
              <b>{summary.pledges_unmatched}</b>
              <span>Pledges with no gift yet</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
