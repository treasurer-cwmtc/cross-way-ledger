# Chart of Accounts & Rules

*How the 3-level account hierarchy works, how to add a new account, and how automatic categorization rules save you from tagging every transaction by hand.*

**Required permissions:** `Chart of Accounts`, `Rules`

---

## The 3-level hierarchy

Every account is built from three levels, added top-down:

1. **Statement Category** — the top level, scoped to a Type (`Income`, `Expense`, or `Budget`). Example: *Property*.
2. **Statement Item** — nests under a Statement Category. Example: *Church-Utilities*, under *Property*.
3. **Account / Statement Detail** — the leaf level, the one every ledger entry actually categorizes against. Detail is optional — leave it blank for a "no subdivision" account.

Each level's number auto-increments within its parent and is generated for you — you never type an account number by hand. Statement Category and Statement Item names/numbers shown throughout the app are always derived live from this hierarchy, so they can never drift out of sync with it.

## Adding a new account, step by step

The **Chart of Accounts** page presents this as three stacked forms, matching the hierarchy:

### 1. Add a Statement Category

Check one or more **Type(s)** (`Income`, `Expense`, `Budget`, or `All`), enter a **Name**, and click **Add Statement Category**. Checking multiple types creates the same-named category independently under each one — useful when a concept like "Restricted Gifts" needs its own Income and Expense side.

### 2. Add a Statement Item

Choose the **Type** and the parent **Statement Category**, enter a **Name**, and click **Add Statement Item**.

### 3. Add an Account (Statement Detail)

Choose the **Type**, **Statement Category**, and **Statement Item** (the Statement Item dropdown is disabled until a category is chosen), optionally enter a **Statement Detail** name, an optional free-text **Grouping** label, and check **Tax deductible** and/or **Mandatory** if they apply. A read-only **Account number** field previews the generated number as you fill the form in. Click **Add account**.

> You only need to repeat steps 1–2 when you're creating a genuinely new category or item — most day-to-day additions are just step 3, adding a new account under a category/item that already exists.

## The accounts table

Below the three forms, every account is listed with its full hierarchy, Grouping, and flags (Tax Deductible, Mandatory, Youth Chaplain Share, Missions). Every column sorts, and most support an Excel-style multi-select filter. Click any row to open its detail and edit it, or delete it — deleting an account already in use by a rule or a ledger entry is blocked with a clear error rather than silently orphaning that data.

---

## Rules: automatic categorization

Rules save you from manually assigning a category to every single transaction. There are two kinds:

- **Bank keyword → category** — if a bank line's description *contains* a given phrase, assign it to an account. Example: description contains `ATMOS ENERGY` → `Utilities`.
- **Stripe fund → category** — maps a Stripe donation's fund name directly to an income account. Example: fund `Building Fund` → `Restricted Gifts - Building Fund`.

### Adding a rule

On the **Rules** page, choose the rule type, enter the keyword/phrase (or fund name), pick the account it should assign, optionally set a **Priority** (lower numbers win when more than one rule matches the same line), and — for bank keyword rules only — an optional **Description** that also stamps a friendly payee name onto the matched line (e.g. "Sams Club" instead of the raw bank text).

Rules can also be created inline, on the fly, from the [Upload Wizard](bank-reconciliation-upload-wizard.md) whenever it encounters an unmatched bank description or Stripe fund — you rarely need to visit the Rules page directly except to review, edit, or deactivate what's already there.

### Managing existing rules

Two tables — **Bank keyword rules** and **Stripe fund rules** — list every rule with its match text, assigned account, category, priority, and an **Active** toggle. Deactivating a rule keeps it for reference without deleting it or letting it match anything new. Click a row to open its detail, edit it, or delete it entirely.

---

## Tips

- **Priority matters when two rules could both match the same line** — the lower-priority-number rule wins. If a line keeps getting mis-categorized, check whether a more general rule is beating out a more specific one.
- **A deactivated rule doesn't retroactively uncategorize anything** — it only stops matching *future* lines.
- **Deleting an account in use is intentionally blocked** — if you need to retire one, first re-categorize anything still pointing at it.

---

*Part of the [Cross Way Ledger documentation](../README.md). See also: [Bank Reconciliation & Upload Wizard](bank-reconciliation-upload-wizard.md), [Ledgers](ledgers.md).*
