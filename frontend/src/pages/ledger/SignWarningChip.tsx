import { LedgerEntry } from "./types";
import { hasSignWarning } from "./signWarning";

export default function SignWarningChip(props: {
  entries: LedgerEntry[];
  active: boolean;
  onToggle: () => void;
}) {
  const count = props.entries.filter(hasSignWarning).length;
  if (count === 0) return null;
  return (
    <div className="chip-strip">
      <button
        className={`chip ${props.active ? "active" : ""}`}
        onClick={props.onToggle}
        title={`${count} row${count === 1 ? "" : "s"} have an amount sign that looks backwards for their category (e.g. a positive amount on an Expense account) — click to review. This is a soft warning, not an error: a real vendor refund or donation chargeback can legitimately look like this.`}
      >
        <span className="chip-dot bad" />
        Unexpected sign for category ({count})
      </button>
    </div>
  );
}
