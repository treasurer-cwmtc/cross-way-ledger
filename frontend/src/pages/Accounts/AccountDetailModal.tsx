import { useState } from "react";
import { accountsApi, ChartAccount } from "../../api/accounts";

/** Click-to-expand detail for one Chart of Accounts row: every field the
 * account has, not just the 5 columns the flat table shows (grouping,
 * Youth Chaplain Share, and Missions in particular have no other UI
 * today). Every field is editable except account_no and the hierarchy
 * that derives it (Type, Statement Category, Statement Item, Statement
 * Detail) - those are immutable by backend design once created, since
 * category rules and past reconciliation/accrual/budget entries reference
 * account_no by value (see ChartOfAccountUpdate in backend/app/schemas.py).
 * Changing them would mean regenerating account_no and orphaning every
 * historical row that points at the old one. */
export default function AccountDetailModal({
  account,
  onClose,
  onChanged,
}: {
  account: ChartAccount;
  onClose: () => void;
  onChanged: () => void;
}) {
  const a = account;
  const [description, setDescription] = useState(a.statement_description);
  const [isTaxDeductible, setIsTaxDeductible] = useState(a.is_tax_deductible === "Yes");
  const [isMandatory, setIsMandatory] = useState(a.is_mandatory === "Yes");
  const [grouping, setGrouping] = useState(a.grouping);
  const [isYouthChaplainShare, setIsYouthChaplainShare] = useState(a.is_youth_chaplain_share === "Yes");
  const [isMissions, setIsMissions] = useState(a.is_missions === "Yes");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const dirty =
    description !== a.statement_description ||
    isTaxDeductible !== (a.is_tax_deductible === "Yes") ||
    isMandatory !== (a.is_mandatory === "Yes") ||
    grouping !== a.grouping ||
    isYouthChaplainShare !== (a.is_youth_chaplain_share === "Yes") ||
    isMissions !== (a.is_missions === "Yes");

  async function save() {
    setError("");
    setSaving(true);
    try {
      await accountsApi.updateAccount(a.account_no, {
        statement_description: description,
        is_tax_deductible: isTaxDeductible ? "Yes" : "",
        is_mandatory: isMandatory ? "Yes" : "",
        grouping,
        is_youth_chaplain_share: isYouthChaplainShare ? "Yes" : "",
        is_missions: isMissions ? "Yes" : "",
      });
      onChanged();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete account ${a.account_no}? This cannot be undone.`)) return;
    setError("");
    try {
      await accountsApi.deleteAccount(a.account_no);
      onChanged();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function onEsc(ev: React.KeyboardEvent) {
    if (ev.key === "Escape") onClose();
  }

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      onKeyDown={onEsc}
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div
        className="card"
        onClick={(ev) => ev.stopPropagation()}
        style={{ maxWidth: 560, width: "90%", maxHeight: "85vh", overflowY: "auto" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <h3 style={{ marginTop: 0, fontFamily: "monospace" }}>{a.account_no}</h3>
          <button className="link" onClick={onClose}>
            Close
          </button>
        </div>

        <h4 style={{ marginBottom: 6 }}>Hierarchy (fixed once created)</h4>
        <table style={{ marginBottom: 16 }}>
          <tbody>
            <tr>
              <td className="subtitle">Type</td>
              <td>{a.category}</td>
            </tr>
            <tr>
              <td className="subtitle">Statement Category</td>
              <td>
                {a.statement_category_no} · {a.statement_category}
              </td>
            </tr>
            <tr>
              <td className="subtitle">Statement Item</td>
              <td>
                {a.statement_item_no} · {a.statement_item}
              </td>
            </tr>
            <tr>
              <td className="subtitle">Statement Detail</td>
              <td>{a.statement_detail || "—"}</td>
            </tr>
          </tbody>
        </table>

        <h4 style={{ marginBottom: 6 }}>Details</h4>
        <label className="field" style={{ marginBottom: 10 }}>
          <span>Statement Description</span>
          <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="field" style={{ marginBottom: 10 }}>
          <span>Grouping</span>
          <input type="text" value={grouping} onChange={(e) => setGrouping(e.target.value)} />
        </label>
        <div className="row" style={{ gap: 18, marginBottom: 16, flexWrap: "wrap" }}>
          <label className="field-checkbox">
            <input type="checkbox" checked={isTaxDeductible} onChange={(e) => setIsTaxDeductible(e.target.checked)} />
            <span>Tax deductible</span>
          </label>
          <label className="field-checkbox">
            <input type="checkbox" checked={isMandatory} onChange={(e) => setIsMandatory(e.target.checked)} />
            <span>Mandatory</span>
          </label>
          <label className="field-checkbox">
            <input
              type="checkbox"
              checked={isYouthChaplainShare}
              onChange={(e) => setIsYouthChaplainShare(e.target.checked)}
            />
            <span>Youth Chaplain Share</span>
          </label>
          <label className="field-checkbox">
            <input type="checkbox" checked={isMissions} onChange={(e) => setIsMissions(e.target.checked)} />
            <span>Missions</span>
          </label>
        </div>

        {error && <div className="error">{error}</div>}

        <div className="row" style={{ justifyContent: "space-between" }}>
          <button className="link" onClick={remove} style={{ color: "var(--red)" }}>
            Delete account
          </button>
          <button className="btn" onClick={save} disabled={!dirty || saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
