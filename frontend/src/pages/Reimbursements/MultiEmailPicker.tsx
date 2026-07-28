import { PcoPerson } from "../../api/reimbursements";
import EmailPicker from "./EmailPicker";

/** Multi-select over the PCO People list, for batch-assigning the same set
 * of Chart-of-Accounts to several people at once - built the same way
 * MultiAccountPicker wraps AccountPicker: single-select-then-add, rendered
 * as removable chips. */
export default function MultiEmailPicker(props: {
  value: string[];
  people: PcoPerson[];
  onChange: (emails: string[]) => void;
}) {
  const byEmail = new Map<string, string>();
  for (const p of props.people) {
    if (p.email && !byEmail.has(p.email)) byEmail.set(p.email, p.name);
  }
  const remainingPeople = props.people.filter((p) => !props.value.includes(p.email));

  function add(email: string) {
    if (!email || props.value.includes(email)) return;
    props.onChange([...props.value, email]);
  }

  function remove(email: string) {
    props.onChange(props.value.filter((e) => e !== email));
  }

  return (
    <div>
      <EmailPicker value="" people={remainingPeople} onChange={add} />
      <div className="chip-strip" style={{ marginTop: 10 }}>
        {props.value.map((email) => (
          <span key={email} className="chip active">
            {byEmail.get(email) || email} ({email})
            <button
              type="button"
              className="link"
              style={{ marginLeft: 4 }}
              onClick={() => remove(email)}
            >
              ×
            </button>
          </span>
        ))}
        {props.value.length === 0 && <span className="subtitle">No one selected yet.</span>}
      </div>
    </div>
  );
}
