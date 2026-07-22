import { useEffect, useMemo, useState } from "react";
import { ledgerApi } from "../../api/ledger";
import { reconcileApi, ReconRun } from "../../api/reconcile";
import { Rule } from "../../api/rules";
import { ColGroup, ColResizeHandle, useColumnWidths } from "../../components/ColumnResize";

export default function Step4Validate(props: {
  run: ReconRun;
  bankAccountId: number | "";
  rulesAdded: Rule[];
  onImported: (result: { imported: number; skipped_duplicates: number }) => void;
}) {
  const run = props.run;
  const [duplicateCount, setDuplicateCount] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped_duplicates: number } | null>(
    null
  );
  const { widths, startResize } = useColumnWidths("upload-step4-rules-added");

  useEffect(() => {
    reconcileApi
      .duplicateCheck(run.id)
      .then((r) => setDuplicateCount(r.count))
      .catch((e) => setError((e as Error).message));
  }, [run.id]);

  const totals = useMemo(() => {
    // Every "stripe" line (donation, adjustment, or unmatched-payout
    // placeholder) traces back to a single positive Stripe deposit on the
    // bank statement - it's all income, even if an individual adjustment
    // line happens to be negative (a fee/timing correction). Only "bank"
    // lines are split by their own sign, since those can be either.
    const income = round2(
      run.lines
        .filter((l) => l.source === "stripe" || l.amount > 0)
        .reduce((s, l) => s + l.amount, 0)
    );
    const expense = round2(
      run.lines
        .filter((l) => l.source === "bank" && l.amount < 0)
        .reduce((s, l) => s + l.amount, 0)
    );
    return {
      income,
      expense,
      incomeOk: income === round2(run.raw_bank_income_total),
      expenseOk: expense === round2(run.raw_bank_expense_total),
    };
  }, [run]);

  async function confirmImport() {
    if (!props.bankAccountId) return;
    setImporting(true);
    setError("");
    try {
      const r = await ledgerApi.importRun(run.id, props.bankAccountId);
      setResult(r);
      props.onImported(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Totals check</h3>
        <p className="subtitle">
          Confirms the reconciled lines add up to the same income and expense as the raw
          bank file - a sanity check that nothing got lost or double-counted.
        </p>
        <div className="stats">
          <div className="stat">
            <b style={{ color: totals.incomeOk ? "var(--green)" : "var(--red)" }}>
              {totals.incomeOk ? "✓" : "✗"} ${totals.income.toFixed(2)}
            </b>
            <span>Income (raw: ${run.raw_bank_income_total.toFixed(2)})</span>
          </div>
          <div className="stat">
            <b style={{ color: totals.expenseOk ? "var(--green)" : "var(--red)" }}>
              {totals.expenseOk ? "✓" : "✗"} ${totals.expense.toFixed(2)}
            </b>
            <span>Expense (raw: ${run.raw_bank_expense_total.toFixed(2)})</span>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Rules added this session</h3>
        {props.rulesAdded.length === 0 ? (
          <p className="subtitle">No new rules were added during this upload.</p>
        ) : (
          <table className="resizable-cols">
            <ColGroup columns={["type", "match", "account"]} widths={widths} />
            <thead>
              <tr>
                <th>
                  Type
                  <ColResizeHandle col="type" startResize={startResize} />
                </th>
                <th>
                  Match
                  <ColResizeHandle col="match" startResize={startResize} />
                </th>
                <th>
                  Account
                  <ColResizeHandle col="account" startResize={startResize} />
                </th>
              </tr>
            </thead>
            <tbody>
              {props.rulesAdded.map((r) => (
                <tr key={r.id}>
                  <td>{r.rule_type === "bank_keyword" ? "Bank keyword" : "Stripe fund"}</td>
                  <td>{r.pattern}</td>
                  <td>{r.account_no}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Already in Actual?</h3>
        {duplicateCount === null ? (
          <p className="subtitle">Checking…</p>
        ) : duplicateCount === 0 ? (
          <p className="ok">✓ None of these lines already exist in Actual.</p>
        ) : (
          <p className="subtitle">
            {duplicateCount} line{duplicateCount === 1 ? "" : "s"} already exist in Actual
            (same date/amount/reference) and will be skipped automatically - this is expected
            if this statement overlaps one you've already imported.
          </p>
        )}
      </div>

      <div className="card">
        {result ? (
          <p className="ok">
            ✓ Added {result.imported} line{result.imported === 1 ? "" : "s"} to Actual
            {result.skipped_duplicates ? ` (${result.skipped_duplicates} already there, skipped).` : "."}
          </p>
        ) : (
          <button className="btn" onClick={confirmImport} disabled={!props.bankAccountId || importing}>
            {importing ? "Processing…" : "Process"}
          </button>
        )}
        {error && (
          <div
            className="error"
            style={{
              marginTop: 12,
              padding: "10px 12px",
              background: "rgba(220, 38, 38, 0.08)",
              border: "1px solid var(--red)",
              borderRadius: 6,
              fontWeight: 600,
            }}
          >
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
