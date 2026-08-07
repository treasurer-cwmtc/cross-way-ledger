# Ledgers: Actual, Accrual, Budget & Restricted Net Assets

*How the four core ledgers work, how they relate to each other, and how to edit, split, and attach receipts to an entry.*

**Required permissions:** `Actual`, `Accrual`, `Budget`, `Restricted Net Assets` (each page is gated separately)

---

## The four ledgers, in one paragraph

**Actual** is the permanent record of what actually happened in the bank — populated by pushing a reconciled Upload run into it (see the [Upload Wizard](bank-reconciliation-upload-wizard.md)), then freely editable afterward. **Accrual** is shaped exactly the same way, but entirely hand-entered — use it to record an expense or reimbursement as soon as it's incurred, before the real payment clears the bank and shows up in Actual. **Budget** is the annual plan: one row per planned amount, always a plain positive number, categorized against the same Chart of Accounts as the real ledgers. **Restricted Net Assets** records a permanent reclassification of money already sitting in a restricted fund — releasing it into the account it's meant to fund (or the reverse), with no bank transaction involved at all.

All four categorize against the same [Chart of Accounts](chart-of-accounts-and-rules.md), and all four ultimately feed the [General Ledger](reporting.md).

## Actual and Accrual

These two pages share the same table shape and behavior.

### The column health strip

At the top of both pages, a row of chips shows the health of every column at a glance — e.g. *"46 rows missing Transaction Date — click to filter"* or *"Every row has Amount."* Click any chip to instantly filter the table down to just the rows missing that field, so cleaning up incomplete data is a matter of working through the chips one at a time rather than scanning the whole table for gaps.

### Editing an entry

Click any row to open its full detail editor. Every field is directly editable except the Chart-of-Accounts-derived columns (Category, Statement, Item, Item Detail, Grouping, Youth Chaplain Share, Missions, Type) and the date-part breakdown columns (month name, month-year, year, current-year/prior-year, for both dates) — those are always computed live from the account you've assigned and the date fields, so they can never drift out of sync with the Chart of Accounts.

### Splitting an entry

If one bank line actually covers several categories (a common case: one lump "REMOTE ONLINE DEPOSIT" covering several checks), split it. The original row is kept, hidden from the normal list, so it still blocks a future re-import of the same statement from re-adding it as a "new" duplicate — the visible, editable rows afterward are its children. Undoing a split removes the children and un-hides the original.

### Reconciling an Actual line against Accrual entries

The mirror image of splitting: one bank line that actually settles *several* Accrual entries at once (e.g. one Zelle payment covering multiple expense lines, or a reimbursement that was paid in one lump sum). From the Actual page, open the bank line and click **Reconcile against Accrual**:

1. **Select matching lines** — pick one or more Accrual entries from the candidate table. The selected total must tie to the actual's amount (within a cent) before you can continue.
2. **Preview** — see exactly what will happen: the actual line will be replaced by one new row per selected accrual entry (retaining the actual's Posted Date and Bank Description, so the connection to the real bank statement isn't lost), and the accrual entries you picked will be removed from the Accrual ledger.
3. **Submit** — both sides happen together, in one transaction; if anything fails, nothing changes.

Like a split, nothing is actually deleted: the original actual line and the consumed accrual entries are hidden (not hard-deleted), preserving the audit trail and preventing a re-imported bank statement from recreating the actual line as a duplicate.

An Accrual entry linked to a [reimbursement](reimbursements.md) can only be reconciled once its reimbursement request is **Paid** or **Rejected** — a still-pending request can still be edited or rejected, which would change or remove the same accrual entry out from under the reconciliation.

### Attaching a receipt

Open an entry and use the Google Drive picker to attach a receipt file. Only the file's identity and a link are stored — the file itself stays in your Drive, never copied into the app's own storage. For attaching many receipts at once against already-existing entries, see [Link Receipts](donors-and-receipts.md#link-receipts).

### Posted Year filter

Both pages default to the current fiscal year. Use the **Posted Year** dropdown at the top to look at a prior year's entries.

## Budget

One row per planned amount for a Budget-category account. A single account can carry **more than one** budget line in the same year — for example, "Salaries and Benefits" might carry a separate "Salary" line and a "Health Insurance" line, both posted to the same account and summed together for reporting.

- Click **+ Quick add** to enter several budget lines in a row without leaving the page.
- Use **Copy budget from year** to pull an entire prior year's budget in as a starting point for the current year, then adjust individual lines from there.
- The **Year** dropdown switches which fiscal year you're viewing/editing.

Budget amounts are always plain positive numbers — the [Income Statement](reporting.md) takes the absolute value of actual transaction amounts to compare against them, so there's no sign convention to remember when entering a plan.

## Restricted Net Assets

Each row is one transfer, with two sides: a **From** account (money moves out of) and a **To** account (money moves into). Unlike Accrual, a transfer isn't a placeholder waiting for a bank transaction to clear it — the transfer itself *is* the permanent economic event. Use **+ Quick add** to enter several transfers in a row.

The [General Ledger](reporting.md) synthesizes two lines from each transfer row — a decrease on the From account, an increase on the To account — so a single Restricted Net Assets entry always shows up as a matched pair when you look at the combined ledger view.

---

## Tips

- **When in doubt about which ledger to use**: if money already moved in the bank, it belongs in Actual (imported via Upload). If you know an expense is coming but the bank hasn't cleared it yet, use Accrual. If you're reclassifying money already on the books between two restricted purposes, use Restricted Net Assets. Budget never represents a real transaction at all — it's always the plan you're measuring against.
- **A blank Category/Statement/Item on an entry** almost always means the account it's assigned to is missing from the Chart of Accounts, or the entry itself is uncategorized (`account_no` is blank) — fix it from the [Chart of Accounts](chart-of-accounts-and-rules.md) page or by re-categorizing the entry directly.

---

*Part of the [Cross Way Ledger documentation](../README.md). See also: [Reporting](reporting.md), [Chart of Accounts & Rules](chart-of-accounts-and-rules.md).*
