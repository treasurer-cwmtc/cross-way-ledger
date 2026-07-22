import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface PledgeOption {
  pledgeId: number;
  label: string;
  email: string;
  pledgedAmount: number;
  matchedDonorId: string | null;
  jointGiverName: string;
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

/** Type-to-filter picker for linking a "gave without pledging" row to an
 * existing pledge - the reverse direction of DonorPicker (which links a
 * pledge to a donor). One-shot action, not an editable persisted value:
 * choosing an option fires onChange immediately and the caller closes/
 * refetches, same as DonorPicker's combobox shape otherwise. */
export default function PledgePicker({
  options,
  onChange,
}: {
  options: PledgeOption[];
  onChange: (pledgeId: number) => void;
}) {
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
    const width = Math.max(rect.width, 320);
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
      ? options
      : options.filter((o) => o.label.toLowerCase().includes(q) || o.email.toLowerCase().includes(q));
    return pool.slice(0, 50);
  }, [options, query]);

  function choose(pledgeId: number) {
    onChange(pledgeId);
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
      setHighlight((h) => Math.min(h + 1, matches.length - 1));
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      const m = matches[highlight];
      if (m) choose(m.pledgeId);
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
        placeholder="Search pledges by name or email…"
        value={query}
        onFocus={() => {
          setOpen(true);
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
            {matches.map((m, i) => (
              <div
                key={m.pledgeId}
                className={"autocomplete-option" + (highlight === i ? " active" : "")}
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  choose(m.pledgeId);
                }}
                onMouseEnter={() => setHighlight(i)}
              >
                {m.label} · {m.email} · {fmtMoney(m.pledgedAmount)} pledged
                {m.matchedDonorId && (
                  <span className="subtitle"> (currently matched to another donor)</span>
                )}
                {m.jointGiverName && <span className="subtitle"> · joint giver: {m.jointGiverName}</span>}
              </div>
            ))}
            {matches.length === 0 && <div className="autocomplete-empty">No matching pledges</div>}
          </div>,
          document.body
        )}
    </div>
  );
}
