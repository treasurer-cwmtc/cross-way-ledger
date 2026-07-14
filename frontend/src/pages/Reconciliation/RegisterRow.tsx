import { memo } from "react";
import { BankAccount } from "../../api/bankAccounts";
import { ReconciliationEntry, ReconciliationEntryUpdate } from "../../api/ledger";

/** One compact, cheap-to-render register row (Quicken-style). No Chart of
 * Accounts <select> here on purpose - with 600+ rows, rendering a ~370-option
 * dropdown per row is what made the page take seconds to load. Full editing
 * (including the account picker) happens in the detail popup, which only
 * mounts one at a time. Memoized so editing one row doesn't re-render the
 * rest of the register. */
function RegisterRow(props: {
  entry: ReconciliationEntry;
  bankAccounts: BankAccount[];
  onUpdate: (id: number, patch: ReconciliationEntryUpdate) => void;
  onOpen: (id: number) => void;
}) {
  const e = props.entry;
  const bankAccountName =
    props.bankAccounts.find((b) => b.id === e.bank_account_id)?.name || e.bank_account_name;

  return (
    <tr className="register-row" onClick={() => props.onOpen(e.id)}>
      <td onClick={(ev) => ev.stopPropagation()}>
        <input
          type="checkbox"
          checked={e.reconciled}
          onChange={(ev) => props.onUpdate(e.id, { reconciled: ev.target.checked })}
        />
      </td>
      <td style={{ whiteSpace: "nowrap" }}>{e.transaction_date || "—"}</td>
      <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {e.description || <span style={{ color: "var(--muted)" }}>(no description)</span>}
      </td>
      <td style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {e.statement_description || (
          <span style={{ color: "var(--red)" }}>— uncategorized —</span>
        )}
      </td>
      <td style={{ whiteSpace: "nowrap" }}>{bankAccountName || "—"}</td>
      <td>{e.method || "—"}</td>
      <td className="num" style={{ whiteSpace: "nowrap" }}>
        ${e.amount.toFixed(2)}
      </td>
    </tr>
  );
}

export default memo(RegisterRow);
