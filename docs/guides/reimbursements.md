# Reimbursements

*How church members submit reimbursement requests through a public portal, how the treasurer reviews and pays them, and how that connects to the Accrual ledger.*

**Required permission (treasurer side):** `Reimbursements`
**Submitter side:** no app account needed - a separate public portal with its own login

---

## Two separate sides, two separate logins

Reimbursements has two audiences that never share a session:

- **The treasurer-side queue** (`Reimbursements` in the main app sidebar) - reviews requests, approves/pays/rejects, manages who's allowed to submit against which accounts. Gated by the normal `Reimbursements` permission like every other page.
- **The public submitter portal**, at `/reimbursements/portal` - a completely separate mini-app with no shared navigation, login, or session with the rest of Cross Way Ledger. This is deliberate: the people submitting reimbursements are often not `crosswaymtc.org` Google accounts, so they get their own lightweight login instead of a real user account.

## How a submitter logs in

The portal login is **email + a one-time code**, not a password:

1. Enter your email and request a code.
2. Check your email for a 10-minute, single-use code (sent from `noreply@crosswaymtc.org`).
3. Enter it to get in.

Your email must already appear in the church's **Planning Center (PCO) People** export (imported by the treasurer beforehand) - this is the login allowlist. If your email isn't recognized, the response is deliberately vague ("if this email is registered, a code has been sent") rather than confirming or denying membership - this avoids turning the login form into a way to check who is or isn't in the church's records. If you're sure you should have access and it's not working, contact the treasurer directly rather than retrying.

Being able to log in doesn't automatically mean you can submit anything yet - see the next section.

## Getting authorized to submit

Logging in only proves who you are. Separately, the **treasurer has to pre-authorize** which Chart-of-Accounts lines you're allowed to submit reimbursements against (e.g. "Youth Ministry Supplies," "Building Maintenance"). This is managed from the treasurer-side Reimbursements page:

- **Import PCO People** - upload the church's Planning Center People export (the login allowlist).
- **Assignments** - pick a person's email and check which accounts they're allowed to submit against. An email that doesn't match any imported PCO record is rejected here too, to catch typos before they become an access problem.

A logged-in submitter with zero assignments sees an empty account picker in the wizard and can't submit anything - the treasurer gets a one-time notification email the first time this happens for a given person, so it doesn't go unnoticed.

## Submitting a request

From the portal, start a new request:

1. **Add line items** - for each expense: pick one of your authorized accounts, an amount, a description, the date the expense was actually incurred, and attach a receipt (uploaded directly to the church's Google Drive - you don't need a Google account of your own for this).
2. **Review** - see every line and the total before submitting.
3. **Submit** - creates the request (status **Pending**) and emails both you and the treasurer a copy of exactly what was submitted.

A request's name defaults to `<your email>-<timestamp>`, but you can rename it to something more memorable while it's still Pending.

**Submitting immediately creates a matching entry on the [Accrual ledger](ledgers.md)** for each line - an Accrual entry already means "a real expense has been incurred, not yet paid," which is exactly what a freshly-submitted request is. This is what makes the request visible to the treasurer everywhere Accrual shows up, not just in the Reimbursements queue.

## Editing or checking on a request

While a request is **Pending**, you can go back into the portal and edit it - lines, amounts, receipts, the name. Once the treasurer marks it **Paid** or **Rejected**, it's locked - you can still view it, but not change it.

One exception: if the treasurer has already reconciled one of your request's Accrual entries against a real bank transaction, editing is blocked (409 error) even while technically still Pending - a submitter's late edit shouldn't be able to silently undo work the treasurer already did matching it to the bank statement. Contact the treasurer directly in that case.

## The treasurer's review queue

The treasurer-side Reimbursements page lists every request, filterable by status. Opening one shows the full detail - every line, every receipt, the submitter's info - with **Notes** (visible to the submitter) and a status control.

### Status lifecycle: Pending → Paid or Rejected

There's no separate "Approved" step - **Paid *is* the approval**. A treasurer who finds a problem with a request simply doesn't pay it, and Rejects instead. Both Paid and Rejected are terminal (a decided request can't be reopened by the submitter).

- **Rejecting** a request deletes its linked Accrual entries - the expense never happened financially, so the placeholder for it goes away too. Notify the submitter with the reason via Notes; they get an automatic email with your notes attached.
- **Marking Paid** stamps a paid date and marks the linked Accrual entries as posted (ready to be matched against the actual bank transaction once it clears, via [Reconcile against Accrual](ledgers.md#reconciling-an-actual-line-against-accrual-entries)).

Every status change emails the submitter automatically, including your Notes.

## How this connects to the rest of the app

- **Accrual** is the live link - every reimbursement line has a matching Accrual entry from the moment it's submitted until it's Paid or Rejected. If you're trying to trace where an Accrual entry with `is_reimbursement = true` came from, this is it.
- **Receipts** land in the same Google Drive folder tree the rest of the app uses for bank/Stripe uploads and campaign imports (`<root>/<year>/Reimbursements/<submitter_email>/...`) - see [Donors & Link Receipts](donors-and-receipts.md) for how receipts work elsewhere in the app.
- **Home dashboard** shows an "Outstanding Reimbursements" card (count + total of everything still Pending or awaiting payment), so the treasurer doesn't have to open the queue just to see if anything's waiting.

---

*Part of the [Cross Way Ledger documentation](../README.md). See also: [Ledgers](ledgers.md), [Donors & Link Receipts](donors-and-receipts.md), [Administration](administration.md).*
