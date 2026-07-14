import { useState } from "react";
import { accountsApi, ChartAccount } from "../../api/accounts";

export default function AccountRow(props: { account: ChartAccount; onChanged: () => void }) {
  const a = props.account;
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState(a.statement_description);
  const [error, setError] = useState("");

  async function saveDescription() {
    setError("");
    try {
      await accountsApi.updateAccount(a.account_no, { statement_description: description });
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
      await accountsApi.deleteAccount(a.account_no);
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
