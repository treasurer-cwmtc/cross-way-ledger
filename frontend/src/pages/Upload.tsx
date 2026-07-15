import { useEffect, useMemo, useState } from "react";
import { reconcileApi, ReconRun } from "../api/reconcile";
import { bankAccountsApi, BankAccount } from "../api/bankAccounts";
import { ledgerApi } from "../api/ledger";

type Filter = "all" | "stripe" | "bank" | "unmatched";

export default function Upload() {
  const [bankFile, setBankFile] = useState<File | null>(null);
  const [stripeFile, setStripeFile] = useState<File | null>(null);
  const [run, setRun] = useState<ReconRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [bankAccountId, setBankAccountId] = useState<number | "">("");
  const [newBankAccountName, setNewBankAccountName] = useState("");

  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const [importError, setImportError] = useState("");

  async function loadBankAccounts() {
    try {
      const list = await bankAccountsApi.list();
      setBankAccounts(list);
      if (list.length && !bankAccountId) setBankAccountId(list[0].id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    loadBankAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addBankAccount() {
    if (!newBankAccountName.trim()) return;
    try {
      const created = await bankAccountsApi.create(newBankAccountName);
      setNewBankAccountName("");
      await loadBankAccounts();
      setBankAccountId(created.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onRun() {
    if (!bankFile || !stripeFile) return;
    setBusy(true);
    setError("");
    setImportMsg("");
    setImportError("");
    try {
      setRun(await reconcileApi.reconcile(bankFile, stripeFile));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addToReconciliation() {
    if (!run || !bankAccountId) return;
    setImporting(true);
    setImportMsg("");
    setImportError("");
    try {
      const result = await ledgerApi.importRun(run.id, bankAccountId);
      setImportMsg(
        `Added ${result.imported} row${result.imported === 1 ? "" : "s"} to Actual` +
          (result.skipped_duplicates
            ? ` (${result.skipped_duplicates} already there, skipped).`
            : ".")
      );
    } catch (e) {
      setImportError((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  const lines = useMemo(() => {
    if (!run) return [];
    return run.lines.filter((l) => {
      if (filter === "all") return true;
      if (filter === "unmatched") return !l.matched;
      return l.source === filter;
    });
  }, [run, filter]);

  const total = useMemo(() => lines.reduce((s, l) => s + l.amount, 0), [lines]);

  return (
    <div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Bank account</h3>
        <p className="subtitle">
          Which account is this statement for? Every row from this run will be
          tagged with it when you push the results to Actual.
        </p>
        <div className="row">
          <label className="field">
            <span>Bank Account</span>
            <select
              value={bankAccountId}
              onChange={(e) => setBankAccountId(Number(e.target.value) || "")}
            >
              <option value="">Select…</option>
              {bankAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Add a new bank account</span>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="text"
                value={newBankAccountName}
                placeholder="e.g. Chase Savings"
                onChange={(e) => setNewBankAccountName(e.target.value)}
                style={{ flex: 1 }}
              />
              <button className="btn secondary" onClick={addBankAccount}>
                Add
              </button>
            </div>
          </label>
        </div>
      </div>

      <div className="card">
        <div className="row">
          <label className="field">
            <span>Bank statement CSV (Chase export)</span>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => setBankFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <label className="field">
            <span>Stripe transactions CSV</span>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => setStripeFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>
        <button
          className="btn"
          onClick={onRun}
          disabled={!bankFile || !stripeFile || busy}
        >
          {busy ? "Reconciling…" : "Reconcile"}
        </button>
        {error && <div className="error">{error}</div>}
      </div>

      {run && (
        <div className="card">
          <div className="stats">
            <div className="stat">
              <b>{run.matched_payout_count}</b>
              <span>Payouts matched</span>
            </div>
            <div className="stat">
              <b>{run.lines.length}</b>
              <span>Output lines</span>
            </div>
            <div className="stat">
              <b>{run.stripe_line_count}</b>
              <span>Stripe rows in</span>
            </div>
            <div className="stat">
              <b>{run.bank_line_count}</b>
              <span>Bank rows in</span>
            </div>
            <div className="stat">
              <b style={{ color: run.unmatched_stripe_bank_count ? "#dc2626" : undefined }}>
                {run.unmatched_stripe_bank_count}
              </b>
              <span>Unmatched Stripe</span>
            </div>
          </div>

          <div className="toolbar" style={{ marginTop: 16 }}>
            <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
              <option value="all">All lines</option>
              <option value="stripe">Stripe donations</option>
              <option value="bank">Bank transactions</option>
              <option value="unmatched">Needs attention</option>
            </select>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>
              {lines.length} lines · subtotal <b>${total.toFixed(2)}</b>
            </span>
            <a
              className="btn secondary"
              href={reconcileApi.exportUrl(run.id)}
              onClick={(e) => {
                e.preventDefault();
                reconcileApi.downloadExport(run.id).catch((err) =>
                  setError((err as Error).message)
                );
              }}
            >
              Download CSV
            </a>
            <button
              className="btn"
              onClick={addToReconciliation}
              disabled={importing || !bankAccountId}
              title={!bankAccountId ? "Pick a bank account above first" : ""}
            >
              {importing ? "Adding…" : "Add to Actual"}
            </button>
          </div>
          {importMsg && <div className="ok">{importMsg}</div>}
          {importError && <div className="error">{importError}</div>}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Txn Date</th>
                  <th>Posted</th>
                  <th>Description</th>
                  <th>Category</th>
                  <th>Account</th>
                  <th className="num">Amount</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <span className={`pill ${l.source}`}>{l.source}</span>
                    </td>
                    <td>{l.transaction_date}</td>
                    <td>{l.date_posted}</td>
                    <td>{l.description}</td>
                    <td>{l.statement_description || l.category}</td>
                    <td>{l.account_no}</td>
                    <td className="num">{l.amount.toFixed(2)}</td>
                    <td>{l.notes && <span className="pill warn">{l.notes}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
