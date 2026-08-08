// Shared "N minutes/hours/days ago" formatter for "Last synced" displays -
// pages/Stripe/index.tsx had its own copy of this before any other page
// needed one; factored out here now that the PCO People/Giving syncs need
// the same display in three more places.
export function fmtRelative(iso: string | null, nowMs: number = Date.now()): string {
  if (!iso) return "Never";
  const then = new Date(iso).getTime();
  const minutes = Math.floor((nowMs - then) / (1000 * 60));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
