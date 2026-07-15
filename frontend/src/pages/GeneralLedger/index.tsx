import { useEffect, useState } from "react";
import { generalLedgerApi, GeneralLedgerLine } from "../../api/generalLedger";

const SOURCE_LABEL: Record<GeneralLedgerLine["source"], string> = {
  reconciliation: "Actual",
  accrual: "Accrual",
  budget: "Budget",
};

const SOURCE_CLASS: Record<GeneralLedgerLine["source"], string> = {
  reconciliation: "pill bank",
  accrual: "pill stripe",
  budget: "pill warn",
};

/** Read-only union of every Reconciliation + Accrual + Budget line - the
 * single source financial reports should read from. Edit the underlying
 * entry on its own tab; nothing here is editable. */
export default function GeneralLedger() {
  const [lines, setLines] = useState<GeneralLedgerLine[]>([]);
  const [year, setYear] = useState<number | "">("");
  const [sourceFilter, setSourceFilter] = useState<string>("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    generalLedgerApi
      .list(year === "" ? undefined : year)
      .then(setLines)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [year]);

  const visible = sourceFilter ? lines.filter((l) => l.source === sourceFilter) : lines;
  const total = visible.reduce((sum, l) => sum + l.amount, 0);

  return (
    <div>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Every Actual, Accrual, and Budget line in one place - the
        base every financial report is built from. Read-only: click into the
        Actual, Accrual, or Budget tab to edit a line.
      </p>
      <div className="toolbar">
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <span>Year:</span>
          <input
            type="number"
            style={{ width: 90 }}
            value={year}
            onChange={(e) => setYear(e.target.value ? Number(e.target.value) : "")}
            placeholder="All"
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <span>Source:</span>
          <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
            <option value="">All</option>
            <option value="reconciliation">Actual</option>
            <option value="accrual">Accrual</option>
            <option value="budget">Budget</option>
          </select>
        </label>
        <span className="pill">
          {visible.length} lines · ${total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </span>
      </div>
      {error && <div className="error">{error}</div>}

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th>Date</th>
                <th>Description</th>
                <th>Statement Description</th>
                <th>Bank Account</th>
                <th>Method</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {!loading &&
                visible.map((l) => (
                  <tr key={`${l.source}-${l.id}`}>
                    <td>
                      <span className={SOURCE_CLASS[l.source]}>{SOURCE_LABEL[l.source]}</span>
                    </td>
                    <td>{l.transaction_date || "—"}</td>
                    <td>{l.description || "—"}</td>
                    <td>{l.statement_description || "— uncategorized —"}</td>
                    <td>{l.bank_account_name || "—"}</td>
                    <td>{l.method || "—"}</td>
                    <td className="num">${l.amount.toFixed(2)}</td>
                  </tr>
                ))}
              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ color: "var(--muted)" }}>
                    No lines match this filter.
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
