import { LedgerEntry } from "./types";

/** An Expense-category entry should be a real cash outflow (negative); an
 * Income-category entry should be a real cash inflow (positive). This is a
 * soft warning, not a rule to enforce - a vendor refund credited to an
 * Expense account, or a donation chargeback debited from an Income account,
 * are legitimate and would trip this too, so it's surfaced for review only,
 * never auto-corrected or blocked. */
export function hasSignWarning(e: LedgerEntry): boolean {
  if (e.category === "Expense" && e.amount > 0) return true;
  if (e.category === "Income" && e.amount < 0) return true;
  return false;
}
