/** Free-text category field with a typeahead of previously-used values -
 * the treasurer explicitly wanted free text over a fixed dropdown, but
 * still wants to see what's been used before while typing, so data stays
 * reasonably consistent without being locked to a fixed list. Plain
 * HTML5 <input list>/<datalist> - no extra dependency needed for this. */
export default function CategoryInput(props: {
  value: string;
  categories: string[];
  onChange: (v: string) => void;
  listId?: string;
}) {
  const listId = props.listId || "asset-categories";
  return (
    <>
      <input
        type="text"
        list={listId}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder="e.g. Audio, Kitchen, Computer…"
      />
      <datalist id={listId}>
        {props.categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </>
  );
}
