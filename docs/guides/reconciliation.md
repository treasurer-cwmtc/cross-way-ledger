# Reconciliation

*The current, recommended way to turn synced bank and Stripe activity into reconciled Actual ledger entries - a 4-step guided flow, the same reconcile/validate logic the (now-deprecated) Upload Wizard always used, just fed by the automated syncs instead of manual file uploads.*

**Required permission:** `Upload` (same backend endpoints as the wizard this replaces)

---

## The 4 steps

### 1. Date range

Shows the most recent transaction date already sitting in each staging table (`ledger_plaid`, `ledger_stripe`) - useful for judging whether a sync is even needed before picking a range. Choose a start and end date, then continue. Nothing is created yet at this point.

### 2. Sync

Two independent **Sync now** buttons - one for Stripe, one for Bank Transactions (Plaid). Either can be skipped if you already synced recently on their own pages. Note the asymmetry: **Stripe's sync respects a lookback window** (its own recent-activity re-pull, see [Stripe: Automated Transaction Sync](stripe-sync.md)), while **Plaid's sync is cursor-based** - it always catches up on everything new since its last sync, not scoped to the date range chosen in step 1 (see [Bank Transactions: Automated Chase Sync (Plaid)](bank-transactions-plaid-sync.md#how-far-back-a-connection-reaches)).

Clicking **Next: Reconcile** builds the run: it pulls whatever's now in `ledger_plaid` for the chosen date range and categorizes it - the exact same categorization step the Upload Wizard's first stage always did, just reading from the synced table instead of a freshly uploaded CSV.

### 3. Reconcile

Identical to the Upload Wizard's own Reconcile step (same component, unmodified) - matches every Stripe bank deposit found in the range to its underlying donations from `ledger_stripe`, explodes each into per-donation lines, and flags anything that couldn't be matched automatically for review.

### 4. Data validation

Identical to the Upload Wizard's own Validate step (same component, unmodified) - review totals, resolve any remaining issues, then push the reconciled lines into the [Actual ledger](ledgers.md). Already-imported transactions are automatically skipped (same dedup as everywhere else in this app), so it's safe to re-run this page over an overlapping date range without creating duplicates.

## Why the sync step doesn't create duplicates either

Both Stripe and Plaid syncs upsert by their provider's own transaction id (see [Architecture](../ARCHITECTURE.md#4d-automated-bankpayment-sync-staging-tables-stripe-plaid) for the full mechanism) - clicking Sync now here, then again later on the Stripe or Bank Transactions pages, never creates a second copy of anything.

---

*Part of the [Cross Way Ledger documentation](../README.md). See also: [Bank Reconciliation & Upload Wizard](bank-reconciliation-upload-wizard.md) (deprecated), [Stripe: Automated Transaction Sync](stripe-sync.md), [Bank Transactions: Automated Chase Sync (Plaid)](bank-transactions-plaid-sync.md), [Ledgers](ledgers.md).*
