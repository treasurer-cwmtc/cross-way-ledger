import { useEffect, useMemo, useState } from "react";
import { api, ChartAccount, StatementCategory, StatementItem } from "../api";

const CATEGORIES = ["Income", "Expense", "Budget"];

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
        api.listAccounts(),
        api.listStatementCategories(),
        api.listStatementItems(),
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

function AddStatementCategoryForm(props: {
  statementCategories: StatementCategory[];
  onCreated: () => void;
}) {
  const [selectedTypes, setSelectedTypes] = useState<string[]>(["Income"]);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const allSelected = CATEGORIES.every((c) => selectedTypes.includes(c));

  function toggleType(c: string) {
    setSelectedTypes((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    );
  }

  function toggleAll() {
    setSelectedTypes(allSelected ? [] : [...CATEGORIES]);
  }

  async function submit() {
    setError("");
    setMsg("");
    setSaving(true);
    const created: string[] = [];
    const failed: string[] = [];
    for (const type of selectedTypes) {
      try {
        const row = await api.createStatementCategory(type, name);
        created.push(`${type} ${row.no}`);
      } catch (e) {
        failed.push(`${type}: ${(e as Error).message}`);
      }
    }
    setSaving(false);
    if (created.length) {
      setMsg(`Created Statement Category "${name}" under: ${created.join(", ")}.`);
      setName("");
    }
    if (failed.length) {
      setError(failed.join(" "));
    }
    props.onCreated();
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>1. Add a Statement Category</h3>
      <p className="subtitle">
        Top level, scoped to a Type. Number auto-increments within that Type.
        Check multiple Types (or All) to create the same-named category under
        each one — each gets its own independent number.
      </p>
      <div className="row">
        <div className="field">
          <span>Type(s)</span>
          <div style={{ display: "flex", gap: 14, alignItems: "center", paddingTop: 6 }}>
            {CATEGORIES.map((c) => (
              <label key={c} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <input
                  type="checkbox"
                  checked={selectedTypes.includes(c)}
                  onChange={() => toggleType(c)}
                />
                <span>{c}</span>
              </label>
            ))}
            <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              <span>All</span>
            </label>
          </div>
        </div>
        <label className="field">
          <span>Name</span>
          <input
            type="text"
            value={name}
            placeholder="e.g. Property"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      </div>
      <button
        className="btn"
        onClick={submit}
        disabled={saving || !name.trim() || selectedTypes.length === 0}
      >
        Add Statement Category
      </button>
      {msg && <div className="ok">{msg}</div>}
      {error && <div className="error">{error}</div>}
      {selectedTypes.map((type) => {
        const existing = props.statementCategories.filter((c) => c.category === type);
        if (existing.length === 0) return null;
        return (
          <p key={type} className="subtitle" style={{ marginBottom: 0 }}>
            Existing under {type}: {existing.map((c) => `${c.no} ${c.name}`).join(", ")}
          </p>
        );
      })}
    </div>
  );
}

function AddStatementItemForm(props: {
  statementCategories: StatementCategory[];
  statementItems: StatementItem[];
  onCreated: () => void;
}) {
  const [category, setCategory] = useState("Income");
  const [statementCategoryId, setStatementCategoryId] = useState<number | "">("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const categoriesInScope = props.statementCategories.filter((c) => c.category === category);
  const itemsInScope = props.statementItems.filter(
    (i) => i.statement_category_id === statementCategoryId
  );

  async function submit() {
    if (!statementCategoryId) return;
    setError("");
    setMsg("");
    setSaving(true);
    try {
      const created = await api.createStatementItem(statementCategoryId, name);
      setMsg(`Created Statement Item ${created.no} · ${created.name}.`);
      setName("");
      props.onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>2. Add a Statement Item</h3>
      <p className="subtitle">
        Nests under a Statement Category. Number auto-increments within that
        parent.
      </p>
      <div className="row">
        <label className="field">
          <span>Type</span>
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setStatementCategoryId("");
            }}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Statement Category (parent)</span>
          <select
            value={statementCategoryId}
            onChange={(e) => setStatementCategoryId(Number(e.target.value) || "")}
          >
            <option value="">Select…</option>
            {categoriesInScope.map((c) => (
              <option key={c.id} value={c.id}>
                {c.no} · {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Name</span>
          <input
            type="text"
            value={name}
            placeholder="e.g. Church-Utilities"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      </div>
      <button
        className="btn"
        onClick={submit}
        disabled={saving || !statementCategoryId || !name.trim()}
      >
        Add Statement Item
      </button>
      {msg && <div className="ok">{msg}</div>}
      {error && <div className="error">{error}</div>}
      {statementCategoryId && itemsInScope.length > 0 && (
        <p className="subtitle" style={{ marginBottom: 0 }}>
          Existing under this category: {itemsInScope.map((i) => `${i.no} ${i.name}`).join(", ")}
        </p>
      )}
    </div>
  );
}

function AddAccountForm(props: {
  statementCategories: StatementCategory[];
  statementItems: StatementItem[];
  onCreated: () => void;
}) {
  const [category, setCategory] = useState("Income");
  const [statementCategoryId, setStatementCategoryId] = useState<number | "">("");
  const [statementItemId, setStatementItemId] = useState<number | "">("");
  const [statementDetail, setStatementDetail] = useState("");
  const [isTaxDeductible, setIsTaxDeductible] = useState(false);
  const [isMandatory, setIsMandatory] = useState(false);
  const [preview, setPreview] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const categoriesInScope = props.statementCategories.filter((c) => c.category === category);
  const itemsInScope = props.statementItems.filter(
    (i) => i.statement_category_id === statementCategoryId
  );

  useEffect(() => {
    setPreview("");
    setPreviewError("");
    if (!statementItemId) return;
    const handle = setTimeout(async () => {
      try {
        const p = await api.previewAccountNo({
          statement_item_id: statementItemId,
          statement_detail: statementDetail,
        });
        setPreview(p.account_no);
      } catch (e) {
        setPreviewError((e as Error).message);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [statementItemId, statementDetail]);

  async function submit() {
    if (!statementItemId) return;
    setError("");
    setMsg("");
    setSaving(true);
    try {
      const created = await api.createAccount({
        statement_item_id: statementItemId,
        statement_detail: statementDetail,
        is_tax_deductible: isTaxDeductible ? "Yes" : "",
        is_mandatory: isMandatory ? "Yes" : "",
      });
      setMsg(`Created ${created.account_no}.`);
      setStatementDetail("");
      props.onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>3. Add an Account (Statement Detail)</h3>
      <p className="subtitle">
        Nests under a Statement Item. Detail is optional — leave it blank for a
        "no subdivision" account. The account number is generated for you.
      </p>
      <div className="row">
        <label className="field">
          <span>Type</span>
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setStatementCategoryId("");
              setStatementItemId("");
            }}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Statement Category</span>
          <select
            value={statementCategoryId}
            onChange={(e) => {
              setStatementCategoryId(Number(e.target.value) || "");
              setStatementItemId("");
            }}
          >
            <option value="">Select…</option>
            {categoriesInScope.map((c) => (
              <option key={c.id} value={c.id}>
                {c.no} · {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Statement Item</span>
          <select
            value={statementItemId}
            onChange={(e) => setStatementItemId(Number(e.target.value) || "")}
            disabled={!statementCategoryId}
          >
            <option value="">Select…</option>
            {itemsInScope.map((i) => (
              <option key={i.id} value={i.id}>
                {i.no} · {i.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Statement Detail (optional)</span>
          <input
            type="text"
            value={statementDetail}
            placeholder="e.g. Internet"
            onChange={(e) => setStatementDetail(e.target.value)}
          />
        </label>
      </div>
      <div className="row">
        <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={isTaxDeductible}
            onChange={(e) => setIsTaxDeductible(e.target.checked)}
          />
          <span>Tax deductible</span>
        </label>
        <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={isMandatory}
            onChange={(e) => setIsMandatory(e.target.checked)}
          />
          <span>Mandatory</span>
        </label>
        <div className="field">
          <span>Account number</span>
          <div style={{ fontFamily: "monospace", fontSize: 16, padding: "6px 0" }}>
            {preview || (previewError ? "—" : statementItemId ? "…" : "")}
          </div>
        </div>
      </div>
      {previewError && <div className="error">{previewError}</div>}
      <button
        className="btn"
        onClick={submit}
        disabled={saving || !statementItemId || !preview || !!previewError}
      >
        Add account
      </button>
      {msg && <div className="ok">{msg}</div>}
      {error && <div className="error">{error}</div>}
    </div>
  );
}

function AccountRow(props: { account: ChartAccount; onChanged: () => void }) {
  const a = props.account;
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState(a.statement_description);
  const [error, setError] = useState("");

  async function saveDescription() {
    setError("");
    try {
      await api.updateAccount(a.account_no, { statement_description: description });
      setEditing(false);
      props.onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove() {
    setError("");
    if (!confirm(`Delete account ${a.account_no}?`)) return;
    try {
      await api.deleteAccount(a.account_no);
      props.onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <tr>
      <td>{a.account_no}</td>
      <td>{a.category}</td>
      <td>
        {editing ? (
          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{ flex: 1 }}
            />
            <button className="link" onClick={saveDescription}>
              Save
            </button>
            <button className="link" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <span onDoubleClick={() => setEditing(true)}>{a.statement_description}</span>
        )}
        {error && <div className="error">{error}</div>}
      </td>
      <td>{a.is_tax_deductible}</td>
      <td>{a.is_mandatory}</td>
      <td>
        <button className="link" onClick={() => setEditing(true)}>
          Edit
        </button>{" "}
        <button className="link" onClick={remove}>
          Delete
        </button>
      </td>
    </tr>
  );
}
