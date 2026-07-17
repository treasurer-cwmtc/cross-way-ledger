import { useState } from "react";
import { ChartAccount } from "../../api/accounts";
import { reconcileApi, StripeFundCheckItem, StripeFundCheckResult } from "../../api/reconcile";
import { rulesApi, Rule } from "../../api/rules";
import AccountPicker from "../ledger/AccountPicker";

export default function Step2StripeUpload(props: {
  accounts: ChartAccount[];
  stripeFile: File | null;
  onStripeFileChange: (f: File | null) => void;
  check: StripeFundCheckResult | null;
  onCheckChange: (c: StripeFundCheckResult) => void;
  rulesAdded: Rule[];
  onRuleAdded: (r: Rule) => void;
  onNext: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function runCheck(file: File) {
    setBusy(true);
    setError("");
    try {
      props.onCheckChange(await reconcileApi.stripeFundCheck(file));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onFile(f: File | null) {
    props.onStripeFileChange(f);
    if (f) runCheck(f);
  }

  async function recheck() {
    if (props.stripeFile) await runCheck(props.stripeFile);
  }

  const check = props.check;

  return (
    <div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Stripe transactions</h3>
        <label className="field">
          <span>Stripe transactions CSV</span>
          <input type="file" accept=".csv" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
        </label>
        {busy && <p className="subtitle">Checking funds…</p>}
        {error && <div className="error">{error}</div>}
      </div>

      {check && (
        <div className="card">
          <div
            style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}
          >
            <h3 style={{ marginTop: 0 }}>Fund coverage</h3>
            <div style={{ textAlign: "right" }}>
              <button className="btn" onClick={props.onNext} disabled={!check.all_covered}>
                Next: Reconcile
              </button>
              {!check.all_covered && (
                <p style={{ color: "var(--muted)", fontSize: 12, margin: "6px 0 0" }}>
                  Add a rule for every red fund below to continue.
                </p>
              )}
            </div>
          </div>
          {check.all_covered ? (
            <p className="ok">✓ All funds in this file have a rule.</p>
          ) : (
            <p className="error">
              ✗ Some funds don't have a rule yet - add one below for each so donations
              land in the right account.
            </p>
          )}
          <table>
            <thead>
              <tr>
                <th>Fund</th>
                <th>Status</th>
                <th>Account</th>
              </tr>
            </thead>
            <tbody>
              {check.funds.map((item) => (
                <FundRow
                  key={item.fund}
                  item={item}
                  accounts={props.accounts.filter((a) => a.category === "Income")}
                  onRuleAdded={(r) => {
                    props.onRuleAdded(r);
                    recheck();
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {check && (
        <div className="toolbar">
          <button className="btn" onClick={props.onNext} disabled={!check.all_covered}>
            Next: Reconcile
          </button>
          {!check.all_covered && (
            <span style={{ color: "var(--muted)", fontSize: 12 }}>
              Add a rule for every red fund above to continue.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function FundRow(props: {
  item: StripeFundCheckItem;
  accounts: ChartAccount[];
  onRuleAdded: (r: Rule) => void;
}) {
  const [accountNo, setAccountNo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function add() {
    if (!accountNo) return;
    setBusy(true);
    setError("");
    try {
      const rule = await rulesApi.createRule({
        rule_type: "stripe_fund",
        pattern: props.item.fund,
        account_no: accountNo,
        priority: 100,
      });
      props.onRuleAdded(rule);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td>
        <b>{props.item.fund}</b>
      </td>
      <td>
        {props.item.has_rule ? (
          <span className="pill bank">✓ Covered</span>
        ) : (
          <span className="pill warn">✗ Missing rule</span>
        )}
      </td>
      <td>
        {props.item.has_rule ? (
          props.item.account_no
        ) : (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <AccountPicker value={accountNo} accounts={props.accounts} onChange={setAccountNo} />
            <button className="btn secondary" onClick={add} disabled={!accountNo || busy}>
              {busy ? "Adding…" : "Add rule"}
            </button>
            {error && <span className="error">{error}</span>}
          </div>
        )}
      </td>
    </tr>
  );
}
