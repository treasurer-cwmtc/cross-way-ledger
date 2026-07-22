import { useEffect, useState } from "react";
import { pledgeCampaignsApi, PledgeCampaign, PledgeDashboard, Pledge } from "../../api/pledgeCampaigns";
import { donationsApi, FundSummary } from "../../api/donations";
import { uploadCampaignImportFile, PickedFile } from "../../lib/googleDrive";
import { getCurrentFiscalYear } from "../../api/settings";
import { ColGroup, ColResizeHandle, useColumnWidths } from "../../components/ColumnResize";

const STEPS = [
  { key: 1, label: "Campaign" },
  { key: 2, label: "Donations" },
  { key: 3, label: "Pledges" },
  { key: 4, label: "Donors" },
  { key: 5, label: "Summary" },
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

/** Table of the pledges an import created or touched, with their resulting
 * values - "a number of pledges were updated" isn't enough to spot-check an
 * import; seeing exactly which rows and what they now say is. */
function PledgeResultsTable({ title, pledges }: { title: string; pledges: Pledge[] }) {
  const { widths, startResize } = useColumnWidths("pledge-import-results");
  if (pledges.length === 0) return null;
  return (
    <>
      <h4>{title}</h4>
      <div className="table-wrap">
        <table className="resizable-cols">
          <ColGroup
            columns={["name", "email", "pledged_amount", "due_date", "matched_donor"]}
            widths={widths}
          />
          <thead>
            <tr>
              <th>
                Name
                <ColResizeHandle col="name" startResize={startResize} />
              </th>
              <th>
                Email
                <ColResizeHandle col="email" startResize={startResize} />
              </th>
              <th>
                Pledged Amount
                <ColResizeHandle col="pledged_amount" startResize={startResize} />
              </th>
              <th>
                Delivery by Date
                <ColResizeHandle col="due_date" startResize={startResize} />
              </th>
              <th>
                Matched Donor
                <ColResizeHandle col="matched_donor" startResize={startResize} />
              </th>
            </tr>
          </thead>
          <tbody>
            {pledges.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.first_name} {p.last_name}
                </td>
                <td>{p.email}</td>
                <td>{fmtMoney(p.initial_amount)}</td>
                <td>{p.due_date || ""}</td>
                <td>{p.donor_id || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** The Pledge Campaign import wizard. Campaign comes first (step 1) since
 * everything after it needs one chosen - creating a new one here selects it
 * immediately (no refresh needed: the new campaign is appended to local
 * state instead of waiting on a re-fetch). Donations are the Giving App's
 * own source of truth - imported independent of any campaign - so step 3
 * picks a campaign's fund from what's actually in that data instead of
 * someone typing a name that has to match exactly. Donors come last since
 * matching against them can run (and re-run) at any point once they exist -
 * step 4 re-matches automatically. Landing on the summary (step 5) after
 * finishing gives a quick "did this load correctly" check. */
export default function ImportWizard() {
  const [campaigns, setCampaigns] = useState<PledgeCampaign[] | null>(null);
  const [campaignId, setCampaignId] = useState<number | null>(null);
  const [step, setStep] = useState(1);
  const [maxStepReached, setMaxStepReached] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { widths: fundWidths, startResize: startFundResize } = useColumnWidths("pledge-import-funds");

  const campaign = campaigns?.find((c) => c.id === campaignId) ?? null;

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

  function advance(to: number) {
    setStep(to);
    setMaxStepReached((m) => Math.max(m, to));
  }

  // --- Step 1: choose or create a campaign, edit starting balance ---
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newGoal, setNewGoal] = useState("");
  const [newStarting, setNewStarting] = useState("");
  const [startingEdit, setStartingEdit] = useState("");
  const [startingSaved, setStartingSaved] = useState(false);

  useEffect(() => {
    setStartingEdit(campaign ? String(campaign.starting_balance) : "");
    setStartingSaved(false);
  }, [campaign?.id]);

  async function createCampaign() {
    setBusy(true);
    setError("");
    try {
      const created = await pledgeCampaignsApi.create({
        name: newName,
        goal_amount: parseFloat(newGoal) || 0,
        starting_balance: parseFloat(newStarting) || 0,
      });
      // Appended locally rather than re-fetched, so it's selectable right
      // away instead of only after a page refresh.
      setCampaigns((prev) => [created, ...(prev ?? [])]);
      setCampaignId(created.id);
      setCreating(false);
      setNewName("");
      setNewGoal("");
      setNewStarting("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveStartingBalance() {
    if (!campaignId) return;
    setBusy(true);
    setError("");
    try {
      const updated = await pledgeCampaignsApi.update(campaignId, {
        starting_balance: parseFloat(startingEdit) || 0,
      });
      setCampaigns((prev) => prev?.map((c) => (c.id === updated.id ? updated : c)) ?? prev);
      setStartingSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // --- Step 2: donations ---
  const [donationFile, setDonationFile] = useState<File | null>(null);
  const [funds, setFunds] = useState<FundSummary[] | null>(null);
  const [donationsImported, setDonationsImported] = useState<number | null>(null);

  useEffect(() => {
    donationsApi.funds().then(setFunds).catch(() => setFunds([]));
  }, []);

  // Every upload in this wizard is also archived to Google Drive
  // (<current year>/Campaign/<campaign name>/<file>) so a row can always be
  // traced back to the exact file it came from. A Drive failure
  // (not configured, popup blocked, network hiccup) never blocks the
  // actual data import - it just means that one import's rows won't have
  // a source file reference, surfaced as a dismissable warning instead.
  const [driveWarning, setDriveWarning] = useState("");

  async function archiveToDrive(file: File): Promise<PickedFile | null> {
    if (!campaign) return null;
    try {
      setDriveWarning("");
      const year = await getCurrentFiscalYear();
      return await uploadCampaignImportFile(campaign.name, file, year);
    } catch (err) {
      setDriveWarning(
        `Couldn't save a copy to Google Drive (${(err as Error).message}) - the import will still proceed, ` +
          `but this file won't be referenced for audit.`
      );
      return null;
    }
  }

  async function runDonationsImport() {
    if (!donationFile) return;
    setBusy(true);
    setError("");
    try {
      const drive = await archiveToDrive(donationFile);
      const result = await donationsApi.import(
        donationFile,
        drive ? { name: drive.name, url: drive.url } : undefined
      );
      setFunds(result.funds);
      setDonationsImported(result.donations_imported);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeFund(fundName: string) {
    if (
      !confirm(
        `Delete every donation on file for "${fundName}"? This permanently deletes that data - it can't be undone except by restoring a backup.`
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      setFunds(await donationsApi.deleteFund(fundName));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // --- Step 3: pledges + fund choice ---
  const [fundName, setFundName] = useState("");
  const [pledgeFile, setPledgeFile] = useState<File | null>(null);
  const [pledgeSummary, setPledgeSummary] = useState<{
    pledges_matched: number;
    pledges_unmatched: number;
    new_pledges: Pledge[];
    updated_pledges: Pledge[];
  } | null>(null);

  async function runPledgeImport() {
    if (!campaignId || !fundName || !pledgeFile) return;
    setBusy(true);
    setError("");
    try {
      const drive = await archiveToDrive(pledgeFile);
      const result = await pledgeCampaignsApi.importPledges(
        campaignId,
        fundName,
        pledgeFile,
        drive ? { name: drive.name, url: drive.url } : undefined
      );
      setPledgeSummary(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // --- Step 4: donors ---
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
      const drive = await archiveToDrive(donorFile);
      const result = await pledgeCampaignsApi.importDonors(
        campaignId,
        donorFile,
        drive ? { name: drive.name, url: drive.url } : undefined
      );
      setDonorSummary(result);
      advance(5);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // --- Step 5: summary ---
  const [dashboard, setDashboard] = useState<PledgeDashboard | null>(null);
  useEffect(() => {
    if (step === 5 && campaignId != null) {
      pledgeCampaignsApi
        .dashboard(campaignId)
        .then(setDashboard)
        .catch((err) => setError((err as Error).message));
    }
  }, [step, campaignId]);

  if (!campaigns) return <p className="subtitle">Loading…</p>;

  return (
    <div>
      <h2 className="page-title">Import Campaign Data</h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Safe to re-run any step - donations and donors are upserted, pledges are matched by
        email automatically (and re-matched here if a donor import resolves one).
      </p>

      <Stepper step={step} maxStepReached={maxStepReached} onJump={setStep} />

      {error && <div className="error">{error}</div>}
      {driveWarning && <div className="error">{driveWarning}</div>}

      {step === 1 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>1. Choose or create a campaign</h3>

          <label className="field">
            <span>Campaign</span>
            {!creating ? (
              <>
                <select value={campaignId ?? ""} onChange={(ev) => setCampaignId(Number(ev.target.value))}>
                  <option value="">— choose —</option>
                  {campaigns.map((c) => (
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

          {campaign && (
            <label className="field" style={{ maxWidth: 260 }}>
              <span>Starting balance</span>
              <input
                type="number"
                value={startingEdit}
                onChange={(ev) => {
                  setStartingEdit(ev.target.value);
                  setStartingSaved(false);
                }}
              />
              <button
                className="btn secondary"
                disabled={busy || startingEdit === String(campaign.starting_balance)}
                onClick={saveStartingBalance}
                style={{ marginTop: 8 }}
              >
                Save
              </button>
              {startingSaved && <span className="ok" style={{ marginLeft: 8 }}>Saved.</span>}
            </label>
          )}

          <div style={{ marginTop: 16 }}>
            <button className="btn secondary" onClick={() => advance(2)} disabled={!campaign}>
              Next: Donations →
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>2. Upload Donations</h3>
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
                <table className="resizable-cols">
                  <ColGroup columns={["fund", "gifts", "total", "actions"]} widths={fundWidths} />
                  <thead>
                    <tr>
                      <th>
                        Fund
                        <ColResizeHandle col="fund" startResize={startFundResize} />
                      </th>
                      <th>
                        # Gifts
                        <ColResizeHandle col="gifts" startResize={startFundResize} />
                      </th>
                      <th>
                        Total
                        <ColResizeHandle col="total" startResize={startFundResize} />
                      </th>
                      <th>
                        <ColResizeHandle col="actions" startResize={startFundResize} />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {funds.map((f) => (
                      <tr key={f.name}>
                        <td>{f.name}</td>
                        <td>{f.count}</td>
                        <td>{fmtMoney(f.total)}</td>
                        <td>
                          <button className="link" disabled={busy} onClick={() => removeFund(f.name)}>
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div style={{ marginTop: 16 }}>
            <button className="btn secondary" onClick={() => advance(3)} disabled={!funds || funds.length === 0}>
              Next: Pledges →
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>3. Upload Pledges</h3>

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
            <>
              <div className="stats" style={{ marginTop: 14 }}>
                <div className="stat">
                  <b>{pledgeSummary.new_pledges.length}</b>
                  <span>New pledges</span>
                </div>
                <div className="stat">
                  <b>{pledgeSummary.updated_pledges.length}</b>
                  <span>Updated pledges</span>
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
              <PledgeResultsTable title="New records" pledges={pledgeSummary.new_pledges} />
              <PledgeResultsTable title="Updated records" pledges={pledgeSummary.updated_pledges} />
            </>
          )}

          <div style={{ marginTop: 16 }}>
            <button className="btn secondary" onClick={() => advance(4)} disabled={!pledgeSummary}>
              Next: Donors →
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>4. Upload Donors</h3>
          <p className="subtitle">
            The Giving App donor list - shared across every campaign. Uploading here re-matches
            this campaign's pledges automatically, so anyone who gave for the first time since
            step 3 gets linked without re-uploading pledges.
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

      {step === 5 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>5. Summary - quick validation</h3>
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
                If these numbers don't look right, check the fund you chose in step 3 matches
                what you expected, or revisit any step above.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
