import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChartAccount } from "../../api/accounts";

function labelFor(a: ChartAccount) {
  return `${a.account_no} · ${a.statement_description}`;
}

/** Type-to-filter Chart of Accounts picker. The account list is 350+ rows -
 * scanning a plain <select> for one by name is painfully slow, so this
 * filters by account_no or statement_description as you type. The
 * committed value is always account_no, the same contract the plain
 * <select>s it replaces used. Shared by the register detail popup, the
 * split popup, and Accrual's Quick Add. */
export default function AccountPicker(props: {
  value: string;
  accounts: ChartAccount[];
  onChange: (accountNo: string) => void;
  placeholder?: string;
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
      // The dropdown itself lives in a portal (outside boxRef), so it needs
      // its own exclusion or every click inside it would look "outside".
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

  // The dropdown is portaled to <body> (position: fixed) specifically so it
  // isn't clipped by a scrollable ancestor - e.g. the Upload wizard's table
  // rows sit inside a `.table-wrap` with overflow:auto, which would
  // otherwise cut the list off mid-way. Closing on scroll (rather than
  // continuously repositioning) keeps this simple.
  useLayoutEffect(() => {
    if (!open || !boxRef.current) return;
    const rect = boxRef.current.getBoundingClientRect();
    // At least as wide as the input, but never narrower than a readable
    // minimum - a table-cell input can be much narrower than the account
    // names it needs to display. Options also wrap (see .autocomplete-option
    // in styles.css) so nothing gets cut off even at this width.
    const width = Math.max(rect.width, 380);
    const left = Math.min(rect.left, window.innerWidth - width - 12);
    setCoords({ top: rect.bottom + 4, left: Math.max(left, 8), width });

    function onScroll(ev: Event) {
      // Scrolling the dropdown's own (portaled) list fires a capture-phase
      // scroll event on this same listener - only close for scrolls
      // elsewhere on the page (an ancestor moving, which would leave the
      // list mispositioned), not for scrolling within the list itself.
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
      setHighlight((h) => Math.min(h + 1, matches.length));
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      if (highlight === 0) choose("");
      else {
        const a = matches[highlight - 1];
        if (a) choose(a.account_no);
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
        placeholder={props.placeholder || "— uncategorized —"}
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
            <div
              className={"autocomplete-option" + (highlight === 0 ? " active" : "")}
              onMouseDown={(ev) => {
                ev.preventDefault();
                choose("");
              }}
              onMouseEnter={() => setHighlight(0)}
            >
              — uncategorized —
            </div>
            {matches.map((a, i) => (
              <div
                key={a.account_no}
                className={"autocomplete-option" + (highlight === i + 1 ? " active" : "")}
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  choose(a.account_no);
                }}
                onMouseEnter={() => setHighlight(i + 1)}
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
