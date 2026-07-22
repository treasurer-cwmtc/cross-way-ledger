import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Shared anchoring for a column-header filter popover: a portaled panel
 * positioned under whatever button opened it, closed on outside click or
 * scroll - same approach as DonorPicker's dropdown, factored out since two
 * filter variants (text checklist, date) both need identical positioning.
 *
 * Dismissal listens on "click", not "mousedown" - "mousedown" fires before
 * the anchor button's own onClick, which is exactly the kind of ordering
 * that makes an opening click also look like an outside click to a
 * different listener depending on browser/input-device timing. "click"
 * bubbles through the same phase as the anchor's onClick, so its
 * ev.stopPropagation() reliably keeps the popover open when it's the
 * button itself being clicked. */
function useAnchoredPopover(open: boolean, onClose: () => void) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    function onDocClick(ev: MouseEvent) {
      const target = ev.target as Node;
      if (
        anchorRef.current &&
        !anchorRef.current.contains(target) &&
        !(target instanceof Element && target.closest(".column-filter-panel"))
      ) {
        onClose();
      }
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const width = 240;
    const left = Math.min(rect.left, window.innerWidth - width - 12);
    setCoords({ top: rect.bottom + 4, left: Math.max(left, 8) });

    function onScroll(ev: Event) {
      // Scrolling the popover's own (portaled) panel fires a capture-phase
      // scroll event on this same listener - only close for scrolls
      // elsewhere on the page, not for scrolling within the panel itself.
      const target = ev.target as Node;
      if (target instanceof Element && target.closest(".column-filter-panel")) return;
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
 * "Clear filter" action resets straight to null instead).
 *
 * Checkbox changes are staged locally and only take effect on "Apply" -
 * closing the popover any other way (Cancel, outside click, Escape)
 * discards them, so a stray click never silently changes what's shown. */
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
  const [draft, setDraft] = useState<Set<string> | null>(selected);
  const { anchorRef, coords } = useAnchoredPopover(open, () => setOpen(false));
  const active = selected !== null;

  function openPopover() {
    setDraft(selected);
    setOpen(true);
  }

  function toggle(value: string) {
    const base = draft ?? new Set(options);
    const next = new Set(base);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setDraft(next.size === options.length ? null : next);
  }

  function apply() {
    onChange(draft);
    setOpen(false);
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
          if (open) setOpen(false);
          else openPopover();
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
              maxHeight: 320,
              display: "flex",
              flexDirection: "column",
              zIndex: 60,
              padding: 10,
            }}
          >
            <div className="row" style={{ marginBottom: 6, gap: 8 }}>
              <button className="link" onClick={() => setDraft(null)}>
                Select all
              </button>
              <button className="link" onClick={() => setDraft(new Set())}>
                Clear
              </button>
            </div>
            <div style={{ overflowY: "auto", flex: 1 }}>
              {options.map((opt) => (
                <label
                  key={opt}
                  className="field-checkbox"
                  style={{ display: "flex", fontSize: 13, marginBottom: 2 }}
                >
                  <input
                    type="checkbox"
                    checked={draft === null || draft.has(opt)}
                    onChange={() => toggle(opt)}
                  />
                  <span>{opt || "(blank)"}</span>
                </label>
              ))}
              {options.length === 0 && <p className="subtitle">No values.</p>}
            </div>
            <div className="row" style={{ marginTop: 8, gap: 8, justifyContent: "flex-end" }}>
              <button className="btn secondary" style={{ padding: "5px 12px" }} onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className="btn" style={{ padding: "5px 12px" }} onClick={apply}>
                Apply
              </button>
            </div>
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
 * (picked from the months actually present in the data). Same stage-then-
 * Apply pattern as TextColumnFilter. */
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
  const [draft, setDraft] = useState<DateFilterValue | null>(value);
  const { anchorRef, coords } = useAnchoredPopover(open, () => setOpen(false));
  const mode = draft?.mode ?? "range";

  function openPopover() {
    setDraft(value);
    setOpen(true);
  }

  function apply() {
    onChange(draft);
    setOpen(false);
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
          if (open) setOpen(false);
          else openPopover();
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
                  onClick={() => setDraft({ mode: m })}
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
                  value={draft?.date ?? ""}
                  onChange={(ev) => setDraft({ mode: "date", date: ev.target.value })}
                />
              </label>
            )}

            {mode === "range" && (
              <>
                <label className="field" style={{ marginBottom: 6 }}>
                  <span>From</span>
                  <input
                    type="date"
                    value={draft?.from ?? ""}
                    onChange={(ev) => setDraft({ mode: "range", from: ev.target.value, to: draft?.to })}
                  />
                </label>
                <label className="field">
                  <span>To</span>
                  <input
                    type="date"
                    value={draft?.to ?? ""}
                    onChange={(ev) => setDraft({ mode: "range", from: draft?.from, to: ev.target.value })}
                  />
                </label>
              </>
            )}

            {mode === "month" && (
              <label className="field">
                <span>Month</span>
                <select
                  value={draft?.month ?? ""}
                  onChange={(ev) => setDraft({ mode: "month", month: ev.target.value })}
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

            <div className="row" style={{ marginTop: 10, gap: 8 }}>
              <button
                className="link"
                onClick={() => {
                  setDraft(null);
                }}
              >
                Clear filter
              </button>
            </div>
            <div className="row" style={{ marginTop: 8, gap: 8, justifyContent: "flex-end" }}>
              <button className="btn secondary" style={{ padding: "5px 12px" }} onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className="btn" style={{ padding: "5px 12px" }} onClick={apply}>
                Apply
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
