# Bank Reconciliation: The Upload Wizard

*A guided, 4-step walkthrough of the **Upload** tab — how a bank statement and a Stripe export become clean, categorized entries in the Actual ledger.*

**Required permission:** `Upload`

---

## What this wizard replaces

Historically, matching a Chase bank statement against Stripe donation activity meant manually cross-referencing two spreadsheets: finding each lump-sum `STRIPE … TRANSFER` deposit on the bank statement, then tracking down every individual donation that made up that payout. The Upload wizard automates all of it — matching, exploding, categorizing, and double-checking the totals — and only asks for your judgment where a rule doesn't already exist.

## Before you start

You'll need two files, both exported for the same statement period:

1. A **bank statement CSV** (Chase export).
2. A **Stripe transactions CSV**.

## Step 1 — Bank upload

1. Choose the **Bank Account** this statement belongs to (e.g. *Chase Operating*).
2. Choose the **Bank statement CSV (Chase export)** file.
3. Click **Upload**.

The wizard shows a preview of every line on the statement, with columns for **Date**, **Bank Description**, **Amount**, **Category**, and **Status**. Click any row to open its full editor, or assign a category directly in the table.

> **If a bank description doesn't match any existing rule**, a card titled **Missing keyword rules** appears listing every unmatched description. For each one, edit the suggested keyword down to just the meaningful part (so it'll match this vendor going forward, not just this one line's exact wording), pick the account it should categorize to, and click **Add rule**. Every matching line updates automatically — you only have to do this once per new vendor.

Click **Next: Stripe upload** once you're satisfied with the categorization.

## Step 2 — Stripe upload

1. Choose the **Stripe transactions CSV** file. Selecting it immediately checks whether every fund named in the file already has a categorization rule.
2. A **Fund coverage** table lists every fund found in the file with a status pill: **✓ Covered** or **✗ Missing rule**.
3. For any fund marked **✗ Missing rule**, pick the income account it should post to and click **Add rule**.

You can't continue until every fund shows **✓ Covered** — the button reads **Next: Reconcile** and stays disabled with the reminder *"Add a rule for every red fund below to continue"* until then.

## Step 3 — Reconcile

Click **Reconcile**. The wizard:

1. Matches each `STRIPE … TRANSFER` bank deposit to its Stripe payout record.
2. **Explodes** each payout into the individual donations that made it up, using each donation's **net** (post-fee) amount, so the exploded lines sum exactly to the bank deposit.
3. Shows summary tiles: **Payouts matched**, **Unmatched Stripe payouts**, and **Total Stripe bank lines**.

A **By day** table breaks the results down by posted date, with a status per day:

- **✓ Matched** — the bank total and the re-summed Stripe total agree, and every line matched cleanly.
- **Needs attention** — click to expand. This means either there are unmatched lines that day (excluding a normal `STRIPE PAYOUT ADJUSTMENT` fee/timing line, which is expected) or the day's two totals differ by 1¢ or more. The expanded view shows exactly which lines are the problem, or — if the imbalance appeared with no bad lines — a note that a line's amount was likely hand-edited after the initial reconciliation.

Once every day looks right (or you understand why one doesn't), click **Next: Data validation**.

## Step 4 — Data validation

This is the wizard's final safety check before anything is written to the Actual ledger. Four cards run automatically:

1. **Totals check** — confirms the reconciled lines' income and expense totals match the raw bank file's totals exactly. A ✓ or ✗ appears next to each.
2. **Rules added this session** — a plain list of every new categorization rule you created during this run, so you can review them before committing.
3. **Already in Actual?** — checks whether any of these lines (matched by date, amount, and reference) already exist in the Actual ledger. This is what makes it safe to re-upload a statement that partially overlaps one you've already processed — duplicates are silently skipped, not double-entered.
4. Click **Process** to write everything to Actual. You'll see a confirmation: **✓ Added _N_ line(s) to Actual**, noting how many (if any) were skipped as duplicates.

When it's done, click **Upload another statement** to start the wizard again from Step 1.

---

## Tips

- **You can only move forward through steps you've already reached** — the stepper won't let you skip ahead, but you can always click back to a completed step to review or fix something.
- **Rules you add here apply everywhere**, immediately — future uploads, and the [Chart of Accounts & Rules](chart-of-accounts-and-rules.md) page, will reflect them right away.
- If you're not sure whether a statement was already imported, just try — Step 4's duplicate check makes re-running this wizard on a familiar statement safe.

---

*Part of the [Cross Way Ledger documentation](../README.md). See also: [Ledgers](ledgers.md), [Chart of Accounts & Rules](chart-of-accounts-and-rules.md).*
