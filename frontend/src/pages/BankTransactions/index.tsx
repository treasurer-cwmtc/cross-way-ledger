import { useEffect, useMemo, useState } from "react";
import { plaidApi, PlaidItemSummary, PlaidTransaction } from "../../api/plaid";
import { openPlaidLink } from "../../lib/plaidLink";
import { TextColumnFilter } from "../../components/ColumnFilter";
import { ColGroup, ColResizeHandle, useColumnWidths } from "../../components/ColumnResize";
import PlaidDetailModal from "./PlaidDetailModal";

type SortKey = "posting_date" | "type" | "description" | "details" | "amount";

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

/** Staged Chase bank transactions pulled automatically via Plaid (Connect
 * bank + Sync now) - the automated counterpart to manually exporting a
 * Chase CSV and uploading it. Same staging-table pattern as pages/Stripe:
 * nothing here touches the ledger by itself. Currently sandbox-only while
 * we confirm real Plaid pricing (issue #103) before ever connecting a real
 * Chase account. */
export default function BankTransactions() {
  const [items, setItems] = useState<PlaidItemSummary[]>([]);
  const [transactions, setTransactions] = useState<PlaidTransaction[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [sort, setSort] = useState<{ key: SortKey | null; dir: "asc" | "desc" }>({
    key: "posting_date",
    dir: "desc",
  });
  const [typeFilter, setTypeFilter] = useState<Set<string> | null>(null);
  const [dateFilter, setDateFilter] = useState<Set<string> | null>(null);
  const [detailsFilter, setDetailsFilter] = useState<Set<string> | null>(null);

  const { widths, startResize } = useColumnWidths("bank-transactions-list");

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  async function load() {
    setLoading(true);
    try {
      const result = await plaidApi.list();
      setItems(result.items);
      setTransactions(result.transactions);
      setLastSyncedAt(result.last_synced_at);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function connectBank() {
    setConnecting(true);
    setError("");
    try {
      const { link_token } = await plaidApi.linkToken();
      const { publicToken, institutionName } = await openPlaidLink(link_token);
      await plaidApi.exchange(publicToken, institutionName);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect(itemDbId: number) {
    if (!confirm("Disconnect this bank account? This also removes it on Plaid's side.")) return;
    setError("");
    try {
      await plaidApi.disconnect(itemDbId);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function syncNow() {
    setSyncing(true);
    setError("");
    setSyncMessage("");
    try {
      const result = await plaidApi.syncNow();
      setSyncMessage(
        `Synced ${result.fetched} transaction${result.fetched === 1 ? "" : "s"} ` +
          `(${result.added} new, ${result.modified} updated, ${result.removed} removed).`
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

  function sortValue(t: PlaidTransaction, key: SortKey): string | number {
    switch (key) {
      case "posting_date":
        return parseMDY(t.posting_date);
      case "type":
        return t.type;
      case "description":
        return t.description;
      case "details":
        return t.details;
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
      Array.from(new Set(transactions.map((t) => t.posting_date || "—"))).sort(
        (a, b) => parseMDY(a) - parseMDY(b)
      ),
    [transactions]
  );
  const detailsOptions = useMemo(
    () => Array.from(new Set(transactions.map((t) => t.details || "—"))).sort(),
    [transactions]
  );

  const visible = useMemo(() => {
    let out = transactions.filter((t) => {
      if (typeFilter && !typeFilter.has(t.type || "—")) return false;
      if (dateFilter && !dateFilter.has(t.posting_date || "—")) return false;
      if (detailsFilter && !detailsFilter.has(t.details || "—")) return false;
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
  }, [transactions, typeFilter, dateFilter, detailsFilter, sort]);

  const openEntry = openId
    ? transactions.find((t) => t.plaid_transaction_id === openId) || null
    : null;

  return (
    <div>
      <h2 className="page-title">Bank Transactions</h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Chase transactions pulled automatically via Plaid - same columns as a manually-exported
        Chase CSV, so this can eventually feed the Upload wizard the same way. Sandbox only for
        now, while we confirm real Plaid pricing.
      </p>

      <div className="toolbar">
        <button className="btn" onClick={connectBank} disabled={connecting}>
          {connecting ? "Connecting…" : "Connect bank"}
        </button>
        <button className="btn secondary" onClick={syncNow} disabled={syncing || items.length === 0}>
          {syncing ? "Syncing…" : "Sync now"}
        </button>
        <span className="pill" style={{ marginLeft: "auto" }}>
          Last refreshed: {fmtRelative(lastSyncedAt, now)}
        </span>
      </div>

      {items.length > 0 && (
        <div className="toolbar" style={{ flexWrap: "wrap" }}>
          {items.map((it) => (
            <span key={it.id} className="pill">
              {it.institution_name || "Connected account"}
              <button
                className="link"
                style={{ marginLeft: 8, fontSize: 12 }}
                onClick={() => disconnect(it.id)}
              >
                Disconnect
              </button>
            </span>
          ))}
        </div>
      )}

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
              columns={["posting_date", "type", "description", "details", "amount"]}
              widths={widths}
            />
            <thead>
              <tr>
                <SortableHeader
                  label="Date"
                  sortKey="posting_date"
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
                  resizeHandle={<ColResizeHandle col="posting_date" startResize={startResize} />}
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
                  label="Details"
                  sortKey="details"
                  activeSort={sort}
                  onSort={onSort}
                  filter={
                    <TextColumnFilter
                      label="Details"
                      options={detailsOptions}
                      selected={detailsFilter}
                      onChange={setDetailsFilter}
                    />
                  }
                  resizeHandle={<ColResizeHandle col="details" startResize={startResize} />}
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
                  <tr
                    key={t.plaid_transaction_id}
                    className="register-row"
                    onClick={() => setOpenId(t.plaid_transaction_id)}
                  >
                    <td style={{ whiteSpace: "nowrap" }}>
                      {t.posting_date || "—"}
                      {t.pending && <span className="pill warn" style={{ marginLeft: 6 }}>Pending</span>}
                    </td>
                    <td>{t.type || "—"}</td>
                    <td>{t.description || "—"}</td>
                    <td>{t.details || "—"}</td>
                    <td className="num" style={{ whiteSpace: "nowrap" }}>
                      {t.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ color: "var(--muted)" }}>
                    {items.length === 0
                      ? "No bank account connected yet - click Connect bank."
                      : transactions.length === 0
                        ? "No synced transactions yet - click Sync now."
                        : "No transactions match this filter."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {openEntry && <PlaidDetailModal entry={openEntry} onClose={() => setOpenId(null)} />}
    </div>
  );
}
