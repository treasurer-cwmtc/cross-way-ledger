import { ChartAccount } from "../../api/accounts";
import { BankAccount } from "../../api/bankAccounts";
import { ReconciliationEntry, ReconciliationEntryUpdate } from "../../api/ledger";
import { COLUMNS, METHOD_OPTIONS } from "./columns";
import {
  AccountCell,
  BankAccountCell,
  CheckboxCell,
  CurrencyCell,
  DateCell,
  SelectCell,
  TextCell,
} from "./cells";

export default function EntryRow(props: {
  entry: ReconciliationEntry;
  accounts: ChartAccount[];
  bankAccounts: BankAccount[];
  onUpdate: (id: number, patch: ReconciliationEntryUpdate) => void;
  onDelete: (id: number) => void;
}) {
  const e = props.entry;
  const set = (patch: ReconciliationEntryUpdate) => props.onUpdate(e.id, patch);

  return (
    <tr>
      {COLUMNS.map((col) => (
        <td key={col.key}>{renderCell(col.key)}</td>
      ))}
      <td>
        <button className="link" onClick={() => props.onDelete(e.id)}>
          Delete
        </button>
      </td>
    </tr>
  );

  function renderCell(key: string) {
    switch (key) {
      case "reconciled":
        return <CheckboxCell value={e.reconciled} onChange={(v) => set({ reconciled: v })} />;
      case "is_reimbursement":
        return (
          <CheckboxCell
            value={e.is_reimbursement}
            onChange={(v) => set({ is_reimbursement: v })}
          />
        );
      case "transaction_date":
        return (
          <DateCell value={e.transaction_date} onChange={(v) => set({ transaction_date: v })} />
        );
      case "date_posted":
        return <DateCell value={e.date_posted} onChange={(v) => set({ date_posted: v })} />;
      case "statement_description":
        return (
          <AccountCell
            value={e.account_no}
            accounts={props.accounts}
            onChange={(v) => set({ account_no: v })}
          />
        );
      case "description":
        return <TextCell value={e.description} onCommit={(v) => set({ description: v })} />;
      case "bank_account":
        return (
          <BankAccountCell
            value={e.bank_account_id}
            bankAccounts={props.bankAccounts}
            onChange={(v) => set({ bank_account_id: v })}
          />
        );
      case "method":
        return (
          <SelectCell value={e.method} options={METHOD_OPTIONS} onChange={(v) => set({ method: v })} />
        );
      case "amount":
        return <CurrencyCell value={e.amount} onCommit={(v) => set({ amount: v })} />;
      case "check_invoice_name":
        return (
          <TextCell
            value={e.check_invoice_name}
            onCommit={(v) => set({ check_invoice_name: v })}
          />
        );
      case "bank_description":
        return (
          <TextCell value={e.bank_description} onCommit={(v) => set({ bank_description: v })} />
        );
      case "notes":
        return <TextCell value={e.notes} onCommit={(v) => set({ notes: v })} />;
      default: {
        const col = COLUMNS.find((c) => c.key === key);
        return <span style={{ color: "var(--muted)" }}>{col?.getDisplay?.(e) || ""}</span>;
      }
    }
  }
}
