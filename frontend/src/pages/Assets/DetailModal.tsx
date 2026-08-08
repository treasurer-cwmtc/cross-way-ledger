import { useEffect, useState } from "react";
import { Asset, AssetUpdate } from "../../api/assets";
import { pickAssetReceiptFile } from "../../lib/googleDrive";
import { CurrencyCell, DateCell, TextCell } from "../ledger/cells";
import CategoryInput from "./CategoryInput";

/** Full editor for one asset. Not the shared Reconciliation/Accrual
 * TransactionModal - an asset has no bank account, method, or reconciled
 * flag, and its receipt goes to its own "Asset Library" Drive folder
 * instead of a year folder (see lib/googleDrive.ts). */
export default function DetailModal(props: {
  asset: Asset;
  categories: string[];
  onUpdate: (id: number, patch: AssetUpdate) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
}) {
  const a = props.asset;
  const set = (patch: AssetUpdate) => props.onUpdate(a.id, patch);
  const [count, setCount] = useState(String(a.count));
  const [attachingReceipt, setAttachingReceipt] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setCount(String(a.count)), [a.count]);

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") props.onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function commitCount() {
    const n = Number(count);
    if (!Number.isNaN(n) && n > 0 && n !== a.count) set({ count: n });
  }

  async function attachReceipt() {
    setError("");
    setAttachingReceipt(true);
    try {
      const file = await pickAssetReceiptFile();
      if (file) {
        set({
          receipt_file_id: file.id,
          receipt_file_name: file.name,
          receipt_web_view_link: file.url,
        });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAttachingReceipt(false);
    }
  }

  function removeReceipt() {
    set({ receipt_file_id: "", receipt_file_name: "", receipt_web_view_link: "" });
  }

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal-dialog" onClick={(ev) => ev.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 style={{ margin: 0 }}>{a.item || "Asset"}</h3>
            <p className="subtitle" style={{ margin: "2px 0 0" }}>
              {a.category || "Uncategorized"} · $
              {a.total.toLocaleString(undefined, { minimumFractionDigits: 2 })} total
            </p>
          </div>
          <button className="link" onClick={props.onClose}>
            Close
          </button>
        </div>

        <label className="field">
          <span>Purchase Date</span>
          <DateCell value={a.purchase_date} onChange={(v) => set({ purchase_date: v })} />
        </label>

        <label className="field">
          <span>Category</span>
          <CategoryInput
            value={a.category}
            categories={props.categories}
            onChange={(v) => set({ category: v })}
          />
        </label>

        <label className="field">
          <span>Item</span>
          <TextCell value={a.item} onCommit={(v) => set({ item: v })} />
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
              onBlur={commitCount}
            />
          </label>
          <label className="field">
            <span>Cost (per item)</span>
            <CurrencyCell value={a.cost} onCommit={(v) => set({ cost: v })} />
          </label>
          <label className="field">
            <span>Total</span>
            <input
              type="text"
              disabled
              readOnly
              value={a.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            />
          </label>
        </div>

        <label className="field">
          <span>Notes</span>
          <TextCell value={a.notes} onCommit={(v) => set({ notes: v })} />
        </label>

        <label className="field">
          <span>Receipt</span>
          {a.receipt_file_id ? (
            <div className="row" style={{ alignItems: "center" }}>
              <a href={a.receipt_web_view_link} target="_blank" rel="noreferrer">
                {a.receipt_file_name || "View receipt"}
              </a>
              <button type="button" className="link" onClick={removeReceipt}>
                Remove
              </button>
            </div>
          ) : (
            <button type="button" className="btn secondary" onClick={attachReceipt} disabled={attachingReceipt}>
              {attachingReceipt ? "Opening Google Drive…" : "Attach receipt"}
            </button>
          )}
          {error && <div className="error">{error}</div>}
        </label>

        <div className="modal-footer">
          <button
            className="link"
            onClick={() => {
              props.onDelete(a.id);
              props.onClose();
            }}
          >
            Delete asset
          </button>
          <button className="btn" onClick={props.onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
