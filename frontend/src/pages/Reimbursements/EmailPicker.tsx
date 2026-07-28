import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PcoPerson } from "../../api/reimbursements";

interface EmailOption {
  email: string;
  name: string;
}

function labelFor(o: EmailOption) {
  return `${o.name} (${o.email})`;
}

/** Type-to-filter picker over the imported PCO People list, keyed by email -
 * mirrors pages/ledger/AccountPicker.tsx's autocomplete pattern (portaled
 * dropdown, keyboard nav) since the plain <select> this replaced doesn't
 * scale to a real congregation-sized list. A person's email may appear on
 * more than one PCO record (shared household emails) - deduped to one
 * option per email here, same as AssignmentsSection did inline before. */
export default function EmailPicker(props: {
  value: string;
  people: PcoPerson[];
  onChange: (email: string) => void;
}) {
  const options = useMemo(() => {
    const byEmail = new Map<string, string>();
    for (const p of props.people) {
      if (p.email && !byEmail.has(p.email)) byEmail.set(p.email, p.name);
    }
    return [...byEmail.entries()].map(([email, name]) => ({ email, name }));
  }, [props.people]);

  const selected = options.find((o) => o.email === props.value) || null;
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
    const width = Math.max(rect.width, 380);
    const left = Math.min(rect.left, window.innerWidth - width - 12);
    setCoords({ top: rect.bottom + 4, left: Math.max(left, 8), width });

    function onScroll(ev: Event) {
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
      : options.filter(
          (o) => o.name.toLowerCase().includes(q) || o.email.toLowerCase().includes(q)
        );
    return pool.slice(0, 50);
  }, [options, query]);

  function choose(email: string) {
    props.onChange(email);
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
      const o = matches[highlight];
      if (o) choose(o.email);
    } else if (ev.key === "Escape") {
      ev.stopPropagation();
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div ref={boxRef} className="autocomplete">
      <input
        type="search"
        placeholder="Search by name or email…"
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
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              width: coords.width,
            }}
          >
            {matches.map((o, i) => (
              <div
                key={o.email}
                className={"autocomplete-option" + (highlight === i ? " active" : "")}
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  choose(o.email);
                }}
                onMouseEnter={() => setHighlight(i)}
              >
                {labelFor(o)}
              </div>
            ))}
            {matches.length === 0 && <div className="autocomplete-empty">No matches</div>}
          </div>,
          document.body
        )}
    </div>
  );
}
