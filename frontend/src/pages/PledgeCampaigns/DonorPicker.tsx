import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Donor } from "../../api/donors";

function labelFor(d: Donor) {
  return `${d.first_name} ${d.last_name}`.trim() || d.donor_id;
}

/** Type-to-filter donor picker for manually linking a pledge to a donor -
 * same shape as the Chart of Accounts AccountPicker (filters as you type,
 * portaled dropdown so it isn't clipped by a scrollable table). Committed
 * value is always donor_id; empty clears the match back to unmatched. */
export default function DonorPicker(props: {
  value: string | null;
  donors: Donor[];
  onChange: (donorId: string | null) => void;
}) {
  const selected = props.donors.find((d) => d.donor_id === props.value) || null;
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
      ? props.donors
      : props.donors.filter(
          (d) =>
            labelFor(d).toLowerCase().includes(q) || (d.email && d.email.toLowerCase().includes(q))
        );
    return pool.slice(0, 50);
  }, [props.donors, query]);

  function choose(donorId: string | null) {
    props.onChange(donorId);
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
        const d = matches[highlight - 1];
        if (d) choose(d.donor_id);
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
        placeholder="— no gift yet —"
        value={open ? query : selected ? labelFor(selected) : ""}
        title={!open && selected ? `${labelFor(selected)} (${selected.email})` : undefined}
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
              — no gift yet —
            </div>
            {matches.map((d, i) => (
              <div
                key={d.donor_id}
                className={"autocomplete-option" + (highlight === i + 1 ? " active" : "")}
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  choose(d.donor_id);
                }}
                onMouseEnter={() => setHighlight(i + 1)}
              >
                {labelFor(d)} · {d.email}
                {d.joint_giver_id && (
                  <span className="subtitle">
                    {" "}
                    · joint giver: {`${d.joint_giver_first_name} ${d.joint_giver_last_name}`.trim() || d.joint_giver_id}
                  </span>
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
