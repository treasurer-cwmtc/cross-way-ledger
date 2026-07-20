import { useEffect, useState } from "react";
import { pledgeCampaignsApi, PledgeDashboard } from "../../api/pledgeCampaigns";
import { donationsApi, FundSummary } from "../../api/donations";
import { useCampaign } from "./useCampaign";

const STEPS = [
  { key: 1, label: "Donations" },
  { key: 2, label: "Pledges" },
  { key: 3, label: "Donors" },
  { key: 4, label: "Summary" },
] as const;

function fmtMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

function Stepper(props: { step: number; maxStepReached: number; onJump: (s: number) => void }) {
  const n = STEPS.length;
  const half = 100 / (2 * n);
  const doneFraction = Math.max(0, Math.min(1, (props.maxStepReached - 1) / (n - 1)));
  return (
    <div className="wizard-steps">
      <div className="wizard-steps-line" style={{ left: `${half}%`, right: `${half}%` }} />
      <div
        className="wizard-steps-line done"
        style={{ left: `${half}%`, right: `${half}%`, transform: `scaleX(${doneFraction})` }}
      />
      {STEPS.map((s) => {
        const done = s.key < props.step;
        const active = s.key === props.step;
        const reachable = s.key <= props.maxStepReached;
        return (
          <button
            key={s.key}
            className={`wizard-step${active ? " active" : ""}${done ? " done" : ""}`}
            onClick={() => reachable && props.onJump(s.key)}
            disabled={!reachable}
          >
            <span className="wizard-step-circle">{done ? "✓" : s.key}</span>
            <span className="wizard-step-label">{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The Pledge Campaign import wizard. Donations are the Giving App's own
 * source of truth - imported first, independent of any campaign - so step
 * 2 picks a campaign's fund from what's actually in that data instead of
 * someone typing a name that has to match exactly. Donors come last since
 * matching against them can run (and re-run) at any point once they exist -
 * step 3 re-matches automatically. Landing on the summary (step 4) after
 * finishing gives a quick "did this load correctly" check. */
export default function ImportWizard() {
  const { campaigns, campaign, campaignId, setCampaignId, error: campaignError } = useCampaign();
  const [step, setStep] = useState(1);
  const [maxStepReached, setMaxStepReached] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function advance(to: number) {
    setStep(to);
    setMaxStepReached((m) => Math.max(m, to));
  }

  // --- Step 0: campaign picker (not part of the numbered steps - donations
  // don't need a campaign chosen yet, but pledges/donors do) ---
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newGoal, setNewGoal] = useState("");
  const [newStarting, setNewStarting] = useState("");

  async function createCampaign() {
    setBusy(true);
    setError("");
    try {
      const created = await pledgeCampaignsApi.create({
        name: newName,
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

  // --- Step 1: donations ---
  const [donationFile, setDonationFile] = useState<File | null>(null);
  const [funds, setFunds] = useState<FundSummary[] | null>(null);
  const [donationsImported, setDonationsImported] = useState<number | null>(null);

  useEffect(() => {
    donationsApi.funds().then(setFunds).catch(() => setFunds([]));
  }, []);

  async function runDonationsImport() {
    if (!donationFile) return;
    setBusy(true);
    setError("");
    try {
      const result = await donationsApi.import(donationFile);
      setFunds(result.funds);
      setDonationsImported(result.donations_imported);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // --- Step 2: pledges + fund choice ---
  const [fundName, setFundName] = useState("");
  const [pledgeFile, setPledgeFile] = useState<File | null>(null);
  const [pledgeSummary, setPledgeSummary] = useState<{
    pledges_imported: number;
    pledges_matched: number;
    pledges_unmatched: number;
  } | null>(null);

  async function runPledgeImport() {
    if (!campaignId || !fundName || !pledgeFile) return;
    setBusy(true);
    setError("");
    try {
      const result = await pledgeCampaignsApi.importPledges(campaignId, fundName, pledgeFile);
      setPledgeSummary(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // --- Step 3: donors ---
  const [donorFile, setDonorFile] = useState<File | null>(null);
  const [donorSummary, setDonorSummary] = useState<{
    donors_imported: number;
    pledges_matched: number;
    pledges_unmatched: number;
  } | null>(null);

  async function runDonorImport() {
    if (!campaignId || !donorFile) return;
    setBusy(true);
    setError("");
    try {
      const result = await pledgeCampaignsApi.importDonors(campaignId, donorFile);
      setDonorSummary(result);
      advance(4);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // --- Step 4: summary ---
  const [dashboard, setDashboard] = useState<PledgeDashboard | null>(null);
  useEffect(() => {
    if (step === 4 && campaignId != null) {
      pledgeCampaignsApi
        .dashboard(campaignId)
        .then(setDashboard)
        .catch((err) => setError((err as Error).message));
    }
  }, [step, campaignId]);

  if (campaignError) return <div className="error">{campaignError}</div>;

  return (
    <div>
      <h2 className="page-title">Import Pledge Campaign Data</h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Safe to re-run any step - donations and donors are upserted, pledges are matched by
        email automatically (and re-matched here if a donor import resolves one).
      </p>

      <Stepper step={step} maxStepReached={maxStepReached} onJump={setStep} />

      {error && <div className="error">{error}</div>}

      {step === 1 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>1. Upload Donations</h3>
          <p className="subtitle">
            The Giving App's own donation export - the source of truth. No fund needs to be
            chosen here; every fund present in the file is imported.
          </p>
          <label className="field">
            <span>Donations export</span>
            <input
              type="file"
              accept=".csv"
              onChange={(ev) => setDonationFile(ev.target.files?.[0] ?? null)}
            />
          </label>
          <button className="btn" disabled={busy || !donationFile} onClick={runDonationsImport}>
            {busy ? "Importing…" : "Import donations"}
          </button>

          {donationsImported !== null && (
            <p className="subtitle" style={{ marginTop: 10 }}>
              {donationsImported} new donations imported.
            </p>
          )}

          {funds && funds.length > 0 && (
            <>
              <h4>Funds on file</h4>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Fund</th>
                      <th># Gifts</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {funds.map((f) => (
                      <tr key={f.name}>
                        <td>{f.name}</td>
                        <td>{f.count}</td>
                        <td>{fmtMoney(f.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div style={{ marginTop: 16 }}>
            <button className="btn secondary" onClick={() => advance(2)} disabled={!funds || funds.length === 0}>
              Next: Pledges →
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>2. Upload Pledges</h3>

          <label className="field">
            <span>Campaign</span>
            {!creating ? (
              <>
                <select value={campaignId ?? ""} onChange={(ev) => setCampaignId(Number(ev.target.value))}>
                  <option value="">— choose —</option>
                  {(campaigns || []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>{" "}
                <button type="button" className="btn secondary" onClick={() => setCreating(true)}>
                  + New campaign
                </button>
              </>
            ) : (
              <div style={{ marginTop: 8 }}>
                <input placeholder="Campaign name" value={newName} onChange={(ev) => setNewName(ev.target.value)} />
                <input
                  placeholder="Goal amount"
                  type="number"
                  value={newGoal}
                  onChange={(ev) => setNewGoal(ev.target.value)}
                  style={{ marginLeft: 8 }}
                />
                <input
                  placeholder="Starting balance"
                  type="number"
                  value={newStarting}
                  onChange={(ev) => setNewStarting(ev.target.value)}
                  style={{ marginLeft: 8 }}
                />
                <button className="btn" disabled={busy || !newName} onClick={createCampaign} style={{ marginLeft: 8 }}>
                  Create
                </button>
                <button className="btn secondary" onClick={() => setCreating(false)} style={{ marginLeft: 8 }}>
                  Cancel
                </button>
              </div>
            )}
          </label>

          <label className="field">
            <span>Which fund is this campaign tracking?</span>
            <select value={fundName} onChange={(ev) => setFundName(ev.target.value)}>
              <option value="">— choose from donations on file —</option>
              {(funds || []).map((f) => (
                <option key={f.name} value={f.name}>
                  {f.name} ({f.count} gifts, {fmtMoney(f.total)})
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Pledge form export</span>
            <input type="file" accept=".csv" onChange={(ev) => setPledgeFile(ev.target.files?.[0] ?? null)} />
          </label>

          <button
            className="btn"
            disabled={busy || !campaignId || !fundName || !pledgeFile}
            onClick={runPledgeImport}
          >
            {busy ? "Importing…" : "Import pledges"}
          </button>

          {pledgeSummary && (
            <div className="stats" style={{ marginTop: 14 }}>
              <div className="stat">
                <b>{pledgeSummary.pledges_imported}</b>
                <span>Pledges updated</span>
              </div>
              <div className="stat">
                <b>{pledgeSummary.pledges_matched}</b>
                <span>Matched to a donor</span>
              </div>
              <div className="stat">
                <b>{pledgeSummary.pledges_unmatched}</b>
                <span>No gift yet</span>
              </div>
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <button className="btn secondary" onClick={() => advance(3)} disabled={!pledgeSummary}>
              Next: Donors →
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>3. Upload Donors</h3>
          <p className="subtitle">
            The Giving App donor list - shared across every campaign. Uploading here re-matches
            this campaign's pledges automatically, so anyone who gave for the first time since
            step 2 gets linked without re-uploading pledges.
          </p>
          <label className="field">
            <span>Donors export</span>
            <input type="file" accept=".csv" onChange={(ev) => setDonorFile(ev.target.files?.[0] ?? null)} />
          </label>
          <button className="btn" disabled={busy || !donorFile} onClick={runDonorImport}>
            {busy ? "Importing…" : "Import donors & finish"}
          </button>

          {donorSummary && (
            <div className="stats" style={{ marginTop: 14 }}>
              <div className="stat">
                <b>{donorSummary.donors_imported}</b>
                <span>Donors updated</span>
              </div>
              <div className="stat">
                <b>{donorSummary.pledges_matched}</b>
                <span>Matched to a donor</span>
              </div>
              <div className="stat">
                <b>{donorSummary.pledges_unmatched}</b>
                <span>No gift yet</span>
              </div>
            </div>
          )}
        </div>
      )}

      {step === 4 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>4. Summary - quick validation</h3>
          {!dashboard && <p className="subtitle">Loading…</p>}
          {dashboard && (
            <>
              <p className="subtitle">
                {campaign?.name} - fund "{dashboard.campaign.fund_name}"
              </p>
              <div className="stats">
                <div className="stat">
                  <b>{dashboard.pledge_count}</b>
                  <span>Pledges</span>
                </div>
                <div className="stat">
                  <b>{fmtMoney(dashboard.total_pledged)}</b>
                  <span>Total Pledged</span>
                </div>
                <div className="stat">
                  <b>{dashboard.donation_count}</b>
                  <span>Donations (this fund)</span>
                </div>
                <div className="stat">
                  <b>{fmtMoney(dashboard.total_actual)}</b>
                  <span>Total Donations (this fund)</span>
                </div>
              </div>
              <p className="subtitle" style={{ marginTop: 14 }}>
                If these numbers don't look right, check the fund you chose in step 2 matches
                what you expected, or revisit any step above.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
