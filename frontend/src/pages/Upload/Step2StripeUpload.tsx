import { useEffect, useState } from "react";
import { ChartAccount } from "../../api/accounts";
import { reconcileApi, StripeFundCheckItem, StripeFundCheckResult } from "../../api/reconcile";
import { rulesApi, Rule } from "../../api/rules";
import { ColGroup, ColResizeHandle, useColumnWidths } from "../../components/ColumnResize";
import AccountPicker from "../ledger/AccountPicker";

export default function Step2StripeUpload(props: {
  accounts: ChartAccount[];
  check: StripeFundCheckResult | null;
  onCheckChange: (c: StripeFundCheckResult) => void;
  rulesAdded: Rule[];
  onRuleAdded: (r: Rule) => void;
  onNext: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { widths, startResize } = useColumnWidths("upload-step2-stripe-funds");

  async function runCheck() {
    setBusy(true);
    setError("");
    try {
      props.onCheckChange(await reconcileApi.stripeFundCheck());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    runCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const check = props.check;

  return (
    <div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Stripe transactions</h3>
        <p className="subtitle" style={{ marginTop: 0 }}>
          Fund coverage is checked against the Stripe transactions already synced on the{" "}
          <b>Stripe</b> page. If that data looks out of date, go sync it there first, then come
          back and re-check below.
        </p>
        <button className="btn secondary" onClick={runCheck} disabled={busy}>
          {busy ? "Checking…" : "Re-check funds"}
        </button>
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
          {check.funds.length === 0 ? (
            <p className="subtitle">
              No donation funds found in the synced Stripe data yet.
            </p>
          ) : check.all_covered ? (
            <p className="ok">✓ All funds have a rule.</p>
          ) : (
            <p className="error">
              ✗ Some funds don't have a rule yet - add one below for each so donations
              land in the right account.
            </p>
          )}
          <table className="resizable-cols">
            <ColGroup columns={["fund", "status", "account"]} widths={widths} />
            <thead>
              <tr>
                <th>
                  Fund
                  <ColResizeHandle col="fund" startResize={startResize} />
                </th>
                <th>
                  Status
                  <ColResizeHandle col="status" startResize={startResize} />
                </th>
                <th>
                  Account
                  <ColResizeHandle col="account" startResize={startResize} />
                </th>
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
                    runCheck();
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
