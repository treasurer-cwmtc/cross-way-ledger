import { useEffect, useState } from "react";
import { accountsApi, ChartAccount } from "../api/accounts";
import { rulesApi, Rule } from "../api/rules";
import { ColGroup, ColResizeHandle, useColumnWidths } from "../components/ColumnResize";

export default function Rules() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Rule | null>(null);

  const [ruleType, setRuleType] = useState<"bank_keyword" | "stripe_fund">(
    "bank_keyword"
  );
  const [pattern, setPattern] = useState("");
  const [accountNo, setAccountNo] = useState("");
  const [description, setDescription] = useState("");
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
      await rulesApi.createRule({
        rule_type: ruleType,
        pattern,
        account_no: accountNo,
        description: ruleType === "bank_keyword" ? description : "",
        priority,
      });
      setPattern("");
      setAccountNo("");
      setDescription("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function update(id: number, patch: Partial<Rule>) {
    const updated = await rulesApi.updateRule(id, patch);
    setRules((prev) => prev.map((r) => (r.id === id ? updated : r)));
    setSelected((prev) => (prev && prev.id === id ? updated : prev));
  }

  async function toggle(rule: Rule) {
    await update(rule.id, { active: !rule.active });
  }

  async function remove(id: number) {
    await rulesApi.deleteRule(id);
    setSelected(null);
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
          {ruleType === "bank_keyword" && (
            <label className="field">
              <span>Description (optional)</span>
              <input
                type="text"
                value={description}
                placeholder="e.g. Sams Club"
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
          )}
          <label className="field" style={{ maxWidth: 120 }}>
            <span>Priority</span>
            <input
              type="number"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
            />
          </label>
        </div>
        <p className="subtitle" style={{ marginTop: 0 }}>
          Description (bank keyword rules only) auto-fills a matched line's
          Description field with a friendly payee name, e.g. "Sams Club"
          instead of the raw bank text — same idea as the treasurer's upload
          template spreadsheet's Description column.
        </p>
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
        showDescription
        onToggle={toggle}
        onSelect={setSelected}
        storageKey="rules-bank-keyword"
      />
      <RuleTable
        title="Stripe fund rules"
        subtitle="Maps a Stripe donation fund name to an income account."
        rules={fundRules}
        accounts={accounts}
        onToggle={toggle}
        onSelect={setSelected}
        storageKey="rules-stripe-fund"
      />

      {selected && (
        <RuleDetailModal
          rule={selected}
          accounts={accounts}
          onUpdate={update}
          onDelete={remove}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function RuleTable(props: {
  title: string;
  subtitle: string;
  rules: Rule[];
  accounts: ChartAccount[];
  showDescription?: boolean;
  onToggle: (r: Rule) => void;
  onSelect: (r: Rule) => void;
  storageKey: string;
}) {
  const desc = (no: string) =>
    props.accounts.find((a) => a.account_no === no)?.statement_description || "";
  const colCount = props.showDescription ? 6 : 5;
  const { widths, startResize } = useColumnWidths(props.storageKey);
  const columns = [
    "match",
    ...(props.showDescription ? ["description"] : []),
    "account",
    "category",
    "priority",
    "active",
  ];
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{props.title}</h3>
      <p className="subtitle">{props.subtitle}</p>
      <table className="resizable-cols">
        <ColGroup columns={columns} widths={widths} />
        <thead>
          <tr>
            <th>
              Match
              <ColResizeHandle col="match" startResize={startResize} />
            </th>
            {props.showDescription && (
              <th>
                Description
                <ColResizeHandle col="description" startResize={startResize} />
              </th>
            )}
            <th>
              Account
              <ColResizeHandle col="account" startResize={startResize} />
            </th>
            <th>
              Category
              <ColResizeHandle col="category" startResize={startResize} />
            </th>
            <th className="num">
              Priority
              <ColResizeHandle col="priority" startResize={startResize} />
            </th>
            <th>
              Active
              <ColResizeHandle col="active" startResize={startResize} />
            </th>
          </tr>
        </thead>
        <tbody>
          {props.rules.map((r) => (
            <tr key={r.id} className="register-row" onClick={() => props.onSelect(r)}>
              <td>
                <b>{r.pattern}</b>
              </td>
              {props.showDescription && <td>{r.description}</td>}
              <td>{r.account_no}</td>
              <td>{desc(r.account_no)}</td>
              <td className="num">{r.priority}</td>
              <td>
                <input
                  type="checkbox"
                  checked={r.active}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => props.onToggle(r)}
                />
              </td>
            </tr>
          ))}
          {props.rules.length === 0 && (
            <tr>
              <td colSpan={colCount} style={{ color: "var(--muted)" }}>
                No rules yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function RuleDetailModal(props: {
  rule: Rule;
  accounts: ChartAccount[];
  onUpdate: (id: number, patch: Partial<Rule>) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
}) {
  const r = props.rule;
  const [accountNo, setAccountNo] = useState(r.account_no);
  const [priority, setPriority] = useState(r.priority);
  const [description, setDescription] = useState(r.description);

  useEffect(() => {
    setAccountNo(r.account_no);
    setPriority(r.priority);
    setDescription(r.description);
  }, [r]);

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") props.onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const accountsForType = props.accounts.filter((a) =>
    r.rule_type === "stripe_fund" ? a.category === "Income" : a.category === "Expense"
  );

  function saveAccount(v: string) {
    setAccountNo(v);
    if (v) props.onUpdate(r.id, { account_no: v });
  }

  function savePriority() {
    if (priority !== r.priority) props.onUpdate(r.id, { priority });
  }

  function saveDescription() {
    if (description !== r.description) props.onUpdate(r.id, { description });
  }

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal-dialog" onClick={(ev) => ev.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 style={{ margin: 0 }}>{r.pattern}</h3>
            <p className="subtitle" style={{ margin: "2px 0 0" }}>
              {r.rule_type === "bank_keyword" ? "Bank keyword rule" : "Stripe fund rule"}
            </p>
          </div>
          <button className="link" onClick={props.onClose}>
            Close
          </button>
        </div>

        <label className="field field-checkbox">
          <input
            type="checkbox"
            checked={r.active}
            onChange={() => props.onUpdate(r.id, { active: !r.active })}
          />
          <span>Active</span>
        </label>

        <label className="field">
          <span>Category (account)</span>
          <select value={accountNo} onChange={(e) => saveAccount(e.target.value)}>
            <option value="">Select an account…</option>
            {accountsForType.map((a) => (
              <option key={a.account_no} value={a.account_no}>
                {a.account_no} · {a.statement_description}
              </option>
            ))}
          </select>
        </label>

        {r.rule_type === "bank_keyword" && (
          <label className="field">
            <span>Description (optional)</span>
            <input
              type="text"
              value={description}
              placeholder="e.g. Sams Club"
              onChange={(e) => setDescription(e.target.value)}
              onBlur={saveDescription}
            />
          </label>
        )}

        <label className="field">
          <span>Priority</span>
          <input
            type="number"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            onBlur={savePriority}
          />
        </label>

        <div className="modal-footer">
          <button
            className="link"
            onClick={() => {
              props.onDelete(r.id);
              props.onClose();
            }}
          >
            Delete rule
          </button>
          <button className="btn" onClick={props.onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
