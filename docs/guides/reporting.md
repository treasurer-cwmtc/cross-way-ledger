# Reporting: General Ledger & Income Statement

*How the combined ledger view and the Plan-vs-Actual report work, and how to export data for outside analysis.*

**Required permissions:** `General Ledger`, `Income Statement`

---

## General Ledger

The General Ledger is every **Actual**, **Accrual**, **Budget**, and **Restricted Net Assets** line, in one place — the base every other financial report is built from. It isn't a separate ledger you enter data into; it's a live combined view of the four ledgers described in [Ledgers](ledgers.md).

- **Posted Year** and **Source** filters narrow the view down to one fiscal year and/or one of the four contributing ledgers.
- **Posted Date** range filters to a specific window.
- Every column sorts and filters; scroll right for Bank Description.
- Click any row to open its detail popup and edit it right there — General Ledger is a read/edit surface for the underlying entry, not a static report.

A line count and total appear above the table (e.g. *"1989 lines · $2,379,589.68"*) so you always know how much data is in the current filtered view.

### Export to Excel

Click **Export to Excel** to download the currently filtered view as a spreadsheet, matching the full column layout of the church's historical reporting spreadsheet — including every date-part breakdown column (transaction/posted month, month-year, year, current-year/prior-year) and every Chart-of-Accounts-derived column. The downloaded file is named `YYYYMMDD_GeneralLedger_HHMMSS.xlsx`, timestamped to the moment you exported it.

## Income Statement

Plan vs. Actuals for the current fiscal year (as set on the [Config page](administration.md#config)). Organized by Statement Category, with three columns per line:

- **Plan** — pulled from the Budget ledger.
- **Actuals** — pulled from Actual and Accrual combined.
- **Variance** — favorable-positive: for Income lines, actual above plan is shown as a positive (green) variance; for Expense lines, actual *below* plan is favorable.

This report has no separate data entry of its own — correcting a number here always means correcting the underlying Budget, Actual, or Accrual entry it's built from.

---

## Tips

- **The General Ledger's line count is a good sanity check** after any bulk change (a new Upload run, a batch of Accrual entries, a Restricted Net Assets transfer) — if the count didn't move the way you expected, something didn't post the way you thought it did.
- **Exports are a point-in-time snapshot.** If you need the report to reflect entries added after you downloaded it, re-export rather than editing the spreadsheet by hand.

---

*Part of the [Cross Way Ledger documentation](../README.md). See also: [Ledgers](ledgers.md), [Chart of Accounts & Rules](chart-of-accounts-and-rules.md).*
