# Bank Transactions: Automated Chase Sync (Plaid)

*How the Bank Transactions page connects to Chase via Plaid, what "Connect bank" and "Sync now" actually do, and why this is currently sandbox-only.*

**Required permission:** `Bank Transactions`

---

## What this page is

Bank Transactions is the Chase equivalent of the [Stripe page](stripe-sync.md): a staging area that pulls your Chase transactions automatically, via [Plaid](https://plaid.com) (a bank-data connector — Chase doesn't offer a self-serve API of its own), instead of you exporting and uploading a CSV by hand. It stores data in exactly the same column shape as a manually-exported Chase CSV, so it can eventually feed the same reconciliation pipeline the [Upload Wizard](bank-reconciliation-upload-wizard.md) already uses for a manual bank file. Like the Stripe page, nothing here touches the permanent ledger by itself — reconciling against the bank statement is still a separate step.

**⚠️ Currently Sandbox only.** The app is configured against Plaid's Sandbox environment — a fully simulated set of fake banks and fake transactions, with no connection to any real financial institution and no real Plaid billing. This lets the whole Connect → Sync flow be built and verified end-to-end before your real Chase account is ever involved. See [issue #103](https://github.com/treasurer-cwmtc/cross-way-ledger/issues/103) for the plan to move to Production once a real Plaid pricing quote comes back under the church's cost threshold.

## Connecting a bank account

Click **Connect bank**. This opens Plaid's own secure widget (called "Link") — you never type your Chase username or password into Cross Way Ledger itself; Plaid handles the login directly with Chase (or, in Sandbox, a simulated login) and only ever hands the app a tokenized reference to the account, never your real credentials.

**This is a one-time setup, not something every user does.** Once someone with access to this page connects the account, the connection is stored for the whole app — everyone with the "Bank Transactions" permission then just sees the already-connected account and clicks Sync now. Nobody needs to log into Chase (or Plaid) again unless the connection itself breaks (e.g. Chase requires re-authentication after a password change or an expired consent) — a rare maintenance event, not routine use.

## Syncing data

- **Sync now** pulls new and changed transactions since the last sync, using Plaid's cursor-based sync — it always resumes exactly where the last sync left off, rather than re-scanning a fixed date window like Stripe's does.
- **Last refreshed**, right-aligned in the toolbar, shows how long ago the most recent sync finished.
- A sync message below the toolbar confirms what happened (e.g. *"Synced 49 transactions (49 new, 0 updated, 0 removed)"*). A transaction that's later retracted by the bank (e.g. a pending charge that never posted) is flagged as removed rather than deleted outright, so it disappears from the normal view but isn't silently erased from history.
- **Disconnect**, next to the connected institution's name, removes the connection — this actually calls Plaid's API to release the connection, not just deletes the local record, which matters because Plaid keeps billing for a connection it still considers active even if the app stops calling it.

## Browsing the table

Same interaction pattern as every other table in the app and the Stripe page specifically: every column is sortable, most are filterable via the funnel icon, and clicking a row opens a read-only detail view with every field Plaid provided.

## A note on the numbers

Plaid's own sign convention is the opposite of every other page in this app (Plaid: positive = money leaving the account). The sync normalizes this automatically on the way in, so a deposit always shows as positive here, exactly like every other ledger and the Stripe page — you never need to think about Plaid's convention.

## What's next

Wiring this staging table into the Upload Wizard, so it becomes a true reconciliation source alongside Stripe instead of a separate page you browse independently, is deliberately deferred until the Connect/Sync flow above has proven itself — see [issue #105](https://github.com/treasurer-cwmtc/cross-way-ledger/issues/105).

---

*Part of the [Cross Way Ledger documentation](../README.md). See also: [Stripe: Automated Transaction Sync](stripe-sync.md), [Bank Reconciliation & Upload Wizard](bank-reconciliation-upload-wizard.md).*
