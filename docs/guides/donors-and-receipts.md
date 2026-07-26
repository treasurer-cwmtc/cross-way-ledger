# Donors & Link Receipts

*The shared donor list and how to bulk-attach receipt files already sitting in Google Drive to their matching ledger entries.*

**Required permissions:** `Giving App - Donors`, `Link Receipts`

---

## Giving App - Donors

A single, shared donor list — refreshed by each pledge campaign's import wizard (see [Pledge Campaigns](pledge-campaigns.md)), but not scoped to any one campaign. Every donor record carries their name, email, contact info, and — where applicable — their joint giver (spouse) information, since gifts and pledges made jointly are reconciled against each other throughout the app.

The table is sortable and filterable on every column. Click a row to see that donor's full giving history across every fund and campaign they've contributed to.

## Link Receipts

Use this page to bulk-attach invoice or receipt files that are **already sitting in Google Drive** to the ledger entries they belong to — useful when a batch of receipts was scanned or saved to Drive separately from the day-to-day reconciliation work.

### How matching works

Files are matched to a ledger entry by **exact Check/Invoice Name** (the file's name, minus its extension) against entries in both **Actual** and **Accrual** that don't already have a receipt attached.

- If exactly **one** entry matches a file's name, it's linked automatically — no action needed.
- If **zero or multiple** entries match, you'll need to pick manually.

### Step by step

1. Click **Select files from Google Drive** and choose one or more receipt files already in your Drive. This is a single consent step covering every file you select.
2. The wizard shows a table with one row per file: the file name (linked, opens in Drive), the matched entry (or a prompt to pick one), and a status.
   - If several entries share the same Check/Invoice Name, you'll see a warning to pick the correct one.
   - If nothing matched automatically, the row shows "no automatic match found" until you choose one.
3. To manually match a row, start typing in the **Matched entry** field — it filters by Check/Invoice Name, description, or amount as you type. Each option shows the entry's name, amount, date, and which ledger (Actual or Accrual) it belongs to, so you can tell two similarly-named entries apart at a glance.
4. Once you're satisfied with the matches, click **Link N of M file(s)**. Each row updates live — **Saving…**, then **✓ Linked**, or **Failed** with the reason shown on hover if something went wrong.
5. Remove any row you don't want to link yet with its **Remove** action — this only removes it from the current batch, it doesn't delete anything.

> Only the file's identity and a link are stored on the ledger entry — the file itself always stays in Google Drive, never copied into the app's own storage.

---

## Tips

- **Name your scanned receipts to match the Check/Invoice Name on the ledger entry** before uploading to Drive — that's what makes automatic matching work, and it'll save you the manual-pick step almost every time.
- **An entry that already has a receipt won't show up as a match candidate** — if you need to replace one, remove the existing receipt from the entry's detail editor first (see [Ledgers](ledgers.md)).

---

*Part of the [Cross Way Ledger documentation](../README.md). See also: [Ledgers](ledgers.md), [Pledge Campaigns](pledge-campaigns.md).*
