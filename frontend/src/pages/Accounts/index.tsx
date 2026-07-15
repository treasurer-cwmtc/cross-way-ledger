import { useEffect, useMemo, useState } from "react";
import { accountsApi, ChartAccount, StatementCategory, StatementItem } from "../../api/accounts";
import AddStatementCategoryForm from "./AddStatementCategoryForm";
import AddStatementItemForm from "./AddStatementItemForm";
import AddAccountForm from "./AddAccountForm";
import AccountRow from "./AccountRow";

export default function Accounts() {
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [statementCategories, setStatementCategories] = useState<StatementCategory[]>([]);
  const [statementItems, setStatementItems] = useState<StatementItem[]>([]);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const [a, sc, si] = await Promise.all([
        accountsApi.listAccounts(),
        accountsApi.listStatementCategories(),
        accountsApi.listStatementItems(),
      ]);
      setAccounts(a);
      setStatementCategories(sc);
      setStatementItems(si);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const categories = useMemo(
    () => Array.from(new Set(accounts.map((a) => a.category))).filter(Boolean),
    [accounts]
  );

  const filtered = accounts.filter((a) => {
    if (category && a.category !== category) return false;
    if (!q) return true;
    const s = q.toLowerCase();
    return (
      a.account_no.toLowerCase().includes(s) ||
      a.statement_description.toLowerCase().includes(s)
    );
  });

  return (
    <div>
      <h2 className="page-title">Chart of Accounts</h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        The Chart of Accounts is a 3-level hierarchy — Statement Category → Statement
        Item → Statement Detail (the account itself). Each level's number
        auto-increments within its parent and is generated for you; add levels
        top-down.
      </p>

      <AddStatementCategoryForm
        statementCategories={statementCategories}
        onCreated={load}
      />
      <AddStatementItemForm
        statementCategories={statementCategories}
        statementItems={statementItems}
        onCreated={load}
      />
      <AddAccountForm
        accounts={accounts}
        statementCategories={statementCategories}
        statementItems={statementItems}
        onCreated={load}
      />

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Accounts</h3>
        <div className="toolbar">
          <input
            type="text"
            placeholder="Search account or description…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ maxWidth: 320 }}
          />
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <span style={{ color: "var(--muted)", fontSize: 13 }}>
            {filtered.length} of {accounts.length}
          </span>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Account No</th>
                <th>Category</th>
                <th>Statement Description</th>
                <th>Tax Deductible</th>
                <th>Mandatory</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <AccountRow key={a.account_no} account={a} onChanged={load} />
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ color: "var(--muted)" }}>
                    No accounts yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
