import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChartAccount } from "../../api/accounts";

function labelFor(a: ChartAccount) {
  return `${a.account_no} · ${a.statement_description}`;
}

/** Multi-select Chart-of-Accounts picker: type to filter, click (or Enter) to
 * toggle an account on/off - the dropdown stays open across picks, so
 * checking several accounts under the same search (e.g. "vbs") doesn't
 * require re-opening and re-typing between every one. Selected accounts also
 * show as removable chips below. Built for the Reimbursements assignment
 * editor ("which accounts can this person submit against"). */
export default function MultiAccountPicker(props: {
  value: string[];
  accounts: ChartAccount[];
  onChange: (accountNos: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });
  const boxRef = useRef<HTMLDivElement>(null);

  const selected = props.accounts.filter((a) => props.value.includes(a.account_no));

  useEffect(() => {
    function onDocMouseDown(ev: MouseEvent) {
      const target = ev.target as Node;
      if (
        boxRef.current &&
        !boxRef.current.contains(target) &&
        !(target instanceof Element && target.closest(".autocomplete-list"))
      ) {
        setOpen(false);
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

  function toggle(accountNo: string) {
    if (props.value.includes(accountNo)) {
      props.onChange(props.value.filter((a) => a !== accountNo));
    } else {
      props.onChange([...props.value, accountNo]);
    }
  }

  function remove(accountNo: string) {
    props.onChange(props.value.filter((a) => a !== accountNo));
  }

  function selectAll() {
    props.onChange(props.accounts.map((a) => a.account_no));
  }

  function clearAll() {
    props.onChange([]);
  }

  // Selects/deselects everything the current search matched, not the whole
  // account list - lets "vbs" + one click grab all 6 VBS accounts instead of
  // clicking each one individually.
  const allMatchesSelected = matches.length > 0 && matches.every((a) => props.value.includes(a.account_no));

  function toggleAllMatches() {
    if (allMatchesSelected) {
      const matchNos = new Set(matches.map((a) => a.account_no));
      props.onChange(props.value.filter((a) => !matchNos.has(a)));
    } else {
      const toAdd = matches.map((a) => a.account_no).filter((a) => !props.value.includes(a));
      props.onChange([...props.value, ...toAdd]);
    }
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
      if (a) toggle(a.account_no);
    } else if (ev.key === "Escape") {
      ev.stopPropagation();
      setOpen(false);
    }
  }

  return (
    <div>
      <div className="row" style={{ gap: 10, alignItems: "center" }}>
        <div ref={boxRef} className="autocomplete" style={{ flex: 1 }}>
          <input
            type="text"
            placeholder="Search to check off Chart-of-Accounts…"
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
                style={{
                  position: "fixed",
                  top: coords.top,
                  left: coords.left,
                  width: coords.width,
                }}
              >
                {matches.length > 0 && (
                  <div
                    className="autocomplete-option"
                    onMouseDown={(ev) => {
                      ev.preventDefault();
                      toggleAllMatches();
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontWeight: 600,
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <input type="checkbox" checked={allMatchesSelected} readOnly style={{ flex: "none" }} />
                    <span>
                      {query.trim() ? `Select all ${matches.length} matching` : "Select all"}
                    </span>
                  </div>
                )}
                {matches.map((a, i) => {
                  const checked = props.value.includes(a.account_no);
                  return (
                    <div
                      key={a.account_no}
                      className={"autocomplete-option" + (highlight === i ? " active" : "")}
                      onMouseDown={(ev) => {
                        ev.preventDefault();
                        toggle(a.account_no);
                      }}
                      onMouseEnter={() => setHighlight(i)}
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <input type="checkbox" checked={checked} readOnly style={{ flex: "none" }} />
                      <span>{labelFor(a)}</span>
                    </div>
                  );
                })}
                {matches.length === 0 && <div className="autocomplete-empty">No matches</div>}
              </div>,
              document.body
            )}
        </div>
        <button type="button" className="btn secondary" onClick={selectAll}>
          Select all
        </button>
        <button type="button" className="btn secondary" onClick={clearAll}>
          Clear
        </button>
      </div>
      <div className="chip-strip" style={{ marginTop: 10 }}>
        {selected.map((a) => (
          <span key={a.account_no} className="chip active">
            {a.account_no} · {a.statement_description}
            <button
              type="button"
              className="link"
              style={{ marginLeft: 4 }}
              onClick={() => remove(a.account_no)}
            >
              ×
            </button>
          </span>
        ))}
        {selected.length === 0 && <span className="subtitle">No accounts assigned yet.</span>}
      </div>
    </div>
  );
}
