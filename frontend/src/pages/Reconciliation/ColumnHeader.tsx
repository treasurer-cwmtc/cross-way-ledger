export default function ColumnHeader(props: {
  label: string;
  complete: boolean;
  missingCount: number;
  active: boolean;
  onToggleFilter: () => void;
}) {
  return (
    <th
      className={`col-header ${props.active ? "filtering" : ""}`}
      onClick={props.onToggleFilter}
      title={
        props.complete
          ? `Every row has ${props.label}.`
          : `${props.missingCount} row${props.missingCount === 1 ? "" : "s"} missing ${props.label} — click to filter to just those.`
      }
    >
      <div>{props.label}</div>
      <div className={`col-health ${props.complete ? "ok" : "bad"}`} />
    </th>
  );
}
