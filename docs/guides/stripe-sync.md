# Stripe: Automated Transaction Sync

*How the Stripe page pulls donation and payout data automatically, how "Sync now" and the days-back window work, and how to trust that it matches what you'd get from a manual export.*

**Required permission:** `Stripe`

---

## What this page is

The Stripe page keeps a running, searchable copy of your Stripe activity — payouts and the individual donations inside each one — pulled directly from Stripe's API instead of you exporting and uploading a CSV by hand. It's a **staging area**, not the permanent ledger: nothing here touches Actual, Accrual, or any other ledger by itself. Reconciling this data against your bank statement still happens in the [Upload Wizard](bank-reconciliation-upload-wizard.md), exactly as it always has — this page just replaces the "export a CSV from Stripe" step of that process with an always-current table you can browse, sort, and filter on its own.

## Syncing data

- **Sync now** pulls fresh transactions from Stripe's API right away. The **days back** field next to the button controls how far back it looks (defaults to 30) — raise it temporarily for a one-time catch-up, or leave it alone for routine use.
- **Last refreshed**, right-aligned in the toolbar, always shows how long ago the most recent sync finished ("Just now", "12 minutes ago", etc.) so you can tell at a glance whether the table is current.
- A sync **re-pulls and re-saves** every transaction in the window every time, keyed by Stripe's own transaction id — running it twice never creates duplicates, and it self-heals if Stripe later amends or refunds something you already synced.
- Below the toolbar, a short message confirms what the last sync actually did (e.g. *"Synced 58 transactions"*).

There is no destructive action on this page — syncing only ever adds or refreshes rows in the staging table; it never deletes anything or writes to a ledger.

## Browsing the table

Every column header is both **sortable** (click to sort, click again to reverse) and, where it makes sense, **filterable** (click the funnel icon to check/uncheck specific values, like a spreadsheet's AutoFilter). Click any row to open a **read-only detail view** with every field Stripe provided for that transaction — useful for tracing exactly why a donation was categorized the way it was, or confirming a payout's total against what showed up in the bank.

## Why you can trust this matches a manual CSV export

The sync doesn't use a separate, hand-rolled parsing path from the old manual upload — it builds the exact same internal row shape (`StripeRow`) that a manually-exported CSV always has, and a backend test (`test_api_path_matches_csv_path_for_the_same_donation`) directly asserts that a CSV row and an API-synced row for the *same* underlying donation come out byte-identical on every field the reconciler reads. If Stripe's API sync and a manual CSV export ever disagreed, that test would catch it before it shipped.

## Backfilling older history

Stripe retains full transaction history indefinitely, and the sync isn't limited to a rolling window by design — only by whatever number you put in **days back**. To pull in older data (e.g. everything since the start of 2025), set days back to a large enough number (400+) and click Sync now once. See [issue #101](https://github.com/treasurer-cwmtc/cross-way-ledger/issues/101) for notes on doing this safely for a large date range. Backfilling only populates this staging table — actually reconciling older Stripe data against last year's bank statements is still a separate step through the Upload Wizard.

## Automatic scheduling

Today, syncing is entirely on-demand (you click Sync now). A nightly scheduled sync (Cloud Scheduler, prod only — dev intentionally stays manual-only) is tracked as future work; see [issue #100](https://github.com/treasurer-cwmtc/cross-way-ledger/issues/100).

## What's next

Wiring `ledger_stripe` into the Upload Wizard as a reconciliation source (alongside the equivalent Plaid/Chase staging table), so this page's data can flow straight into a reconciled ledger entry without a manual CSV step at all — see [issue #105](https://github.com/treasurer-cwmtc/cross-way-ledger/issues/105).

---

*Part of the [Cross Way Ledger documentation](../README.md). See also: [Bank Transactions (Plaid)](bank-transactions-plaid-sync.md), [Bank Reconciliation & Upload Wizard](bank-reconciliation-upload-wizard.md).*
