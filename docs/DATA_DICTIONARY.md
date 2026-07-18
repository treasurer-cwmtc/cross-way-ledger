# Data Dictionary

_Every table, every column, its type, its constraints, and what it actually
means. Companion to [ARCHITECTURE.md](ARCHITECTURE.md)'s diagrams, which are
intentionally simplified for readability - this is the full detail behind
them. Source of truth is always `backend/app/models.py`; if this drifts from
that file, the code wins._

**How to read the Constraints column:** `PK` = primary key, `FK -> table.col`
= foreign key, `UK` = unique, `NOT NULL` = required, nothing listed = nullable
and unconstrained beyond its type.

---

## `users`

Login accounts - both password-based and Google Sign-In accounts live in
this one table.

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | integer | PK, auto-increment | |
| `username` | string(80) | UK, NOT NULL | Display name and the login identifier for password-based sign-in. |
| `password_hash` | string(255) | NOT NULL | PBKDF2-SHA256 hash. Always set, even for Google-only accounts - a random, never-shared value is generated for those so password login is impossible without needing a nullable column. |
| `email` | string(255) | nullable | Set only for accounts that can sign in with Google. Matched against the verified email in the Google ID token at login. `null` for password-only accounts. |
| `is_admin` | boolean | default `false` | Admins bypass the `permissions` list entirely and always have full access to every page, including Users/Permissions management itself. |
| `active` | boolean | default `true` | Soft-delete flag. "Deactivate" in the UI sets this to `false` rather than deleting the row. |
| `permissions` | JSON (list of strings) | default `[]` | The page keys this user has been granted (e.g. `"accrual"`, `"budget"`) - matches the frontend's `Tab` values. Ignored entirely for admins. `"home"` and `"users"` never appear here (Home is always visible, Users is admin-only). |
| `created_at` | datetime (tz-aware) | server default: now | |

---

## `app_settings`

Generic key/value store for app-wide settings the treasurer adjusts by hand
(mirrors the legacy spreadsheet's "Configurations" tab).

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `key` | string(80) | PK | e.g. `"prior_year_end_date"`, `"frequency_monthly"`, `"audit_validation_from_date"`. |
| `value` | string(300) | NOT NULL | Always stored as a string, regardless of the setting's logical type (date, number, etc.) - parsed by whichever page reads it. |

---

## `statement_categories`

Level 1 of the Chart of Accounts hierarchy, scoped to a Type.

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | integer | PK, auto-increment | |
| `category` | string(20) | NOT NULL | One of `Budget`, `Expense`, `Income`. |
| `no` | string(2) | UK with `category` | 2-digit code, auto-incrementing *within its Type* and never reused, even after a delete - true identity-column semantics, not gap-filling. |
| `name` | string(120) | NOT NULL | e.g. "Property", "Income". |

---

## `statement_items`

Level 2 - children of a Statement Category.

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | integer | PK, auto-increment | |
| `statement_category_id` | integer | FK -> `statement_categories.id`, NOT NULL | |
| `no` | string(2) | UK with `statement_category_id` | Auto-increments within its parent category, never reused. |
| `name` | string(120) | NOT NULL | e.g. "Storage Unit" under the "Property" category. |

---

## `chart_of_accounts`

Level 3 / the leaf - one row per actual account. This is what every ledger
entry ultimately categorizes against.

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `account_no` | string(20) | PK | Derived, never hand-typed: `<TypePrefix><CategoryNo><ItemNo><DetailNo>` (Type prefix is B/E/I). See `backend/app/services/coa_numbering.py`. |
| `statement_item_id` | integer | FK -> `statement_items.id`, NOT NULL | |
| `category` | string(50) | NOT NULL | Copy of the Type (Budget/Expense/Income) for convenient reads. |
| `statement_category` / `statement_category_no` | string(120) / string(2) | default `""` | Copies of the parent Statement Category's name/number. **Known normalization gap** - currently stored rather than derived live via join, the only place in the schema that does this. Tracked in [issue #23](https://github.com/treasurer-cwmtc/cross-way-ledger/issues/23). |
| `statement_item` / `statement_item_no` | string(120) / string(2) | default `""` | Same gap, one level up - copies of the parent Statement Item's name/number. |
| `statement_detail` | string(120) | default `""` | The Detail level's own name - optional ("no subdivision" account when blank). |
| `statement_detail_no` | string(2) | default `""` | Auto-increments within its parent Statement Item, never reused. |
| `statement_description` | string(300) | NOT NULL | Human-readable full label, auto-built from the chain unless overridden. |
| `is_tax_deductible` | string(10) | default `""` | Free-text Yes/No flag (not a real boolean - matches the legacy sheet's format). |
| `is_mandatory` | string(10) | default `""` | Same free-text Yes/No pattern. |
| `grouping` | string(120) | default `""` | An additional reporting grouping label, independent of the Category/Item/Detail hierarchy. |
| `is_youth_chaplain_share` | string(10) | default `""` | Free-text Yes/No flag. |
| `is_missions` | string(10) | default `""` | Free-text Yes/No flag. |

---

## `category_rules`

User-editable rules that auto-categorize a line during Upload.

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | integer | PK, auto-increment | |
| `rule_type` | string(20) | indexed, NOT NULL | `bank_keyword` (matches a bank line's Description) or `stripe_fund` (matches a Stripe donation's fund name). |
| `pattern` | string(200) | NOT NULL | The text to match against. |
| `account_no` | string(20) | NOT NULL, **not yet a real FK** | The account to assign on a match. Logically points at `chart_of_accounts.account_no`; a real foreign key constraint is planned in issue #23. |
| `priority` | integer | default `100` | Lower number wins when multiple rules match the same line. |
| `active` | boolean | default `true` | Inactive rules are ignored during categorization but kept for reference. |
| `created_at` | datetime (tz-aware) | server default: now | |

---

## `bank_accounts`

Named bank account lookup (e.g. "Chase Operating").

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | integer | PK, auto-increment | |
| `name` | string(120) | UK, NOT NULL | |
| `active` | boolean | default `true` | |

---

## `recon_runs`

One Upload wizard run - the *ephemeral preview*, not the persistent ledger.
Pushing a run into Actual creates `reconciliation_entries` rows separately.

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | integer | PK, auto-increment | |
| `created_at` | datetime (tz-aware) | server default: now | |
| `bank_filename` / `stripe_filename` | string(260) | default `""` | Original uploaded filenames, for reference. |
| `bank_line_count` / `stripe_line_count` | integer | default `0` | Row counts from each source file. |
| `matched_payout_count` | integer | default `0` | How many bank payout lines matched a Stripe payout. |
| `unmatched_stripe_bank_count` | integer | default `0` | Stripe payouts that couldn't be matched to a bank line. |
| `notes` | text | default `""` | |
| `raw_bank_income_total` / `raw_bank_expense_total` | float | default `0.0` | Sum of positive/negative amounts from the raw bank CSV at upload time - a fixed reference point for the wizard's totals check, independent of later edits. |
| `bank_totals_by_day` | JSON (dict) | default `{}` | Per-day bank payout totals captured once at merge-Stripe time, keyed by posted date - an independent reference for the wizard's by-day reconciliation check. |

---

## `recon_lines`

One output line of a run - a per-donation breakout line or a categorized
non-Stripe bank line. Deleted along with its parent run (cascade).

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | integer | PK, auto-increment | |
| `run_id` | integer | FK -> `recon_runs.id`, indexed, NOT NULL | |
| `source` | string(20) | NOT NULL | `stripe` or `bank`. |
| `transaction_date` / `date_posted` | string(20) | default `""` | Stored as plain strings here (unlike every persistent ledger table, which uses a real `Date` column) - this table is a preview, not the source of truth. |
| `description` | string(300) | default `""` | Donor or payee name. |
| `statement_description` | string(300) | default `""` | Chart-of-Accounts description, resolved at merge time. |
| `account_no` | string(20) | default `""` | Assigned by a rule match or left blank for manual categorization. |
| `category` | string(50) | default `""` | |
| `method` | string(40) | default `""` | |
| `amount` | float | default `0.0` | |
| `reference` | string(120) | default `""` | Transaction id or check number. |
| `bank_description` | text | default `""` | The original, unedited bank statement line text. |
| `matched` | boolean | default `true` | Whether this line successfully matched/reconciled during the wizard. |
| `notes` | string(300) | default `""` | |
| `is_stripe_payout` | boolean | default `false` | Marks a bank line that looks like a Stripe payout but is still awaiting the Stripe file (a placeholder, not a real categorized line yet). |

---

## `reconciliation_entries`

The persistent, editable **Actual** ledger. Created by importing a
completed Upload run (deduped via `dedup_key`), then freely hand-edited.

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | integer | PK, auto-increment | |
| `transaction_date` / `date_posted` | date | nullable | Real `Date` columns (unlike `recon_lines`). |
| `reconciled` | boolean | default `false` | Manually checked off once verified against the bank statement. |
| `is_reimbursement` | boolean | default `false` | |
| `account_no` | string(20) | default `""`, **not yet a real FK** | The only source of truth for this entry's categorization - Statement Description and every Chart-of-Accounts-derived column shown in the UI are looked up live from this, never stored, so they can't drift. Foreign key constraint planned in issue #23. |
| `description` | string(300) | default `""` | |
| `bank_account_id` | integer | FK -> `bank_accounts.id`, nullable | |
| `method` | string(40) | default `""` | |
| `amount` | float | default `0.0` | |
| `check_invoice_name` | string(200) | default `""` | Also auto-filled with a receipt's filename when one is attached. |
| `bank_description` | text | default `""` | Original, unedited bank statement text. |
| `notes` | string(300) | default `""` | |
| `dedup_key` | string(300) | UK, indexed, NOT NULL | Built from date + amount + reference/description - blocks re-importing the same statement twice. |
| `source_run_id` | integer | FK -> `recon_runs.id`, nullable | Which Upload run this entry was imported from, if any. |
| `created_at` | datetime (tz-aware) | server default: now | |
| `split_parent_id` | integer | FK -> `reconciliation_entries.id` (self), nullable | If this row is a child of a split, points at the original. |
| `is_split` | boolean | default `false` | `true` on the *original* row once it's been split - hides it from the normal list (its `dedup_key` still blocks re-import) in favor of its visible child rows. |
| `receipt_file_id` | string(200) | default `""` | Google Drive file id, if a receipt is attached. |
| `receipt_file_name` | string(300) | default `""` | |
| `receipt_web_view_link` | text | default `""` | Opens the file directly in Drive. |

---

## `accrual_entries`

The persistent, editable **Accrual** ledger - same shape as
`reconciliation_entries` minus the fields that only make sense for an
imported bank transaction.

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | integer | PK, auto-increment | |
| `transaction_date` / `date_posted` | date | nullable | |
| `reconciled` | boolean | default `false` | |
| `is_reimbursement` | boolean | default `false` | |
| `account_no` | string(20) | default `""`, **not yet a real FK** | Same live-lookup pattern as `reconciliation_entries`. |
| `description` | string(300) | default `""` | |
| `bank_account_id` | integer | FK -> `bank_accounts.id`, nullable | |
| `method` | string(40) | default `""` | |
| `amount` | float | default `0.0` | |
| `check_invoice_name` | string(200) | default `""` | |
| `bank_description` | text | default `""` | |
| `notes` | string(300) | default `""` | |
| `created_at` | datetime (tz-aware) | server default: now | |
| `split_parent_id` | integer | FK -> `accrual_entries.id` (self), nullable | Same split/undo-split mechanics as Actual. |
| `is_split` | boolean | default `false` | |
| `receipt_file_id` / `receipt_file_name` / `receipt_web_view_link` | string(200) / string(300) / text | default `""` | Same Google Drive receipt attachment as Actual. |

_No `dedup_key` or `source_run_id` - Accrual entries are always hand-entered,
never imported from an Upload run._

---

## `budget_entries`

One planned-amount line for a Budget-category account. A single account can
carry multiple lines in the same year (e.g. separate "Salary" and "Health
Insurance" lines under "Salaries and Benefits"), summed together for
reporting.

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | integer | PK, auto-increment | |
| `transaction_date` | date | nullable | Conventionally Jan 1 of the planned year - `year` is filtered from this, same as every other ledger, with no separate stored year column. |
| `account_no` | string(20) | default `""`, **not yet a real FK** | Same live-lookup pattern as the other ledgers. |
| `description` | string(300) | default `""` | |
| `amount` | float | default `0.0` | Always a plain positive number (no debit/credit sign) - Income Statement reporting takes `abs()` of actual transaction amounts to match. |
| `notes` | string(300) | default `""` | |
| `created_at` | datetime (tz-aware) | server default: now | |

_No `bank_account_id`, `method`, `reconciled`, `is_reimbursement`, split
support, or receipt fields - a planning figure isn't a real transaction._

---

_See [ARCHITECTURE.md](ARCHITECTURE.md) for how these tables relate to each
other visually, and
[issue #23](https://github.com/treasurer-cwmtc/cross-way-ledger/issues/23)
for the planned fixes to the gaps called out above (unenforced foreign keys,
the Chart of Accounts denormalization)._
