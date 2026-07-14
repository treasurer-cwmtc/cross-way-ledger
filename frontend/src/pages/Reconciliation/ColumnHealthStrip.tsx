import { ColumnDef } from "./columns";

export default function ColumnHealthStrip(props: {
  columns: ColumnDef[];
  completeness: Map<string, { complete: boolean; missingCount: number }>;
  activeKey: string | null;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="chip-strip">
      {props.columns.map((col) => {
        const c = props.completeness.get(col.key);
        if (!c) return null;
        return (
          <button
            key={col.key}
            className={`chip ${props.activeKey === col.key ? "active" : ""}`}
            onClick={() => props.onToggle(col.key)}
            title={
              c.complete
                ? `Every row has ${col.label}.`
                : `${c.missingCount} row${c.missingCount === 1 ? "" : "s"} missing ${col.label} — click to filter.`
            }
          >
            <span className={`chip-dot ${c.complete ? "ok" : "bad"}`} />
            {col.label}
            {!c.complete && ` (${c.missingCount})`}
          </button>
        );
      })}
    </div>
  );
}
