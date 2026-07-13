import { useEffect, useMemo, useState } from "react";
import { api, ChartAccount } from "../api";

export default function Accounts() {
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      setAccounts(await api.listAccounts());
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onUpload(file: File) {
    setMsg("");
    setError("");
    try {
      const { loaded } = await api.uploadAccounts(file);
      setMsg(`Loaded ${loaded} accounts.`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

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
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Replace Chart of Accounts</h3>
        <p className="subtitle">
          Upload a CSV export of the “IMPORT - Chart of Accounts” tab (columns:
          AccountNo, Category, StatementCategory, StatementItem, StatementDetail,
          StatementDescription, IsTaxDeductible, IsMandatory).
        </p>
        <input
          type="file"
          accept=".csv"
          onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
        />
        {msg && <div className="ok">{msg}</div>}
        {error && <div className="error">{error}</div>}
      </div>

      <div className="card">
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
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Account No</th>
                <th>Category</th>
                <th>Statement Description</th>
                <th>Tax Deductible</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.account_no}>
                  <td>{a.account_no}</td>
                  <td>{a.category}</td>
                  <td>{a.statement_description}</td>
                  <td>{a.is_tax_deductible}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
