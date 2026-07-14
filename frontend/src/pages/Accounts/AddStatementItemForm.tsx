import { useMemo, useState } from "react";
import { accountsApi, StatementCategory, StatementItem } from "../../api/accounts";

const CATEGORIES = ["Income", "Expense", "Budget"];

export default function AddStatementItemForm(props: {
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

  const trimmedName = name.trim();
  const isDuplicate = useMemo(
    () =>
      !!trimmedName &&
      itemsInScope.some((i) => i.name.trim().toLowerCase() === trimmedName.toLowerCase()),
    [trimmedName, itemsInScope]
  );

  async function submit() {
    if (!statementCategoryId || isDuplicate) return;
    setError("");
    setMsg("");
    setSaving(true);
    try {
      const created = await accountsApi.createStatementItem(statementCategoryId, name);
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
            className={isDuplicate ? "input-error" : ""}
            value={name}
            placeholder="e.g. Church-Utilities"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      </div>
      {isDuplicate && (
        <div className="error">
          A Statement Item named "{trimmedName}" already exists under this category.
        </div>
      )}
      <button
        className="btn"
        onClick={submit}
        disabled={saving || !statementCategoryId || !trimmedName || isDuplicate}
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
