import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Shared anchoring for a column-header filter popover: a portaled panel
 * positioned under whatever button opened it, closed on outside click or
 * scroll - same approach as DonorPicker's dropdown, factored out since two
 * filter variants (text checklist, date) both need identical positioning. */
function useAnchoredPopover(open: boolean, onClose: () => void) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(ev: MouseEvent) {
      const target = ev.target as Node;
      if (
        anchorRef.current &&
        !anchorRef.current.contains(target) &&
        !(target instanceof Element && target.closest(".column-filter-panel"))
      ) {
        onClose();
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const width = 240;
    const left = Math.min(rect.left, window.innerWidth - width - 12);
    setCoords({ top: rect.bottom + 4, left: Math.max(left, 8) });

    function onScroll() {
      onClose();
    }
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return { anchorRef, coords };
}

function FilterIcon({ active }: { active: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        marginLeft: 4,
        fontSize: 11,
        color: active ? "var(--primary)" : "var(--muted)",
        fontWeight: active ? 700 : 400,
      }}
    >
      ⏷
    </span>
  );
}

/** Excel-style "choose which values to show" filter for a text column -
 * every distinct value present in the column, with checkboxes. `null`
 * means no filter (show everything); an empty Set is never produced (the
 * "Clear filter" action resets straight to null instead). */
export function TextColumnFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: Set<string> | null;
  onChange: (next: Set<string> | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const { anchorRef, coords } = useAnchoredPopover(open, () => setOpen(false));
  const active = selected !== null;

  function toggle(value: string) {
    const base = selected ?? new Set(options);
    const next = new Set(base);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next.size === options.length ? null : next);
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="link"
        style={{ padding: 0 }}
        title={`Filter ${label}`}
        onClick={(ev) => {
          ev.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <FilterIcon active={active} />
      </button>
      {open &&
        createPortal(
          <div
            className="column-filter-panel card"
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              width: 240,
              maxHeight: 280,
              overflowY: "auto",
              zIndex: 60,
              padding: 10,
            }}
          >
            <div className="row" style={{ marginBottom: 6, gap: 8 }}>
              <button className="link" onClick={() => onChange(null)}>
                Select all
              </button>
              <button className="link" onClick={() => onChange(new Set())}>
                Clear
              </button>
            </div>
            {options.map((opt) => (
              <label
                key={opt}
                className="field-checkbox"
                style={{ display: "flex", fontSize: 13, marginBottom: 2 }}
              >
                <input
                  type="checkbox"
                  checked={selected === null || selected.has(opt)}
                  onChange={() => toggle(opt)}
                />
                <span>{opt || "(blank)"}</span>
              </label>
            ))}
            {options.length === 0 && <p className="subtitle">No values.</p>}
          </div>,
          document.body
        )}
    </>
  );
}

export type DateFilterMode = "date" | "range" | "month";

export interface DateFilterValue {
  mode: DateFilterMode;
  date?: string;
  from?: string;
  to?: string;
  month?: string;
}

export function dateMatchesFilter(value: string | null, filter: DateFilterValue | null): boolean {
  if (!filter) return true;
  if (!value) return false;
  if (filter.mode === "date") return !filter.date || value === filter.date;
  if (filter.mode === "month") return !filter.month || value.slice(0, 7) === filter.month;
  // range - an unset bound means "no limit" on that side
  if (filter.from && value < filter.from) return false;
  if (filter.to && value > filter.to) return false;
  return true;
}

/** Date column filter - exact date, a from/to range, or a whole month
 * (picked from the months actually present in the data). */
export function DateColumnFilter({
  label,
  monthOptions,
  value,
  onChange,
}: {
  label: string;
  monthOptions: string[];
  value: DateFilterValue | null;
  onChange: (next: DateFilterValue | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const { anchorRef, coords } = useAnchoredPopover(open, () => setOpen(false));
  const mode = value?.mode ?? "range";

  function setMode(nextMode: DateFilterMode) {
    onChange({ mode: nextMode });
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="link"
        style={{ padding: 0 }}
        title={`Filter ${label}`}
        onClick={(ev) => {
          ev.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <FilterIcon active={value !== null} />
      </button>
      {open &&
        createPortal(
          <div
            className="column-filter-panel card"
            style={{ position: "fixed", top: coords.top, left: coords.left, width: 240, zIndex: 60, padding: 10 }}
          >
            <div className="row" style={{ marginBottom: 8, gap: 6, flexWrap: "wrap" }}>
              {(["date", "range", "month"] as DateFilterMode[]).map((m) => (
                <button
                  key={m}
                  className={"btn" + (mode === m ? "" : " secondary")}
                  style={{ padding: "4px 10px", fontSize: 12 }}
                  onClick={() => setMode(m)}
                >
                  {m === "date" ? "Exact date" : m === "range" ? "Range" : "Month"}
                </button>
              ))}
            </div>

            {mode === "date" && (
              <label className="field">
                <span>Date</span>
                <input
                  type="date"
                  value={value?.date ?? ""}
                  onChange={(ev) => onChange({ mode: "date", date: ev.target.value })}
                />
              </label>
            )}

            {mode === "range" && (
              <>
                <label className="field" style={{ marginBottom: 6 }}>
                  <span>From</span>
                  <input
                    type="date"
                    value={value?.from ?? ""}
                    onChange={(ev) => onChange({ mode: "range", from: ev.target.value, to: value?.to })}
                  />
                </label>
                <label className="field">
                  <span>To</span>
                  <input
                    type="date"
                    value={value?.to ?? ""}
                    onChange={(ev) => onChange({ mode: "range", from: value?.from, to: ev.target.value })}
                  />
                </label>
              </>
            )}

            {mode === "month" && (
              <label className="field">
                <span>Month</span>
                <select
                  value={value?.month ?? ""}
                  onChange={(ev) => onChange({ mode: "month", month: ev.target.value })}
                >
                  <option value="">— choose —</option>
                  {monthOptions.map((m) => (
                    <option key={m} value={m}>
                      {new Date(`${m}-01T00:00:00`).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "long",
                      })}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <button className="link" style={{ marginTop: 8 }} onClick={() => onChange(null)}>
              Clear filter
            </button>
          </div>,
          document.body
        )}
    </>
  );
}
