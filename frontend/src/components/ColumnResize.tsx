import { useEffect, useRef, useState } from "react";

const MIN_WIDTH = 40;

function loadWidths(storageKey: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(`col-widths:${storageKey}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Lets a table opt into user-resizable columns: call this hook once per
 * table (storageKey should be unique per table so widths don't collide),
 * render <ColGroup> right after the opening <table> tag, and put a
 * <ColResizeHandle> as the last child of each <th>. Widths persist across
 * reloads via localStorage, keyed by storageKey. */
export function useColumnWidths(storageKey: string) {
  const [widths, setWidths] = useState<Record<string, number>>(() => loadWidths(storageKey));
  const draggingRef = useRef<{ col: string; startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    localStorage.setItem(`col-widths:${storageKey}`, JSON.stringify(widths));
  }, [storageKey, widths]);

  useEffect(() => {
    function onMove(ev: MouseEvent) {
      const d = draggingRef.current;
      if (!d) return;
      const next = Math.max(MIN_WIDTH, d.startWidth + (ev.clientX - d.startX));
      setWidths((w) => ({ ...w, [d.col]: next }));
    }
    function onUp() {
      draggingRef.current = null;
      document.body.style.cursor = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  function startResize(col: string, defaultWidth: number) {
    return (ev: React.MouseEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      draggingRef.current = { col, startX: ev.clientX, startWidth: widths[col] ?? defaultWidth };
      document.body.style.cursor = "col-resize";
    };
  }

  return { widths, startResize };
}

/** Renders a <col> per column so table-layout: fixed can size each one
 * independently of its cell content - must appear right after <table>,
 * before <thead>. `columns` must list every currently-rendered column key
 * in order (omit ones that are conditionally hidden). */
export function ColGroup({
  columns,
  widths,
  defaultWidth = 150,
}: {
  columns: string[];
  widths: Record<string, number>;
  defaultWidth?: number;
}) {
  return (
    <colgroup>
      {columns.map((c) => (
        <col key={c} style={{ width: widths[c] ?? defaultWidth }} />
      ))}
    </colgroup>
  );
}

/** Drag handle for one column - put as the last child inside that column's
 * <th>. The <th> itself just needs to be a positioned element, which every
 * <th> in this app already is (sticky headers count as positioned). */
export function ColResizeHandle({
  col,
  defaultWidth = 150,
  startResize,
}: {
  col: string;
  defaultWidth?: number;
  startResize: (col: string, defaultWidth: number) => (ev: React.MouseEvent) => void;
}) {
  return <span className="col-resize-handle" onMouseDown={startResize(col, defaultWidth)} />;
}
