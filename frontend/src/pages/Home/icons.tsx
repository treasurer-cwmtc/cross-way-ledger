// Small outline-style icons for the Home page's shortcut tiles - kept as
// plain inline SVG (no icon library dependency) since we only need a
// handful, all sharing the same stroke weight/viewBox for visual consistency.
import { SVGProps } from "react";

function Base(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={22}
      height={22}
      {...props}
    />
  );
}

export function UploadIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M12 16V4M12 4l-4 4M12 4l4 4" />
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </Base>
  );
}

export function TableIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M9 10v9.5" />
    </Base>
  );
}

export function ReceiptIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M6 3.5h12v17l-2.5-1.5L13 20.5l-2.5-1.5L8 20.5 6 19V3.5Z" />
      <path d="M9 8h6M9 12h6" />
    </Base>
  );
}

export function BookIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M4 4.5h8a3 3 0 0 1 3 3V20a2.5 2.5 0 0 0-2.5-2.5H4Z" />
      <path d="M20 4.5h-8a3 3 0 0 0-3 3V20a2.5 2.5 0 0 1 2.5-2.5H20Z" />
    </Base>
  );
}

export function ChartIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M4 20V10M11 20V4M18 20v-7" />
      <path d="M3 20h18" />
    </Base>
  );
}

export function PlusCircleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8.5v7M8.5 12h7" />
    </Base>
  );
}

/** Balance scale - reconciliation is fundamentally "does side A match side
 * B", so a scale reads more clearly than the generic upload glyph it used
 * to share with the deprecated Upload wizard. */
export function ScaleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M12 3v18M8 21h8" />
      <path d="M5 6h14M5 6l3.2 6a3 3 0 0 1-6.4 0L5 6ZM19 6l-3.2 6a3 3 0 0 0 6.4 0L19 6Z" />
    </Base>
  );
}

/** Clock face - accrual entries are recognized before cash actually moves
 * (a timing concept), which a clock communicates better than a bare plus
 * sign that reads as "add new" rather than "accrued over time". */
export function ClockIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3.2 2" />
    </Base>
  );
}
