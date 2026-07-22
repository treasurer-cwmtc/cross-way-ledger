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
  const [creatingNewItem, setCreatingNewItem] = useState(false);
  const [newItemName, setNewItemName] = useState("");
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

  // Same duplicate rule AddStatementItemForm enforces server-side: a
  // Statement Item name can't repeat under the same Statement Category.
  const trimmedNewItemName = newItemName.trim();
  const isNewItemDuplicate = useMemo(
    () =>
      !!trimmedNewItemName &&
      itemsInScope.some((i) => i.name.trim().toLowerCase() === trimmedNewItemName.toLowerCase()),
    [trimmedNewItemName, itemsInScope]
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
    // Can't preview account_no until the Statement Item actually exists -
    // when creating one inline, the preview only becomes possible after
    // that item is created, which happens at submit time instead.
    if (!statementItemId || isDuplicate || creatingNewItem) return;
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
  }, [statementItemId, statementDetail, isDuplicate, creatingNewItem]);

  async function submit() {
    if (creatingNewItem ? !statementCategoryId || !trimmedNewItemName || isNewItemDuplicate : !statementItemId || isDuplicate) {
      return;
    }
    setError("");
    setMsg("");
    setSaving(true);
    try {
      let itemId = statementItemId as number;
      if (creatingNewItem) {
        const newItem = await accountsApi.createStatementItem(statementCategoryId as number, newItemName);
        itemId = newItem.id;
      }
      const created = await accountsApi.createAccount({
        statement_item_id: itemId,
        statement_detail: statementDetail,
        is_tax_deductible: isTaxDeductible ? "Yes" : "",
        is_mandatory: isMandatory ? "Yes" : "",
      });
      setMsg(`Created ${created.account_no}.`);
      setStatementDetail("");
      setNewItemName("");
      setCreatingNewItem(false);
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
          {creatingNewItem ? (
            <input
              type="text"
              className={isNewItemDuplicate ? "input-error" : ""}
              value={newItemName}
              placeholder="New Statement Item name"
              onChange={(e) => setNewItemName(e.target.value)}
              disabled={!statementCategoryId}
            />
          ) : (
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
          )}
          <button
            type="button"
            className="link"
            style={{ fontSize: 12, marginTop: 4, textAlign: "left" }}
            disabled={!statementCategoryId}
            onClick={() => {
              setCreatingNewItem((v) => !v);
              setStatementItemId("");
              setNewItemName("");
            }}
          >
            {creatingNewItem ? "← Choose an existing Statement Item instead" : "+ Create a new Statement Item"}
          </button>
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
      {creatingNewItem && isNewItemDuplicate && (
        <div className="error">
          A Statement Item named "{trimmedNewItemName}" already exists under this category.
        </div>
      )}
      <div className="row">
        <label className="field field-checkbox">
          <input
            type="checkbox"
            checked={isTaxDeductible}
            onChange={(e) => setIsTaxDeductible(e.target.checked)}
          />
          <span>Tax deductible</span>
        </label>
        <label className="field field-checkbox">
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
            {creatingNewItem
              ? "assigned after the new Statement Item is created"
              : preview || (previewError ? "—" : statementItemId ? "…" : "")}
          </div>
        </div>
      </div>
      {previewError && !creatingNewItem && <div className="error">{previewError}</div>}
      <button
        className="btn"
        onClick={submit}
        disabled={
          saving ||
          (creatingNewItem
            ? !statementCategoryId || !trimmedNewItemName || isNewItemDuplicate
            : !statementItemId || isDuplicate || !preview || !!previewError)
        }
      >
        Add account
      </button>
      {msg && <div className="ok">{msg}</div>}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
