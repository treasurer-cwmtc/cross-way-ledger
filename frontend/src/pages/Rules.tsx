import { useEffect, useState } from "react";
import { accountsApi, ChartAccount } from "../api/accounts";
import { rulesApi, Rule } from "../api/rules";

export default function Rules() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [error, setError] = useState("");

  const [ruleType, setRuleType] = useState<"bank_keyword" | "stripe_fund">(
    "bank_keyword"
  );
  const [pattern, setPattern] = useState("");
  const [accountNo, setAccountNo] = useState("");
  const [priority, setPriority] = useState(100);

  async function load() {
    try {
      const [r, a] = await Promise.all([rulesApi.listRules(), accountsApi.listAccounts()]);
      setRules(r);
      setAccounts(a);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function addRule() {
    setError("");
    try {
      await rulesApi.createRule({ rule_type: ruleType, pattern, account_no: accountNo, priority });
      setPattern("");
      setAccountNo("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function toggle(rule: Rule) {
    await rulesApi.updateRule(rule.id, { active: !rule.active });
    await load();
  }

  async function remove(id: number) {
    await rulesApi.deleteRule(id);
    await load();
  }

  const accountsForType = accounts.filter((a) =>
    ruleType === "stripe_fund" ? a.category === "Income" : a.category === "Expense"
  );

  const keywordRules = rules.filter((r) => r.rule_type === "bank_keyword");
  const fundRules = rules.filter((r) => r.rule_type === "stripe_fund");

  return (
    <div>
      <h2 className="page-title">Rules</h2>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Add a rule</h3>
        <div className="row">
          <label className="field">
            <span>Rule type</span>
            <select
              value={ruleType}
              onChange={(e) => {
                setRuleType(e.target.value as typeof ruleType);
                setAccountNo("");
              }}
            >
              <option value="bank_keyword">
                Bank keyword → category (description contains…)
              </option>
              <option value="stripe_fund">Stripe fund → category</option>
            </select>
          </label>
          <label className="field">
            <span>{ruleType === "bank_keyword" ? "Keyword / phrase" : "Fund name"}</span>
            <input
              type="text"
              value={pattern}
              placeholder={ruleType === "bank_keyword" ? "e.g. ATMOS ENERGY" : "e.g. Building Fund"}
              onChange={(e) => setPattern(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Category (account)</span>
            <select value={accountNo} onChange={(e) => setAccountNo(e.target.value)}>
              <option value="">Select an account…</option>
              {accountsForType.map((a) => (
                <option key={a.account_no} value={a.account_no}>
                  {a.account_no} · {a.statement_description}
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ maxWidth: 120 }}>
            <span>Priority</span>
            <input
              type="number"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
            />
          </label>
        </div>
        <button className="btn" onClick={addRule} disabled={!pattern || !accountNo}>
          Add rule
        </button>
        {error && <div className="error">{error}</div>}
      </div>

      <RuleTable
        title="Bank keyword rules"
        subtitle="If a bank line's description contains the phrase, assign the category."
        rules={keywordRules}
        accounts={accounts}
        onToggle={toggle}
        onRemove={remove}
      />
      <RuleTable
        title="Stripe fund rules"
        subtitle="Maps a Stripe donation fund name to an income account."
        rules={fundRules}
        accounts={accounts}
        onToggle={toggle}
        onRemove={remove}
      />
    </div>
  );
}

function RuleTable(props: {
  title: string;
  subtitle: string;
  rules: Rule[];
  accounts: ChartAccount[];
  onToggle: (r: Rule) => void;
  onRemove: (id: number) => void;
}) {
  const desc = (no: string) =>
    props.accounts.find((a) => a.account_no === no)?.statement_description || "";
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{props.title}</h3>
      <p className="subtitle">{props.subtitle}</p>
      <table>
        <thead>
          <tr>
            <th>Match</th>
            <th>Account</th>
            <th>Category</th>
            <th className="num">Priority</th>
            <th>Active</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {props.rules.map((r) => (
            <tr key={r.id}>
              <td>
                <b>{r.pattern}</b>
              </td>
              <td>{r.account_no}</td>
              <td>{desc(r.account_no)}</td>
              <td className="num">{r.priority}</td>
              <td>
                <input
                  type="checkbox"
                  checked={r.active}
                  onChange={() => props.onToggle(r)}
                />
              </td>
              <td>
                <button className="link" onClick={() => props.onRemove(r.id)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {props.rules.length === 0 && (
            <tr>
              <td colSpan={6} style={{ color: "var(--muted)" }}>
                No rules yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
