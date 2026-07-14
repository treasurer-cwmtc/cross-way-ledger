import { useMemo, useState } from "react";
import { accountsApi, StatementCategory } from "../../api/accounts";

const CATEGORIES = ["Income", "Expense", "Budget"];

export default function AddStatementCategoryForm(props: {
  statementCategories: StatementCategory[];
  onCreated: () => void;
}) {
  const [selectedTypes, setSelectedTypes] = useState<string[]>(["Income"]);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const allSelected = CATEGORIES.every((c) => selectedTypes.includes(c));
  const trimmedName = name.trim();

  // Types (among the selected ones) that already have a category with this
  // name - checked live, so the field can turn red before the user submits.
  const conflictingTypes = useMemo(() => {
    if (!trimmedName) return [];
    return selectedTypes.filter((type) =>
      props.statementCategories.some(
        (c) => c.category === type && c.name.trim().toLowerCase() === trimmedName.toLowerCase()
      )
    );
  }, [trimmedName, selectedTypes, props.statementCategories]);
  const isDuplicate = conflictingTypes.length > 0;

  function toggleType(c: string) {
    setSelectedTypes((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    );
  }

  function toggleAll() {
    setSelectedTypes(allSelected ? [] : [...CATEGORIES]);
  }

  async function submit() {
    if (isDuplicate) return;
    setError("");
    setMsg("");
    setSaving(true);
    const created: string[] = [];
    const failed: string[] = [];
    for (const type of selectedTypes) {
      try {
        const row = await accountsApi.createStatementCategory(type, name);
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
            className={isDuplicate ? "input-error" : ""}
            value={name}
            placeholder="e.g. Property"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      </div>
      {isDuplicate && (
        <div className="error">
          A Statement Category named "{trimmedName}" already exists under:{" "}
          {conflictingTypes.join(", ")}.
        </div>
      )}
      <button
        className="btn"
        onClick={submit}
        disabled={saving || !trimmedName || selectedTypes.length === 0 || isDuplicate}
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
