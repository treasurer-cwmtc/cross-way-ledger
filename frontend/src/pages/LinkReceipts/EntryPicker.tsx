import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LinkableEntry } from "./types";

function labelFor(e: LinkableEntry): string {
  const name = e.check_invoice_name || e.description || "(no description)";
  const ledger = e.source === "reconciliation" ? "Actual" : "Accrual";
  return `${name} · $${e.amount.toFixed(2)} · ${e.transaction_date || "no date"} · ${ledger}`;
}

/** Type-to-filter picker over the combined Actual+Accrual entry list, same
 * portal/filter pattern as ledger/AccountPicker - used to manually match a
 * picked Drive file to a ledger entry when auto-matching by Check/Invoice
 * Name didn't find exactly one candidate. */
export default function EntryPicker(props: {
  value: string | null; // `${source}:${id}`
  entries: LinkableEntry[];
  onChange: (key: string | null) => void;
}) {
  const selected = props.entries.find((e) => `${e.source}:${e.id}` === props.value) || null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocMouseDown(ev: MouseEvent) {
      const target = ev.target as Node;
      if (
        boxRef.current &&
        !boxRef.current.contains(target) &&
        !(target instanceof Element && target.closest(".autocomplete-list"))
      ) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  useLayoutEffect(() => {
    if (!open || !boxRef.current) return;
    const rect = boxRef.current.getBoundingClientRect();
    const width = Math.max(rect.width, 420);
    const left = Math.min(rect.left, window.innerWidth - width - 12);
    setCoords({ top: rect.bottom + 4, left: Math.max(left, 8), width });

    function onScroll(ev: Event) {
      // Scrolling the dropdown's own (portaled) list fires a capture-phase
      // scroll event on this same listener - only close for scrolls
      // elsewhere on the page, not for scrolling within the list itself.
      const target = ev.target as Node;
      if (target instanceof Element && target.closest(".autocomplete-list")) return;
      setOpen(false);
      setQuery("");
    }
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = !q
      ? props.entries
      : props.entries.filter(
          (e) =>
            e.check_invoice_name.toLowerCase().includes(q) ||
            e.description.toLowerCase().includes(q) ||
            String(e.amount).includes(q)
        );
    return pool.slice(0, 50);
  }, [props.entries, query]);

  function choose(key: string | null) {
    props.onChange(key);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(ev: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (ev.key === "ArrowDown" || ev.key === "Enter") {
        ev.preventDefault();
        setOpen(true);
        setHighlight(0);
      }
      return;
    }
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      setHighlight((h) => Math.min(h + 1, matches.length));
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      if (highlight === 0) choose(null);
      else {
        const e = matches[highlight - 1];
        if (e) choose(`${e.source}:${e.id}`);
      }
    } else if (ev.key === "Escape") {
      ev.stopPropagation();
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div ref={boxRef} className="autocomplete">
      <input
        type="text"
        placeholder="— no match selected —"
        value={open ? query : selected ? labelFor(selected) : ""}
        title={!open && selected ? labelFor(selected) : undefined}
        onFocus={() => {
          setOpen(true);
          setQuery("");
          setHighlight(0);
        }}
        onChange={(ev) => {
          setQuery(ev.target.value);
          setHighlight(0);
          if (!open) setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {open &&
        createPortal(
          <div
            className="autocomplete-list"
            style={{ position: "fixed", top: coords.top, left: coords.left, width: coords.width }}
          >
            <div
              className={"autocomplete-option" + (highlight === 0 ? " active" : "")}
              onMouseDown={(ev) => {
                ev.preventDefault();
                choose(null);
              }}
              onMouseEnter={() => setHighlight(0)}
            >
              — no match —
            </div>
            {matches.map((e, i) => (
              <div
                key={`${e.source}:${e.id}`}
                className={"autocomplete-option" + (highlight === i + 1 ? " active" : "")}
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  choose(`${e.source}:${e.id}`);
                }}
                onMouseEnter={() => setHighlight(i + 1)}
              >
                {labelFor(e)}
                {e.receipt_file_id && (
                  <span style={{ color: "var(--amber)" }}> · already has a receipt</span>
                )}
              </div>
            ))}
            {matches.length === 0 && <div className="autocomplete-empty">No matches</div>}
          </div>,
          document.body
        )}
    </div>
  );
}
