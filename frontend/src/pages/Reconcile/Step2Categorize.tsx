import { useMemo, useState } from "react";
import { ChartAccount } from "../../api/accounts";
import { reconcileApi, ReconLine, ReconRun } from "../../api/reconcile";
import { Rule, rulesApi } from "../../api/rules";
import { ColGroup, ColResizeHandle, useColumnWidths } from "../../components/ColumnResize";
import AccountPicker from "../ledger/AccountPicker";
import WizardLineModal from "../Upload/WizardLineModal";
import WizardLineRow from "../Upload/WizardLineRow";

/** Same bank-line review the Upload wizard's Step1BankUpload shows after a
 * file upload (editable category per row, click-to-open full editor,
 * "missing keyword rules" prompt for anything a rule doesn't cover yet) -
 * this page's run just comes from the Bank Transactions (Plaid) sync
 * instead of a CSV upload. Kept as its own copy (not extracted into a
 * shared component) for the same reason ReconcileStepper.tsx is a copy:
 * the deprecated Upload wizard's files stay untouched. See issue #122. */
export default function Step2Categorize(props: {
  run: ReconRun;
  accounts: ChartAccount[];
  onRunChange: (run: ReconRun) => void;
  onRuleAdded: (rule: Rule) => void;
  onNext: () => void;
}) {
  const [opened, setOpened] = useState<ReconLine | null>(null);
  const { widths, startResize } = useColumnWidths("reconcile-step2-bank-preview");

  const run = props.run;

  async function updateLine(id: number, patch: { account_no: string }) {
    const updated = await reconcileApi.updateLine(id, patch);
    props.onRunChange({
      ...run,
      lines: run.lines.map((l) => (l.id === id ? updated : l)),
    });
  }

  async function refreshRun() {
    const fresh = await reconcileApi.recategorize(run.id);
    props.onRunChange(fresh);
  }

  // Sorted by bank description so identical/similar payees end up next to
  // each other, instead of scattered by date - much easier to spot a
  // pattern worth writing one rule for.
  const sortedLines = useMemo(() => {
    return [...run.lines].sort((a, b) => a.bank_description.localeCompare(b.bank_description));
  }, [run.lines]);

  // Distinct bank descriptions with no keyword-rule match yet - excludes
  // Stripe transfer lines, which are handled entirely in the Reconcile step.
  const uncategorizedDescriptions = useMemo(() => {
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
        <div
          style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}
        >
          <h3 style={{ marginTop: 0 }}>Preview ({run.lines.length} lines)</h3>
          <button className="btn" onClick={props.onNext}>
            Next: Check Stripe funds
          </button>
        </div>
        <p className="subtitle">
          Click a row for the full editor, or pick a category directly in the table. Lines
          with no data yet (like remote deposits) are fine to leave as-is.
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
            These bank descriptions don't match any rule yet. Add one below and the matching
            lines will recategorize automatically.
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
          Next: Check Stripe funds
        </button>
      </div>

      {opened && (
        <WizardLineModal
          line={opened}
          accounts={props.accounts}
          onUpdate={(id, patch) => {
            reconcileApi.updateLine(id, patch).then((updated) => {
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
