import { useEffect, useState } from "react";
import { BankAccount } from "../../api/bankAccounts";

// These cells are only used inside the detail popups (TransactionModal,
// Budget's DetailModal) - never in the compact register rows, which render
// plain text, not inputs - so they should look like normal form fields
// (the global bordered input/select styling), not stripped-down table cells.

export function CheckboxCell(props: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <input
      type="checkbox"
      checked={props.value}
      onChange={(e) => props.onChange(e.target.checked)}
    />
  );
}

export function DateCell(props: { value: string | null; onChange: (v: string | null) => void }) {
  return (
    <input
      type="date"
      value={props.value || ""}
      onChange={(e) => props.onChange(e.target.value || null)}
    />
  );
}

/** Debounced text input so we don't PUT on every keystroke. */
export function TextCell(props: { value: string; onCommit: (v: string) => void }) {
  const [value, setValue] = useState(props.value);
  useEffect(() => setValue(props.value), [props.value]);

  useEffect(() => {
    if (value === props.value) return;
    const handle = setTimeout(() => props.onCommit(value), 500);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
    />
  );
}

export function CurrencyCell(props: { value: number; onCommit: (v: number) => void }) {
  const [value, setValue] = useState(String(props.value));
  useEffect(() => setValue(String(props.value)), [props.value]);

  function commit() {
    const n = Number(value);
    if (!Number.isNaN(n) && n !== props.value) props.onCommit(n);
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
      <span style={{ color: "var(--muted)" }}>$</span>
      <input
        type="number"
        step="0.01"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
      />
    </div>
  );
}

export function SelectCell(props: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const options = props.options.includes(props.value) || !props.value
    ? props.options
    : [props.value, ...props.options];
  return (
    <select value={props.value} onChange={(e) => props.onChange(e.target.value)}>
      <option value="">{props.placeholder || "Select…"}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

export function BankAccountCell(props: {
  value: number | null;
  bankAccounts: BankAccount[];
  onChange: (v: number | null) => void;
}) {
  return (
    <select
      value={props.value ?? ""}
      onChange={(e) => props.onChange(e.target.value ? Number(e.target.value) : null)}
    >
      <option value="">Select…</option>
      {props.bankAccounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </select>
  );
}
