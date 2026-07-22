import { ChartAccount } from "../../api/accounts";

/** A plain, clickable row - the full-detail view (all fields, editable
 * except account_no and the hierarchy) lives in AccountDetailModal, opened
 * by the parent on click. */
export default function AccountRow(props: { account: ChartAccount; onClick: () => void }) {
  const a = props.account;
  return (
    <tr onClick={props.onClick} style={{ cursor: "pointer" }}>
      <td>{a.account_no}</td>
      <td>{a.category}</td>
      <td>{a.statement_description}</td>
      <td>{a.is_tax_deductible}</td>
      <td>{a.is_mandatory}</td>
    </tr>
  );
}
