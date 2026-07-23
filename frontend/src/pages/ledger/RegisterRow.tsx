import { memo } from "react";
import { BankAccount } from "../../api/bankAccounts";
import { LedgerEntry, LedgerEntryUpdate } from "./types";

/** One compact, cheap-to-render register row (Quicken-style). No Chart of
 * Accounts <select> here on purpose - with 600+ rows, rendering a ~370-option
 * dropdown per row is what made the page take seconds to load. Full editing
 * (including the account picker) happens in the detail popup, which only
 * mounts one at a time. Memoized so editing one row doesn't re-render the
 * rest of the register. Shared by Reconciliation and Accrual. */
function RegisterRow(props: {
  entry: LedgerEntry;
  bankAccounts: BankAccount[];
  onUpdate: (id: number, patch: LedgerEntryUpdate) => void;
  onOpen: (id: number) => void;
  showBankDescription?: boolean;
  // Reconciliation's register needs the full Bank Description readable (the
  // raw bank line is often the only way to identify a transaction) rather
  // than truncated to a fixed width. Wraps onto multiple lines within a
  // wide-but-bounded cell instead of forcing the whole table to scroll
  // horizontally - the row just gets taller.
  wideBankDescription?: boolean;
  // Reconciliation shows Posted Date as its own leading column (in addition
  // to Transaction Date) - Accrual keeps just the one Date column, so this
  // is opt-in rather than always-on.
  showPostedDate?: boolean;
  hideMethod?: boolean;
  // Bank Account and File Name are still real fields (editable/viewable in
  // the detail popup), just not worth a dedicated register column for
  // Actual/Accrual - both are single-bank-account-at-a-time working ledgers
  // day to day, and the file name is an audit-trail detail, not something
  // scanned row to row.
  showBankAccount?: boolean;
  showFileName?: boolean;
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
      {props.showPostedDate && (
        <td style={{ whiteSpace: "nowrap" }}>{e.posted_date || "—"}</td>
      )}
      <td style={{ whiteSpace: "nowrap" }}>{e.transaction_date || "—"}</td>
      <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {e.split_parent_id != null && (
          <span title="Part of a split transaction" style={{ marginRight: 4 }}>
            ⑃
          </span>
        )}
        {e.description || <span style={{ color: "var(--muted)" }}>(no description)</span>}
      </td>
      <td style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {e.statement_description || (
          <span style={{ color: "var(--red)" }}>— uncategorized —</span>
        )}
      </td>
      {props.showBankDescription && (
        <td
          style={
            props.wideBankDescription
              ? { width: 420, whiteSpace: "normal", wordBreak: "break-word" }
              : { maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }
          }
        >
          {e.bank_description || <span style={{ color: "var(--muted)" }}>—</span>}
        </td>
      )}
      {props.showBankAccount && <td style={{ whiteSpace: "nowrap" }}>{bankAccountName || "—"}</td>}
      {!props.hideMethod && <td>{e.method || "—"}</td>}
      {props.showFileName && (
        <td
          style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          title={e.source_file_name}
        >
          {e.source_file_name ? (
            e.source_file_link ? (
              <a
                href={e.source_file_link}
                target="_blank"
                rel="noreferrer"
                onClick={(ev) => ev.stopPropagation()}
              >
                {e.source_file_name}
              </a>
            ) : (
              e.source_file_name
            )
          ) : (
            <span style={{ color: "var(--muted)" }}>—</span>
          )}
        </td>
      )}
      <td className="num" style={{ whiteSpace: "nowrap" }}>
        ${e.amount.toFixed(2)}
      </td>
    </tr>
  );
}

export default memo(RegisterRow);
