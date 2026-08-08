import { useRef, useState } from "react";
import { Asset, AssetCreate, assetsApi } from "../../api/assets";
import CategoryInput from "./CategoryInput";

/** Fast, keyboard-driven entry - mirrors Budget/Restricted Net Assets'
 * Quick Add. Category and purchase date stay filled in between saves
 * (equipment is usually entered a batch at a time, e.g. right after
 * importing a year's worth of receipts), so only Item/Count/Cost
 * typically change row to row. */
export default function QuickAddModal(props: {
  categories: string[];
  onCreated: (asset: Asset) => void;
  onClose: () => void;
}) {
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState("");
  const [item, setItem] = useState("");
  const [count, setCount] = useState("1");
  const [cost, setCost] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [added, setAdded] = useState(0);
  const itemRef = useRef<HTMLInputElement>(null);

  const canSave = item.trim() !== "" && Number(count) > 0 && !Number.isNaN(Number(cost));

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!canSave || saving) return;
    setSaving(true);
    setError("");
    try {
      const payload: AssetCreate = {
        purchase_date: purchaseDate || null,
        category,
        item: item.trim(),
        count: Number(count),
        cost: Number(cost) || 0,
        notes,
      };
      const asset = await assetsApi.create(payload);
      props.onCreated(asset);
      setAdded((n) => n + 1);
      setItem("");
      setCount("1");
      setCost("");
      setNotes("");
      itemRef.current?.focus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal-dialog" onClick={(ev) => ev.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 style={{ margin: 0 }}>Quick add</h3>
            <p className="subtitle" style={{ margin: "2px 0 0" }}>
              {added > 0 ? `${added} added this session.` : "Fill in and press Enter to add."}
            </p>
          </div>
          <button className="link" onClick={props.onClose}>
            Close
          </button>
        </div>

        <form onSubmit={submit}>
          <label className="field">
            <span>Purchase Date</span>
            <input
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
            />
          </label>

          <label className="field">
            <span>Category</span>
            <CategoryInput value={category} categories={props.categories} onChange={setCategory} />
          </label>

          <label className="field">
            <span>Item</span>
            <input ref={itemRef} type="text" autoFocus value={item} onChange={(e) => setItem(e.target.value)} />
          </label>

          <div className="row">
            <label className="field">
              <span>Count</span>
              <input
                type="number"
                min={1}
                step="1"
                value={count}
                onChange={(e) => setCount(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Cost (per item)</span>
              <input
                type="number"
                step="0.01"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Total</span>
              <input
                type="text"
                disabled
                readOnly
                value={
                  Number(count) > 0 && !Number.isNaN(Number(cost))
                    ? (Number(count) * Number(cost)).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                      })
                    : ""
                }
              />
            </label>
          </div>

          <label className="field">
            <span>Notes</span>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>

          {error && <div className="error">{error}</div>}

          <div className="modal-footer">
            <button type="button" className="link" onClick={props.onClose}>
              Done
            </button>
            <button className="btn" type="submit" disabled={!canSave || saving}>
              {saving ? "Adding…" : "Add (Enter)"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
