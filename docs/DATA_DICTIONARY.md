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

## `chartofaccounts_statement_categories`

Level 1 of the Chart of Accounts hierarchy, scoped to a Type.

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | integer | PK, auto-increment | |
| `category` | string(20) | NOT NULL | One of `Budget`, `Expense`, `Income`. |
| `no` | string(2) | UK with `category` | 2-digit code, auto-incrementing *within its Type* and never reused, even after a delete - true identity-column semantics, not gap-filling. |
| `name` | string(120) | NOT NULL | e.g. "Property", "Income". |

---

## `chartofaccounts_statement_items`

Level 2 - children of a Statement Category.

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | integer | PK, auto-increment | |
| `statement_category_id` | integer | FK -> `chartofaccounts_statement_categories.id`, NOT NULL | |
| `no` | string(2) | UK with `statement_category_id` | Auto-increments within its parent category, never reused. |
| `name` | string(120) | NOT NULL | e.g. "Storage Unit" under the "Property" category. |

---

## `chartofaccounts`

Level 3 / the leaf - one row per actual account. This is what every ledger
entry ultimately categorizes against.

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `account_no` | string(20) | PK | Derived, never hand-typed: `<TypePrefix><CategoryNo><ItemNo><DetailNo>` (Type prefix is B/E/I). See `backend/app/services/coa_numbering.py`. |
| `statement_item_id` | integer | FK -> `chartofaccounts_statement_items.id`, NOT NULL | |
| `category` | string(50) | NOT NULL | Copy of the Type (Budget/Expense/Income) for convenient reads. |
| `statement_category` / `statement_category_no` | *(not a column)* | derived | Read-only Python properties, not stored - derived live from `parent_item.statement_category` on every read, so they can never drift out of sync with the Chart of Accounts hierarchy. |
| `statement_item` / `statement_item_no` | *(not a column)* | derived | Same pattern, one level up - derived live from `parent_item`. |
| `statement_detail` | string(120) | default `""` | The Detail level's own name - optional ("no subdivision" account when blank). |
| `statement_detail_no` | string(2) | default `""` | Auto-increments within its parent Statement Item, never reused. |
| `statement_description` | string(300) | NOT NULL | Human-readable full label, auto-built from the chain unless overridden. |
| `is_tax_deductible` | string(10) | default `""` | Free-text Yes/No flag (not a real boolean - matches the legacy sheet's format). |
| `is_mandatory` | string(10) | default `""` | Same free-text Yes/No pattern. |
| `grouping` | string(120) | default `""` | An additional reporting grouping label, independent of the Category/Item/Detail hierarchy. |
| `is_youth_chaplain_share` | string(10) | default `""` | Free-text Yes/No flag. |
| `is_missions` | string(10) | default `""` | Free-text Yes/No flag. |

---

## `upload_rules`

User-editable rules that auto-categorize a line during Upload.

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | integer | PK, auto-increment | |
| `rule_type` | string(20) | indexed, NOT NULL | `bank_keyword` (matches a bank line's Description) or `stripe_fund` (matches a Stripe donation's fund name). |
| `pattern` | string(200) | NOT NULL | The text to match against. |
| `account_no` | string(20) | FK -> `chartofaccounts.account_no`, NOT NULL | The account to assign on a match. |
| `priority` | integer | default `100` | Lower number wins when multiple rules match the same line. |
| `active` | boolean | default `true` | Inactive rules are ignored during categorization but kept for reference. |
| `created_at` | datetime (tz-aware) | server default: now | |

---

## `ledger_bank_accounts`

Named bank account lookup (e.g. "Chase Operating").

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | integer | PK, auto-increment | |
| `name` | string(120) | UK, NOT NULL | |
| `active` | boolean | default `true` | |

---

## `transactions_stripe`

Staged Stripe balance-transaction data, pulled automatically via the Stripe
API (the "Sync now" button on the [Stripe page](guides/stripe-sync.md), or a
future nightly scheduled job - see [issue #100](https://github.com/treasurer-cwmtc/cross-way-ledger/issues/100)).
The automated counterpart to a manually-uploaded Stripe CSV - shaped to
match that CSV's own parsed row (`StripeRow` in
`backend/app/services/parsers.py`) column-for-column, not Stripe's raw API
field names, so it can feed the same Upload Wizard reconciliation step a
manual CSV always has (see [issue #105](https://github.com/treasurer-cwmtc/cross-way-ledger/issues/105)).
A pure staging table - nothing here touches a real ledger by itself.

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `stripe_id` | string(60) | PK | Stripe's own transaction id - re-syncing the same transaction upserts in place rather than duplicating. |
| `type` | string(20) | default `""` | `payout`, `payment`, `charge`, etc. |
| `source` | string(60) | default `""` | The underlying Stripe object id (`py_...`/`ch_...`/`po_...`). |
| `amount` | float | default `0.0` | |
| `fee` | float | default `0.0` | Stripe's processing fee. |
| `net` | float | default `0.0` | `amount` minus `fee` - what actually settles. |
| `created` | string(20) | default `""` | Plain date string (`M/D/YYYY`), matching the manual CSV's format - not a real `Date` column, same convention as `upload_lines`. |
| `description` | string(300) | default `""` | Includes the donor/fund text the reconciler parses out (e.g. `"Donation #999 - Jane Doe - Pledges ($100.30)"`). |
| `transfer` | string(60) | default `""` | The payout id a donation was swept into - groups individual donations under their payout. |
| `transfer_date` | string(20) | default `""` | |
| `fund` | string(120) | default `""` | Parsed from `description`/metadata. For a gift split across multiple funds in one checkout, this is a comma-joined display list (e.g. `"Building Fund, General Missions"`) - see `fund_breakdown_json` for the real per-fund data used to categorize/post it. |
| `donor` | string(160) | default `""` | Parsed from `description`. |
| `fund_breakdown_json` | text | default `""` | JSON list of `[fund name, dollar amount]` pairs when a donation is split across multiple funds (from Planning Center's `planning_center_context` Stripe metadata) - empty for an ordinary single-fund donation. Drives the reconciler splitting a split-gift's net amount proportionally across each fund's own account instead of posting it all to one (see [issue #124](https://github.com/treasurer-cwmtc/cross-way-ledger/issues/124)). |
| `synced_at` | datetime (tz-aware) | server default: now, updates on write | When this row was last pulled from Stripe. |

---

## `transactions_bank_items`

One connected bank login ("Item," in Plaid's terminology) - created once
when someone completes the Plaid Link flow on the
[Bank Transactions page](guides/bank-transactions-plaid-sync.md). Holds the
long-lived credential every subsequent sync needs, and the cursor that lets
`transactions/sync` fetch only what changed since last time instead of
re-scanning everything.

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | integer | PK, auto-increment | |
| `item_id` | string(60) | UK, indexed | Plaid's own identifier for this connection. |
| `access_token` | string(200) | NOT NULL | The real, long-lived credential that authorizes every sync - per-connection user data, not a static app secret, so it lives here (protected the same way the rest of the database is - Cloud SQL IAM auth, encryption at rest, backups) rather than in Secret Manager. |
| `institution_name` | string(120) | default `""` | e.g. "Chase" - shown in the UI's connected-accounts list. |
| `cursor` | text | nullable | Plaid's resume point for `transactions/sync` - `NULL` until the first sync. |
| `created_at` | datetime (tz-aware) | server default: now | |

---

## `transactions_bank`

Staged Chase bank transaction data, pulled automatically via the Plaid API
(the "Sync now" button on the [Bank Transactions page](guides/bank-transactions-plaid-sync.md)).
Deliberately shaped to match a manually-exported Chase CSV's own columns
(`BankRow` in `backend/app/services/parsers.py` -
`details`/`posting_date`/`description`/`amount`/`type`) rather than Plaid's
own field names, for the same reason as `transactions_stripe` above. `amount` is
normalized to this app's own convention (positive = deposit) even though
Plaid's own sign convention is the opposite.

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `plaid_transaction_id` | string(60) | PK | Plaid's own transaction id - repeated syncs upsert cleanly. |
| `item_id` | string(60) | FK -> `transactions_bank_items.item_id`, indexed | Which connection this transaction came from. |
| `account_id` | string(60) | default `""` | Which linked account under that connection (a Plaid Item can cover multiple accounts). |
| `details` | string(20) | default `""` | `DEBIT` or `CREDIT` - derived from `amount`'s sign after normalization, since Plaid doesn't expose Chase's own internal type codes. |
| `posting_date` | string(20) | default `""` | Plain date string (`M/D/YYYY`), matching the manual CSV's format - not a real `Date` column. |
| `description` | string(300) | default `""` | |
| `amount` | float | default `0.0` | Positive = deposit (normalized on ingest - see above). |
| `type` | string(60) | default `""` | Plaid's best-effort spending category (e.g. `FOOD_AND_DRINK`) - not a byte-for-byte match to what Chase's own CSV export would say here, just the closest equivalent Plaid's categorization gives. |
| `pending` | boolean | default `false` | |
| `removed` | boolean | default `false` | Set (not deleted) if Plaid later retracts a transaction it previously reported - e.g. a pending charge that never posted. Preserves history rather than silently erasing it. |
| `synced_at` | datetime (tz-aware) | server default: now, updates on write | |

---

## `upload_runs`

One Upload wizard run - the *ephemeral preview*, not the persistent ledger.
Pushing a run into Actual creates `ledger_actual` rows separately.

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

## `upload_lines`

One output line of a run - a per-donation breakout line or a categorized
non-Stripe bank line. Deleted along with its parent run (cascade).

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | integer | PK, auto-increment | |
| `run_id` | integer | FK -> `upload_runs.id`, indexed, NOT NULL | |
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

## `ledger_actual`

The persistent, editable **Actual** ledger. Created by importing a
completed Upload run (deduped via `dedup_key`), then freely hand-edited.

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | integer | PK, auto-increment | |
| `transaction_date` / `date_posted` | date | nullable | Real `Date` columns (unlike `upload_lines`). |
| `reconciled` | boolean | default `false` | Manually checked off once verified against the bank statement. |
| `is_reimbursement` | boolean | default `false` | |
| `account_no` | string(20) | FK -> `chartofaccounts.account_no`, nullable | The only source of truth for this entry's categorization - Statement Description and every Chart-of-Accounts-derived column shown in the UI are looked up live from this, never stored, so they can't drift. Nullable = uncategorized; the API still sends/accepts `""` for that state, normalized to `NULL` on write by a shared validator (`models.py::_normalize_account_no`) and coerced back to `""` on read. |
| `description` | string(300) | default `""` | |
| `bank_account_id` | integer | FK -> `ledger_bank_accounts.id`, nullable | |
| `method` | string(40) | default `""` | |
| `amount` | float | default `0.0` | |
| `check_invoice_name` | string(200) | default `""` | Also auto-filled with a receipt's filename when one is attached. |
| `bank_description` | text | default `""` | Original, unedited bank statement text. |
| `notes` | string(300) | default `""` | |
| `dedup_key` | string(300) | UK, indexed, NOT NULL | Built from date + amount + reference/description - blocks re-importing the same statement twice. |
| `source_run_id` | integer | FK -> `upload_runs.id`, nullable | Which Upload run this entry was imported from, if any. |
| `created_at` | datetime (tz-aware) | server default: now | |
| `split_parent_id` | integer | FK -> `ledger_actual.id` (self), nullable | If this row is a child of a split, points at the original. |
| `is_split` | boolean | default `false` | `true` on the *original* row once it's been split - hides it from the normal list (its `dedup_key` still blocks re-import) in favor of its visible child rows. |
| `receipt_file_id` | string(200) | default `""` | Google Drive file id, if a receipt is attached. |
| `receipt_file_name` | string(300) | default `""` | |
| `receipt_web_view_link` | text | default `""` | Opens the file directly in Drive. |

---

## `ledger_accrual`

The persistent, editable **Accrual** ledger - same shape as
`ledger_actual` minus the fields that only make sense for an
imported bank transaction.

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | integer | PK, auto-increment | |
| `transaction_date` / `date_posted` | date | nullable | |
| `reconciled` | boolean | default `false` | |
| `is_reimbursement` | boolean | default `false` | |
| `account_no` | string(20) | FK -> `chartofaccounts.account_no`, nullable | Same live-lookup and `""`/`NULL` normalization pattern as `ledger_actual`. |
| `description` | string(300) | default `""` | |
| `bank_account_id` | integer | FK -> `ledger_bank_accounts.id`, nullable | |
| `method` | string(40) | default `""` | |
| `amount` | float | default `0.0` | |
| `check_invoice_name` | string(200) | default `""` | |
| `bank_description` | text | default `""` | |
| `notes` | string(300) | default `""` | |
| `created_at` | datetime (tz-aware) | server default: now | |
| `split_parent_id` | integer | FK -> `ledger_accrual.id` (self), nullable | Same split/undo-split mechanics as Actual. |
| `is_split` | boolean | default `false` | |
| `receipt_file_id` / `receipt_file_name` / `receipt_web_view_link` | string(200) / string(300) / text | default `""` | Same Google Drive receipt attachment as Actual. |

_No `dedup_key` or `source_run_id` - Accrual entries are always hand-entered,
never imported from an Upload run._

---

## `ledger_budget`

One planned-amount line for a Budget-category account. A single account can
carry multiple lines in the same year (e.g. separate "Salary" and "Health
Insurance" lines under "Salaries and Benefits"), summed together for
reporting.

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | integer | PK, auto-increment | |
| `transaction_date` | date | nullable | Conventionally Jan 1 of the planned year - `year` is filtered from this, same as every other ledger, with no separate stored year column. |
| `account_no` | string(20) | FK -> `chartofaccounts.account_no`, nullable | Same live-lookup and `""`/`NULL` normalization pattern as the other ledgers. |
| `description` | string(300) | default `""` | |
| `amount` | float | default `0.0` | Always a plain positive number (no debit/credit sign) - Income Statement reporting takes `abs()` of actual transaction amounts to match. |
| `notes` | string(300) | default `""` | |
| `created_at` | datetime (tz-aware) | server default: now | |

_No `bank_account_id`, `method`, `reconciled`, `is_reimbursement`, split
support, or receipt fields - a planning figure isn't a real transaction._

---

## `ledger_restrictednetassets`

One permanent reclassification between two Chart-of-Accounts lines - not a
placeholder awaiting a bank transaction (unlike Accrual), the transfer *is*
the economic event. Stored as a single row with both legs; General Ledger
synthesizes the two per-account lines from it at read time.

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | integer | PK, auto-increment | |
| `transaction_date` | date | nullable | |
| `from_account_no` | string(20) | FK -> `chartofaccounts.account_no`, nullable | The account money moves out of. |
| `to_account_no` | string(20) | FK -> `chartofaccounts.account_no`, nullable | The account money moves into. |
| `amount` | float | default `0.0` | |
| `description` | string(300) | default `""` | |
| `notes` | string(300) | default `""` | |
| `created_at` | datetime (tz-aware) | server default: now | |

---

## `ledger_assets`

A simple, standalone equipment/inventory reference list - mirrors the
treasurer's existing "Equipment List" Google Sheet. Deliberately **not**
linked to Chart of Accounts or General Ledger; a purchase is recorded
separately (in Actual/Accrual) when bought, this table just tracks what's
actually owned. `category` is free text with a frontend typeahead of
previously-used values, not a fixed enum. See issue #113.

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | integer | PK, auto-increment | |
| `purchase_date` | date | nullable | |
| `category` | string(120) | default `""` | Free text - e.g. Audio, Video, Network, Kitchen, Portable, Parsonage, Computer, matching the source sheet's real-world usage. |
| `item` | string(300) | default `""` | |
| `count` | integer | default `1` | |
| `cost` | float | default `0.0` | Per-item cost. |
| `notes` | text | default `""` | |
| `receipt_file_id` / `receipt_file_name` / `receipt_web_view_link` | string(200) / string(300) / text | default `""` | Same Google Drive receipt attachment shape as Actual/Accrual - picked into a new "Asset Library" folder sitting directly under Drive's root (no year subfolder, since equipment isn't "per fiscal year" the way a transaction is). |
| `created_at` | datetime (tz-aware) | server default: now | |

_No `total` column - like every other computed field in this schema, it's
derived live (`count x cost`) rather than stored._

---

## Pledge Campaigns domain

| Table | Was | Purpose |
| --- | --- | --- |
| `campaign` | `pledge_campaigns` | One row per fundraising campaign (goal, starting balance, which `fund` it tracks). |
| `campaign_donors` | `donors` | The persistent Giving App donor list, reusable across campaigns. |
| `campaign_pledge_submissions` | `pledges` | One row per pledge form submission against a campaign. |
| `campaign_pledge_matches` | `pledge_donor_matches` | Links a pledge submission to a donor (auto or manual). |
| `campaign_donations` | `donations` | The Giving App's full donation export - not scoped to any one campaign; a campaign just claims a `fund` value. |

See `backend/app/models.py` for full column definitions - unchanged other
than table names and the FKs that follow them (`campaign.id`,
`campaign_donors.donor_id`, `campaign_pledge_submissions.id`).

---

## Reporting views (`reporting` schema)

One read-only view, standardized for external BI tools (Looker Studio,
Google Sheets) - see the "rename tables to standardized names" migration.
It lives in a dedicated `reporting` Postgres schema (not `public`), which
is what lets a BI-facing view reuse a table's name in the future without
colliding with it.

Every other page reads straight from its own real table (`ledger_actual`,
`ledger_accrual`, `ledger_budget`, `ledger_restrictednetassets`,
`chartofaccounts`, `campaign_pledge_submissions`, `campaign_donations`) -
those don't need a separate reporting view now that the tables themselves
carry clean, standardized names. The one exception is General Ledger,
which is a genuine UNION across 4 different ledger tables with no
single-table equivalent.

| View | Backs |
| --- | --- |
| `reporting.vw_ledger_generalledger` | General Ledger page (union of `ledger_actual`, `ledger_accrual`, `ledger_budget`, `ledger_restrictednetassets`) |

The `ledger_reporting` Postgres role has its `search_path` set to prefer this
schema, so unqualified queries from a BI tool resolve here without a schema
prefix.

---

_See [ARCHITECTURE.md](ARCHITECTURE.md) for how these tables relate to each
other visually. All foreign keys shown above are real, enforced database
constraints (Postgres enforces these natively - see
[ARCHITECTURE.md](ARCHITECTURE.md) for why every environment runs the same
database engine). Schema changes are applied via Alembic migrations
(`backend/alembic/versions/`), not hand-written `ALTER TABLE` statements -
see [DEPLOYMENT.md](DEPLOYMENT.md#7-database-migrations)._
