import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ReimbursementAssignment } from "../../api/reimbursementPortal";

function labelFor(a: ReimbursementAssignment) {
  return `${a.account_no} · ${a.statement_description}`;
}

/** Type-to-filter picker over the submitter's own assigned Chart-of-Accounts
 * list - mirrors pages/ledger/AccountPicker.tsx's autocomplete pattern
 * (portaled dropdown, keyboard nav), since a plain <select> doesn't scale
 * once someone has more than a handful of accounts assigned. */
export default function AssignedAccountPicker(props: {
  value: string;
  accounts: ReimbursementAssignment[];
  onChange: (accountNo: string) => void;
}) {
  const selected = props.accounts.find((a) => a.account_no === props.value) || null;
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
      ? props.accounts
      : props.accounts.filter(
          (a) =>
            a.account_no.toLowerCase().includes(q) ||
            a.statement_description.toLowerCase().includes(q)
        );
    return pool.slice(0, 50);
  }, [props.accounts, query]);

  function choose(accountNo: string) {
    props.onChange(accountNo);
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
      const a = matches[highlight];
      if (a) choose(a.account_no);
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
        placeholder="Search your accounts…"
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
            {matches.map((a, i) => (
              <div
                key={a.account_no}
                className={"autocomplete-option" + (highlight === i ? " active" : "")}
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  choose(a.account_no);
                }}
                onMouseEnter={() => setHighlight(i)}
              >
                {labelFor(a)}
              </div>
            ))}
            {matches.length === 0 && <div className="autocomplete-empty">No matches</div>}
          </div>,
          document.body
        )}
    </div>
  );
}
