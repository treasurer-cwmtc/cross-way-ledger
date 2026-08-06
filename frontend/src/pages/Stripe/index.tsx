import { useEffect, useMemo, useState } from "react";
import { stripeApi, StripeTransaction } from "../../api/stripe";
import { TextColumnFilter } from "../../components/ColumnFilter";
import { ColGroup, ColResizeHandle, useColumnWidths } from "../../components/ColumnResize";
import StripeDetailModal from "./StripeDetailModal";

type SortKey = "created" | "type" | "description" | "donor" | "fund" | "amount";

// "M/D/YYYY" (no leading zeros) is the format both the CSV upload and the
// API sync produce (see backend/app/services/stripe_sync.py's _iso_date) -
// sorts wrong as a plain string ("12/1/2025" < "8/6/2026" lexically), so
// every date-aware comparison here goes through this instead.
function parseMDY(value: string): number {
  const [m, d, y] = value.split("/").map(Number);
  if (!m || !d || !y) return 0;
  return new Date(y, m - 1, d).getTime();
}

function fmtRelative(iso: string | null, nowMs: number): string {
  if (!iso) return "Never";
  const then = new Date(iso).getTime();
  const minutes = Math.floor((nowMs - then) / (1000 * 60));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
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

/** Staged Stripe transactions pulled automatically via the Stripe API (Sync
 * now, or the nightly scheduled job) - the automated counterpart to the
 * Upload wizard's old manual Stripe CSV upload. The wizard's merge-stripe
 * step reads from this same data; nothing here touches the ledger by
 * itself. Sortable/filterable/click-for-detail, same as every other ledger
 * table in the app. */
export default function StripePage() {
  const [transactions, setTransactions] = useState<StripeTransaction[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [sort, setSort] = useState<{ key: SortKey | null; dir: "asc" | "desc" }>({
    key: "created",
    dir: "desc",
  });
  const [typeFilter, setTypeFilter] = useState<Set<string> | null>(null);
  const [dateFilter, setDateFilter] = useState<Set<string> | null>(null);
  const [donorFilter, setDonorFilter] = useState<Set<string> | null>(null);
  const [fundFilter, setFundFilter] = useState<Set<string> | null>(null);

  const { widths, startResize } = useColumnWidths("stripe-list");

  // Keeps "Last refreshed" advancing (Just now -> N minutes ago -> ...)
  // without needing a page reload.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  async function load() {
    setLoading(true);
    try {
      const result = await stripeApi.list();
      setTransactions(result.transactions);
      setLastSyncedAt(result.last_synced_at);
      setDays(result.default_lookback_days);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function syncNow() {
    setSyncing(true);
    setError("");
    setSyncMessage("");
    try {
      const result = await stripeApi.syncNow(days);
      setSyncMessage(
        `Synced ${result.fetched} transaction${result.fetched === 1 ? "" : "s"} ` +
          `(${result.added} new, ${result.updated} updated).`
      );
      setNow(Date.now());
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  function onSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }
    );
  }

  function sortValue(t: StripeTransaction, key: SortKey): string | number {
    switch (key) {
      case "created":
        return parseMDY(t.created);
      case "type":
        return t.type;
      case "description":
        return t.description;
      case "donor":
        return t.donor;
      case "fund":
        return t.fund;
      case "amount":
        return t.amount;
    }
  }

  const typeOptions = useMemo(
    () => Array.from(new Set(transactions.map((t) => t.type || "—"))).sort(),
    [transactions]
  );
  const dateOptions = useMemo(
    () =>
      Array.from(new Set(transactions.map((t) => t.created || "—"))).sort(
        (a, b) => parseMDY(a) - parseMDY(b)
      ),
    [transactions]
  );
  const donorOptions = useMemo(
    () => Array.from(new Set(transactions.map((t) => t.donor || "—"))).sort(),
    [transactions]
  );
  const fundOptions = useMemo(
    () => Array.from(new Set(transactions.map((t) => t.fund || "—"))).sort(),
    [transactions]
  );

  const visible = useMemo(() => {
    let out = transactions.filter((t) => {
      if (typeFilter && !typeFilter.has(t.type || "—")) return false;
      if (dateFilter && !dateFilter.has(t.created || "—")) return false;
      if (donorFilter && !donorFilter.has(t.donor || "—")) return false;
      if (fundFilter && !fundFilter.has(t.fund || "—")) return false;
      return true;
    });
    if (sort.key) {
      const key = sort.key;
      out = [...out].sort((a, b) => {
        const av = sortValue(a, key);
        const bv = sortValue(b, key);
        const res =
          typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
        return sort.dir === "asc" ? res : -res;
      });
    }
    return out;
  }, [transactions, typeFilter, dateFilter, donorFilter, fundFilter, sort]);

  const openEntry = openId ? transactions.find((t) => t.stripe_id === openId) || null : null;

  return (
    <div>
      <h2 className="page-title">Stripe</h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Transactions pulled automatically from the Stripe API - the Upload
        wizard's Reconcile step matches this data against the bank statement,
        same as before, just without a manual Stripe CSV upload.
      </p>
      <div className="toolbar">
        <button className="btn" onClick={syncNow} disabled={syncing}>
          {syncing ? "Syncing…" : "Sync now"}
        </button>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <span>Days back:</span>
          <input
            type="number"
            min={1}
            max={3650}
            value={days}
            onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))}
            style={{ width: 70 }}
          />
        </label>
        <span className="pill" style={{ marginLeft: "auto" }}>
          Last refreshed: {fmtRelative(lastSyncedAt, now)}
        </span>
      </div>
      {syncMessage && (
        <p className="ok" style={{ margin: "0 0 12px" }}>
          {syncMessage}
        </p>
      )}
      {error && <div className="error">{error}</div>}

      <div className="card">
        <div className="table-wrap">
          <table className="resizable-cols">
            <ColGroup
              columns={["created", "type", "description", "donor", "fund", "amount"]}
              widths={widths}
            />
            <thead>
              <tr>
                <SortableHeader
                  label="Date"
                  sortKey="created"
                  activeSort={sort}
                  onSort={onSort}
                  filter={
                    <TextColumnFilter
                      label="Date"
                      options={dateOptions}
                      selected={dateFilter}
                      onChange={setDateFilter}
                    />
                  }
                  resizeHandle={<ColResizeHandle col="created" startResize={startResize} />}
                />
                <SortableHeader
                  label="Type"
                  sortKey="type"
                  activeSort={sort}
                  onSort={onSort}
                  filter={
                    <TextColumnFilter
                      label="Type"
                      options={typeOptions}
                      selected={typeFilter}
                      onChange={setTypeFilter}
                    />
                  }
                  resizeHandle={<ColResizeHandle col="type" startResize={startResize} />}
                />
                <SortableHeader
                  label="Description"
                  sortKey="description"
                  activeSort={sort}
                  onSort={onSort}
                  resizeHandle={<ColResizeHandle col="description" startResize={startResize} />}
                />
                <SortableHeader
                  label="Donor"
                  sortKey="donor"
                  activeSort={sort}
                  onSort={onSort}
                  filter={
                    <TextColumnFilter
                      label="Donor"
                      options={donorOptions}
                      selected={donorFilter}
                      onChange={setDonorFilter}
                    />
                  }
                  resizeHandle={<ColResizeHandle col="donor" startResize={startResize} />}
                />
                <SortableHeader
                  label="Fund"
                  sortKey="fund"
                  activeSort={sort}
                  onSort={onSort}
                  filter={
                    <TextColumnFilter
                      label="Fund"
                      options={fundOptions}
                      selected={fundFilter}
                      onChange={setFundFilter}
                    />
                  }
                  resizeHandle={<ColResizeHandle col="fund" startResize={startResize} />}
                />
                <SortableHeader
                  label="Amount"
                  sortKey="amount"
                  activeSort={sort}
                  onSort={onSort}
                  resizeHandle={<ColResizeHandle col="amount" startResize={startResize} />}
                />
              </tr>
            </thead>
            <tbody>
              {!loading &&
                visible.map((t) => (
                  <tr key={t.stripe_id} className="register-row" onClick={() => setOpenId(t.stripe_id)}>
                    <td style={{ whiteSpace: "nowrap" }}>{t.created || "—"}</td>
                    <td>{t.type || "—"}</td>
                    <td>{t.description || "—"}</td>
                    <td>{t.donor || "—"}</td>
                    <td>{t.fund || "—"}</td>
                    <td className="num" style={{ whiteSpace: "nowrap" }}>
                      {t.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ color: "var(--muted)" }}>
                    {transactions.length === 0
                      ? "No synced Stripe transactions yet - click Sync now."
                      : "No transactions match this filter."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {openEntry && <StripeDetailModal entry={openEntry} onClose={() => setOpenId(null)} />}
    </div>
  );
}
