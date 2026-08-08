import { useEffect, useMemo, useRef, useState } from "react";
import { Asset, AssetUpdate, assetsApi } from "../../api/assets";
import { TextColumnFilter } from "../../components/ColumnFilter";
import { ColGroup, ColResizeHandle, useColumnWidths } from "../../components/ColumnResize";
import QuickAddModal from "./QuickAddModal";
import DetailModal from "./DetailModal";

function fmtMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

type SortKey = "date" | "category" | "item" | "count" | "cost" | "total";

function sortValue(a: Asset, key: SortKey): string | number {
  switch (key) {
    case "date":
      return a.purchase_date || "";
    case "category":
      return a.category;
    case "item":
      return a.item;
    case "count":
      return a.count;
    case "cost":
      return a.cost;
    case "total":
      return a.total;
  }
}

function SortableHeader({
  label,
  sortKey,
  activeSort,
  onSort,
  filter,
  resizeHandle,
}: {
  label: string;
  sortKey: SortKey;
  activeSort: { key: SortKey | null; dir: "asc" | "desc" };
  onSort: (key: SortKey) => void;
  filter?: React.ReactNode;
  resizeHandle?: React.ReactNode;
}) {
  const active = activeSort.key === sortKey;
  return (
    <th>
      <span
        onClick={() => onSort(sortKey)}
        style={{ cursor: "pointer", userSelect: "none", display: "inline-flex", alignItems: "center", gap: 4 }}
      >
        {label}
        <span style={{ fontSize: 10, color: active ? "var(--primary)" : "var(--muted)" }}>
          {active ? (activeSort.dir === "asc" ? "▲" : "▼") : "⇅"}
        </span>
      </span>
      {filter}
      {resizeHandle}
    </th>
  );
}

const COLUMNS = ["date", "category", "item", "count", "cost", "total", "notes"];

/** A simple standalone equipment/inventory reference list - mirrors the
 * treasurer's existing "Equipment List" Google Sheet. Deliberately not
 * linked to Chart of Accounts / General Ledger - purchases are recorded
 * there separately when bought; this just tracks what's actually owned.
 * Same quick-add/click-to-detail/sortable/filterable pattern as every
 * other ledger page. See issue #113. */
export default function Assets() {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [openAssetId, setOpenAssetId] = useState<number | null>(null);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sort, setSort] = useState<{ key: SortKey | null; dir: "asc" | "desc" }>({
    key: "date",
    dir: "desc",
  });
  const [categoryFilter, setCategoryFilter] = useState<Set<string> | null>(null);
  const [itemFilter, setItemFilter] = useState<Set<string> | null>(null);
  const { widths, startResize } = useColumnWidths("assets");

  async function load() {
    try {
      const [a, c] = await Promise.all([assetsApi.list(), assetsApi.categories()]);
      setAssets(a);
      setCategories(c);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function onSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }
    );
  }

  const categoryOptions = useMemo(
    () => Array.from(new Set((assets ?? []).map((a) => a.category).filter(Boolean))).sort(),
    [assets]
  );
  const itemOptions = useMemo(
    () => Array.from(new Set((assets ?? []).map((a) => a.item).filter(Boolean))).sort(),
    [assets]
  );

  const visibleAssets = useMemo(() => {
    if (!assets) return [];
    let out = assets.filter((a) => {
      if (categoryFilter && !categoryFilter.has(a.category)) return false;
      if (itemFilter && !itemFilter.has(a.item)) return false;
      return true;
    });
    if (sort.key) {
      const key = sort.key;
      out = [...out].sort((a, b) => {
        const av = sortValue(a, key);
        const bv = sortValue(b, key);
        const res = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
        return sort.dir === "asc" ? res : -res;
      });
    }
    return out;
  }, [assets, sort, categoryFilter, itemFilter]);

  const grandTotal = useMemo(
    () => visibleAssets.reduce((sum, a) => sum + a.total, 0),
    [visibleAssets]
  );

  async function onUpdate(id: number, patch: AssetUpdate) {
    setAssets((prev) => (prev ? prev.map((a) => (a.id === id ? { ...a, ...patch } : a)) : prev));
    try {
      const updated = await assetsApi.update(id, patch);
      setAssets((prev) => (prev ? prev.map((a) => (a.id === id ? updated : a)) : prev));
      if (updated.category && !categories.includes(updated.category)) {
        setCategories((prev) => [...prev, updated.category].sort());
      }
    } catch (err) {
      setError((err as Error).message);
      await load();
    }
  }

  async function onDelete(id: number) {
    if (!confirm("Delete this asset?")) return;
    try {
      await assetsApi.delete(id);
      setAssets((prev) => (prev ? prev.filter((a) => a.id !== id) : prev));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportMsg("");
    setError("");
    try {
      const result = await assetsApi.importCsv(file);
      setImportMsg(
        `Imported ${result.imported} row${result.imported === 1 ? "" : "s"}` +
          (result.skipped ? ` (${result.skipped} skipped).` : ".")
      );
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  if (error && !assets) return <div className="error">{error}</div>;
  if (!assets) return <p className="subtitle">Loading…</p>;

  const openAsset = openAssetId ? assets.find((a) => a.id === openAssetId) || null : null;

  return (
    <div>
      <h2 className="page-title">Assets</h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        A simple equipment/inventory reference list - what the church actually owns, not part of
        financial reporting. Purchases are recorded separately in Actual/Accrual when bought.
      </p>
      <div className="toolbar">
        <button className="btn" onClick={() => setShowQuickAdd(true)}>
          + Quick add
        </button>
        <button
          className="btn secondary"
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
        >
          {importing ? "Importing…" : "Import CSV"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          style={{ display: "none" }}
          onChange={onImportFile}
        />
        {importMsg && <span className="ok">{importMsg}</span>}
      </div>
      {error && <div className="error">{error}</div>}

      <div className="card">
        <div className="table-wrap">
          <table className="resizable-cols">
            <ColGroup columns={COLUMNS} widths={widths} />
            <thead>
              <tr>
                <SortableHeader
                  label="Purchase Date"
                  sortKey="date"
                  activeSort={sort}
                  onSort={onSort}
                  resizeHandle={<ColResizeHandle col="date" startResize={startResize} defaultWidth={120} />}
                />
                <SortableHeader
                  label="Category"
                  sortKey="category"
                  activeSort={sort}
                  onSort={onSort}
                  filter={
                    <TextColumnFilter
                      label="Category"
                      options={categoryOptions}
                      selected={categoryFilter}
                      onChange={setCategoryFilter}
                    />
                  }
                  resizeHandle={<ColResizeHandle col="category" startResize={startResize} />}
                />
                <SortableHeader
                  label="Item"
                  sortKey="item"
                  activeSort={sort}
                  onSort={onSort}
                  filter={
                    <TextColumnFilter
                      label="Item"
                      options={itemOptions}
                      selected={itemFilter}
                      onChange={setItemFilter}
                    />
                  }
                  resizeHandle={<ColResizeHandle col="item" startResize={startResize} />}
                />
                <SortableHeader
                  label="Count"
                  sortKey="count"
                  activeSort={sort}
                  onSort={onSort}
                  resizeHandle={<ColResizeHandle col="count" startResize={startResize} defaultWidth={80} />}
                />
                <SortableHeader
                  label="Cost"
                  sortKey="cost"
                  activeSort={sort}
                  onSort={onSort}
                  resizeHandle={<ColResizeHandle col="cost" startResize={startResize} defaultWidth={110} />}
                />
                <SortableHeader
                  label="Total"
                  sortKey="total"
                  activeSort={sort}
                  onSort={onSort}
                  resizeHandle={<ColResizeHandle col="total" startResize={startResize} defaultWidth={110} />}
                />
                <th>
                  Notes
                  <ColResizeHandle col="notes" startResize={startResize} />
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleAssets.map((a) => (
                <tr key={a.id} onClick={() => setOpenAssetId(a.id)} style={{ cursor: "pointer" }}>
                  <td>{a.purchase_date || ""}</td>
                  <td>{a.category}</td>
                  <td>
                    {a.item}
                    {a.receipt_file_id && (
                      <span title="Has a receipt" style={{ marginLeft: 6, color: "var(--muted)" }}>
                        📎
                      </span>
                    )}
                  </td>
                  <td className="num">{a.count}</td>
                  <td className="num">{fmtMoney(a.cost)}</td>
                  <td className="num">{fmtMoney(a.total)}</td>
                  <td>{a.notes}</td>
                </tr>
              ))}
              {visibleAssets.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} style={{ color: "var(--muted)" }}>
                    {assets.length === 0
                      ? "No assets yet — click Quick Add to enter one, or Import CSV."
                      : "No rows match the current filters."}
                  </td>
                </tr>
              )}
            </tbody>
            {visibleAssets.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={5} style={{ textAlign: "right", fontWeight: 600 }}>
                    Grand total
                  </td>
                  <td className="num" style={{ fontWeight: 600 }}>
                    {fmtMoney(grandTotal)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {openAsset && (
        <DetailModal
          asset={openAsset}
          categories={categories}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onClose={() => setOpenAssetId(null)}
        />
      )}

      {showQuickAdd && (
        <QuickAddModal
          categories={categories}
          onCreated={(asset) => {
            setAssets((prev) => (prev ? [asset, ...prev] : [asset]));
            if (asset.category && !categories.includes(asset.category)) {
              setCategories((prev) => [...prev, asset.category].sort());
            }
          }}
          onClose={() => setShowQuickAdd(false)}
        />
      )}
    </div>
  );
}
