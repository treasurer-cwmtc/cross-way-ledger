import { ChartAccount } from "../../api/accounts";
import { ReconLine } from "../../api/reconcile";
import AccountPicker from "../ledger/AccountPicker";

/** One row of the wizard's preview table. Account/Category is editable
 * inline (the field most commonly corrected during import review); Amount
 * and Date stay popup-only to avoid fat-fingering dollar figures inline.
 * Clicking anywhere else on the row opens the full popup, mirroring the
 * Actual/Accrual click-to-open convention. */
export default function WizardLineRow(props: {
  line: ReconLine;
  accounts: ChartAccount[];
  onOpen: (line: ReconLine) => void;
  onUpdate: (id: number, patch: { account_no: string }) => void;
}) {
  const l = props.line;
  return (
    <tr className="register-row" onClick={() => props.onOpen(l)}>
      <td>{l.transaction_date}</td>
      <td>{l.bank_description || l.description || <span style={{ color: "var(--muted)" }}>—</span>}</td>
      <td className="num">{l.amount.toFixed(2)}</td>
      <td onClick={(e) => e.stopPropagation()} style={{ minWidth: 220 }}>
        <AccountPicker
          value={l.account_no}
          accounts={props.accounts}
          onChange={(v) => props.onUpdate(l.id, { account_no: v })}
        />
      </td>
      <td>
        {l.is_stripe_payout ? (
          <span className="pill stripe">Pending Stripe match</span>
        ) : l.matched ? (
          <span className="pill bank">✓ Categorized</span>
        ) : (
          <span className="pill warn">Uncategorized</span>
        )}
      </td>
    </tr>
  );
}
