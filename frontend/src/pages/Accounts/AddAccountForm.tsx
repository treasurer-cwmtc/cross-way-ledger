import { useEffect, useMemo, useState } from "react";
import { accountsApi, ChartAccount, StatementCategory, StatementItem } from "../../api/accounts";

const CATEGORIES = ["Income", "Expense", "Budget"];

export default function AddAccountForm(props: {
  accounts: ChartAccount[];
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

  const trimmedDetail = statementDetail.trim();
  // Live, local duplicate check (no round trip) - the same rule the server
  // enforces: a Statement Detail name (blank counts as a name) can't repeat
  // under the same Statement Item.
  const isDuplicate = useMemo(() => {
    if (!statementItemId) return false;
    return props.accounts.some(
      (a) =>
        a.statement_item_id === statementItemId &&
        a.statement_detail.trim().toLowerCase() === trimmedDetail.toLowerCase()
    );
  }, [statementItemId, trimmedDetail, props.accounts]);

  useEffect(() => {
    setPreview("");
    setPreviewError("");
    if (!statementItemId || isDuplicate) return;
    const handle = setTimeout(async () => {
      try {
        const p = await accountsApi.previewAccountNo({
          statement_item_id: statementItemId,
          statement_detail: statementDetail,
        });
        setPreview(p.account_no);
      } catch (e) {
        setPreviewError((e as Error).message);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [statementItemId, statementDetail, isDuplicate]);

  async function submit() {
    if (!statementItemId || isDuplicate) return;
    setError("");
    setMsg("");
    setSaving(true);
    try {
      const created = await accountsApi.createAccount({
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
            className={isDuplicate ? "input-error" : ""}
            value={statementDetail}
            placeholder="e.g. Internet"
            onChange={(e) => setStatementDetail(e.target.value)}
          />
        </label>
      </div>
      {isDuplicate && (
        <div className="error">
          {trimmedDetail
            ? `A Statement Detail named "${trimmedDetail}" already exists under this item.`
            : "A blank-detail account already exists under this item."}
        </div>
      )}
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
        disabled={saving || !statementItemId || isDuplicate || !preview || !!previewError}
      >
        Add account
      </button>
      {msg && <div className="ok">{msg}</div>}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
