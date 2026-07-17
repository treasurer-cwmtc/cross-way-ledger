import { LedgerEntry } from "../ledger/types";

export type LinkableEntry = LedgerEntry & { source: "reconciliation" | "accrual" };
