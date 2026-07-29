import { ChartAccount } from "../../api/accounts";
import AccountPicker from "./AccountPicker";

/** Multi-select Chart-of-Accounts picker: an AccountPicker for adding one
 * account at a time, rendered as removable chips - built for the
 * Reimbursements assignment editor ("which accounts can this person submit
 * against"), the first place in the app that needed more than one account
 * selected at once. Reuses AccountPicker's search/keyboard logic rather
 * than forking it, since a single-select-then-add UX is simpler to build
 * and reason about than a fully multi-select autocomplete. */
export default function MultiAccountPicker(props: {
  value: string[];
  accounts: ChartAccount[];
  onChange: (accountNos: string[]) => void;
}) {
  const selected = props.accounts.filter((a) => props.value.includes(a.account_no));
  const remaining = props.accounts.filter((a) => !props.value.includes(a.account_no));

  function add(accountNo: string) {
    if (!accountNo || props.value.includes(accountNo)) return;
    props.onChange([...props.value, accountNo]);
  }

  function remove(accountNo: string) {
    props.onChange(props.value.filter((a) => a !== accountNo));
  }

  function selectAll() {
    props.onChange(props.accounts.map((a) => a.account_no));
  }

  function clearAll() {
    props.onChange([]);
  }

  return (
    <div>
      <div className="row" style={{ gap: 10, alignItems: "center" }}>
        <div style={{ flex: 1 }}>
          <AccountPicker
            value=""
            accounts={remaining}
            onChange={add}
            placeholder="Search to add a Chart of Accounts…"
          />
        </div>
        <button type="button" className="btn secondary" onClick={selectAll}>
          Select all
        </button>
        <button type="button" className="btn secondary" onClick={clearAll}>
          Clear
        </button>
      </div>
      <div className="chip-strip" style={{ marginTop: 10 }}>
        {selected.map((a) => (
          <span key={a.account_no} className="chip active">
            {a.account_no} · {a.statement_description}
            <button
              type="button"
              className="link"
              style={{ marginLeft: 4 }}
              onClick={() => remove(a.account_no)}
            >
              ×
            </button>
          </span>
        ))}
        {selected.length === 0 && <span className="subtitle">No accounts assigned yet.</span>}
      </div>
    </div>
  );
}
