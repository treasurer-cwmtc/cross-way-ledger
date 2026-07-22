import { useMemo, useState } from "react";
import { ChartAccount } from "../../api/accounts";
import { BankAccount } from "../../api/bankAccounts";
import { reconcileApi, ReconLine, ReconRun } from "../../api/reconcile";
import { Rule, rulesApi } from "../../api/rules";
import { getCurrentFiscalYear } from "../../api/settings";
import { uploadBankOrStripeFile } from "../../lib/googleDrive";
import { ColGroup, ColResizeHandle, useColumnWidths } from "../../components/ColumnResize";
import AccountPicker from "../ledger/AccountPicker";
import WizardLineModal from "./WizardLineModal";
import WizardLineRow from "./WizardLineRow";

export default function Step1BankUpload(props: {
  bankAccounts: BankAccount[];
  accounts: ChartAccount[];
  bankAccountId: number | "";
  onBankAccountChange: (id: number | "") => void;
  run: ReconRun | null;
  onRunChange: (run: ReconRun) => void;
  onRuleAdded: (rule: Rule) => void;
  onNext: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [opened, setOpened] = useState<ReconLine | null>(null);
  const { widths, startResize } = useColumnWidths("upload-step1-bank-preview");

  const run = props.run;

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError("");
    // Archive the raw statement to Google Drive first - a failure here
    // (Drive not configured, popup blocked, network hiccup) never blocks
    // the actual import, it just means this run's lines won't have a
    // source file link for the audit trail.
    let bankFileLink: string | undefined;
    try {
      const year = await getCurrentFiscalYear();
      const archived = await uploadBankOrStripeFile(file, year);
      bankFileLink = archived.url;
    } catch {
      bankFileLink = undefined;
    }
    try {
      props.onRunChange(await reconcileApi.bankOnly(file, bankFileLink));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function updateLine(id: number, patch: { account_no: string }) {
    const updated = await reconcileApi.updateLine(id, patch);
    if (!run) return;
    props.onRunChange({
      ...run,
      lines: run.lines.map((l) => (l.id === id ? updated : l)),
    });
  }

  async function refreshRun() {
    if (!run) return;
    const fresh = await reconcileApi.recategorize(run.id);
    props.onRunChange(fresh);
  }

  // Sorted by bank description so identical/similar payees end up next to
  // each other, instead of scattered by date - much easier to spot a
  // pattern worth writing one rule for.
  const sortedLines = useMemo(() => {
    if (!run) return [];
    return [...run.lines].sort((a, b) =>
      a.bank_description.localeCompare(b.bank_description)
    );
  }, [run]);

  // Distinct bank descriptions with no keyword-rule match yet - excludes
  // Stripe transfer lines, which are handled entirely in step 2/3.
  const uncategorizedDescriptions = useMemo(() => {
    if (!run) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const l of sortedLines) {
      if (l.is_stripe_payout || l.account_no || !l.bank_description) continue;
      if (seen.has(l.bank_description)) continue;
      seen.add(l.bank_description);
      out.push(l.bank_description);
    }
    return out;
  }, [sortedLines]);

  return (
    <div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Bank account & statement</h3>
        <div className="row">
          <label className="field">
            <span>Bank Account</span>
            <select
              value={props.bankAccountId}
              onChange={(e) => props.onBankAccountChange(Number(e.target.value) || "")}
            >
              <option value="">Select…</option>
              {props.bankAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Bank statement CSV (Chase export)</span>
            <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
        </div>
        <button className="btn" onClick={upload} disabled={!file || !props.bankAccountId || busy}>
          {busy ? "Uploading…" : "Upload"}
        </button>
        {error && <div className="error">{error}</div>}
      </div>

      {run && (
        <>
          <div className="card">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
              }}
            >
              <h3 style={{ marginTop: 0 }}>Preview ({run.lines.length} lines)</h3>
              <button className="btn" onClick={props.onNext}>
                Next: Stripe upload
              </button>
            </div>
            <p className="subtitle">
              Click a row for the full editor, or pick a category directly in the table.
              Lines with no data yet (like remote deposits) are fine to leave as-is.
            </p>
            <div className="table-wrap">
              <table className="resizable-cols">
                <ColGroup
                  columns={["date", "bank_description", "amount", "category", "status"]}
                  widths={widths}
                />
                <thead>
                  <tr>
                    <th>
                      Date
                      <ColResizeHandle col="date" startResize={startResize} />
                    </th>
                    <th>
                      Bank Description
                      <ColResizeHandle col="bank_description" startResize={startResize} />
                    </th>
                    <th className="num">
                      Amount
                      <ColResizeHandle col="amount" startResize={startResize} />
                    </th>
                    <th>
                      Category
                      <ColResizeHandle col="category" startResize={startResize} />
                    </th>
                    <th>
                      Status
                      <ColResizeHandle col="status" startResize={startResize} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedLines.map((l) => (
                    <WizardLineRow
                      key={l.id}
                      line={l}
                      accounts={props.accounts}
                      onOpen={setOpened}
                      onUpdate={updateLine}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {uncategorizedDescriptions.length > 0 && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Missing keyword rules</h3>
              <p className="subtitle">
                These bank descriptions don't match any rule yet. Add one below and the
                matching lines will recategorize automatically.
              </p>
              {uncategorizedDescriptions.map((desc) => (
                <AddKeywordRuleRow
                  key={desc}
                  description={desc}
                  accounts={props.accounts.filter((a) => a.category === "Expense")}
                  onAdded={(rule) => {
                    props.onRuleAdded(rule);
                    refreshRun();
                  }}
                />
              ))}
            </div>
          )}

          <div className="toolbar">
            <button className="btn" onClick={props.onNext}>
              Next: Stripe upload
            </button>
          </div>
        </>
      )}

      {opened && (
        <WizardLineModal
          line={opened}
          accounts={props.accounts}
          onUpdate={(id, patch) => {
            reconcileApi.updateLine(id, patch).then((updated) => {
              if (!run) return;
              props.onRunChange({
                ...run,
                lines: run.lines.map((l) => (l.id === id ? updated : l)),
              });
              setOpened(updated);
            });
          }}
          onClose={() => setOpened(null)}
        />
      )}
    </div>
  );
}

function AddKeywordRuleRow(props: {
  description: string;
  accounts: ChartAccount[];
  onAdded: (rule: Rule) => void;
}) {
  // Pre-filled with the full raw line, but editable - trim it down to just
  // the meaningful part (e.g. the payee name) so the rule matches every
  // line containing that phrase, not only this exact one.
  const [pattern, setPattern] = useState(props.description);
  const [accountNo, setAccountNo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function add() {
    if (!accountNo || !pattern.trim()) return;
    setBusy(true);
    setError("");
    try {
      const rule = await rulesApi.createRule({
        rule_type: "bank_keyword",
        pattern: pattern.trim(),
        account_no: accountNo,
        priority: 100,
      });
      // Re-checks every still-uncategorized line against the current rule
      // set (including this new one), so any other line containing the
      // same keyword gets picked up automatically, not just this one.
      props.onAdded(rule);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row" style={{ alignItems: "flex-end", marginBottom: 10 }}>
      <label className="field" style={{ flex: 2 }}>
        <span>Bank description</span>
        <input type="text" value={props.description} readOnly title={props.description} />
      </label>
      <label className="field" style={{ flex: 2 }}>
        <span>Keyword to match (edit down to the meaningful part)</span>
        <input type="text" value={pattern} onChange={(e) => setPattern(e.target.value)} />
      </label>
      <label className="field" style={{ flex: 2 }}>
        <span>Category assigned</span>
        <AccountPicker value={accountNo} accounts={props.accounts} onChange={setAccountNo} />
      </label>
      <div className="field" style={{ flex: "none" }}>
        <button className="btn secondary" onClick={add} disabled={!accountNo || !pattern.trim() || busy}>
          {busy ? "Adding…" : "Add rule"}
        </button>
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
