import { useEffect, useState } from "react";
import { stripeApi, StripeTransaction } from "../../api/stripe";
import { ColGroup, ColResizeHandle, useColumnWidths } from "../../components/ColumnResize";

function fmtRelative(iso: string | null): string {
  if (!iso) return "Never";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const minutes = Math.floor((now - then) / (1000 * 60));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** Staged Stripe transactions pulled automatically via the Stripe API (Sync
 * now, or the nightly scheduled job) - the automated counterpart to the
 * Upload wizard's old manual Stripe CSV upload. The wizard's merge-stripe
 * step reads from this same data; nothing here touches the ledger by
 * itself. */
export default function StripePage() {
  const [transactions, setTransactions] = useState<StripeTransaction[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const { widths, startResize } = useColumnWidths("stripe-list");

  async function load() {
    setLoading(true);
    try {
      const result = await stripeApi.list();
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

  async function syncNow() {
    setSyncing(true);
    setError("");
    setSyncMessage("");
    try {
      const result = await stripeApi.syncNow();
      setSyncMessage(
        `Synced ${result.fetched} transaction${result.fetched === 1 ? "" : "s"} ` +
          `(${result.added} new, ${result.updated} updated).`
      );
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSyncing(false);
    }
  }

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
        <span className="pill">Last refreshed: {fmtRelative(lastSyncedAt)}</span>
        {syncMessage && <span className="ok">{syncMessage}</span>}
      </div>
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
                <th>
                  Date
                  <ColResizeHandle col="created" startResize={startResize} />
                </th>
                <th>
                  Type
                  <ColResizeHandle col="type" startResize={startResize} />
                </th>
                <th>
                  Description
                  <ColResizeHandle col="description" startResize={startResize} />
                </th>
                <th>
                  Donor
                  <ColResizeHandle col="donor" startResize={startResize} />
                </th>
                <th>
                  Fund
                  <ColResizeHandle col="fund" startResize={startResize} />
                </th>
                <th className="num">
                  Amount
                  <ColResizeHandle col="amount" startResize={startResize} />
                </th>
              </tr>
            </thead>
            <tbody>
              {!loading &&
                transactions.map((t) => (
                  <tr key={t.stripe_id}>
                    <td>{t.created}</td>
                    <td>{t.type}</td>
                    <td>{t.description}</td>
                    <td>{t.donor}</td>
                    <td>{t.fund}</td>
                    <td className="num">
                      {t.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              {!loading && transactions.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ color: "var(--muted)" }}>
                    No synced Stripe transactions yet - click Sync now.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
