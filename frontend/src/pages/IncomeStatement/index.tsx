import { Fragment, useEffect, useState } from "react";
import { incomeStatementApi, IncomeStatement as IncomeStatementData, IncomeStatementGroup, IncomeStatementRow } from "../../api/incomeStatement";

function fmt(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function Row(props: { row: IncomeStatementRow; bold?: boolean; indent?: boolean }) {
  const { row, bold, indent } = props;
  return (
    <tr>
      <td style={{ fontWeight: bold ? 700 : 400, paddingLeft: indent ? 24 : 8 }}>{row.label}</td>
      <td className="num">{fmt(row.plan)}</td>
      <td className="num">{fmt(row.actuals)}</td>
      <td className="num" style={{ color: row.variance < 0 ? "var(--red)" : "var(--green)" }}>
        {fmt(row.variance)}
      </td>
    </tr>
  );
}

function Section(props: { title: string; groups: IncomeStatementGroup[]; total: IncomeStatementRow }) {
  const showSubtotals = props.groups.length > 1;
  return (
    <>
      <tr>
        <td colSpan={4} style={{ fontWeight: 700, paddingTop: 16 }}>
          {props.title}
        </td>
      </tr>
      {props.groups.map((g) => (
        <Fragment key={g.statement_category}>
          {g.rows.map((r) => (
            <Row key={r.label} row={r} indent />
          ))}
          {showSubtotals && <Row row={g.subtotal} bold />}
        </Fragment>
      ))}
      <Row row={{ ...props.total, label: `${props.title} Total` }} bold />
    </>
  );
}

/** Plan vs Actuals vs Variance, grouped Statement Category -> Statement
 * Item - matches the legacy sheet's Income Statement tab. Reads Plan from
 * the Budget tab and Actuals from Reconciliation + Accrual (CY only, via
 * the /api/income-statement aggregation - not from the General Ledger view
 * directly, since this needs grouped sums rather than raw lines). */
export default function IncomeStatement() {
  const [data, setData] = useState<IncomeStatementData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    incomeStatementApi.get().then(setData).catch((err) => setError((err as Error).message));
  }, []);

  return (
    <div>
      <h2 className="page-title">Income Statement</h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Plan vs Actuals for {data ? data.year : "…"} (current year, per the
        Config tab). Plan comes from the Budget tab; Actuals from
        Actual and Accrual. Variance is shown favorable-positive:
        for Income, actual above plan is positive; for Expenditures, actual
        below plan is positive.
      </p>
      {error && <div className="error">{error}</div>}

      {data && (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th className="num">Plan</th>
                  <th className="num">Actuals</th>
                  <th className="num">Variance</th>
                </tr>
              </thead>
              <tbody>
                <Section title="Income" groups={data.income_groups} total={data.income_total} />
                <Section title="Expenditures" groups={data.expense_groups} total={data.expense_total} />
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
