import { useEffect, useMemo, useRef, useState } from "react";
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
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocMouseDown(ev: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(ev.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

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
      {open && (
        <div className="autocomplete-list">
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
        </div>
      )}
    </div>
  );
}
