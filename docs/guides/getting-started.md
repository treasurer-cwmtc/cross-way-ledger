# Getting Started

*A five-minute orientation to Cross Way Ledger — what it does, how the navigation is organized, and what you can expect to see the first time you sign in.*

---

## What this application does

Cross Way Ledger is the church's system of record for **giving, expenses, budgeting, and pledge campaigns**. It replaces the manual spreadsheet workflow that used to reconcile bank statements against Stripe donations by hand, and it gives every staff member and volunteer a single, permission-controlled place to work — instead of emailing spreadsheets around.

At a glance, it handles:

| Area | What it's for |
| --- | --- |
| **Actual, Accrual, Budget, Restricted Net Assets** | The four ledgers that make up the church's books |
| **General Ledger, Income Statement** | Reporting views built on top of those ledgers |
| **Chart of Accounts, Rules** | How every transaction gets categorized |
| **Pledge Campaigns** | Tracking a fundraising campaign's pledges against actual giving |
| **Link Receipts, Giving App - Donors** | Supporting tools for audit trail and donor lookups |
| **Users, Config** | Administration — who can see what, and app-wide settings |

## Signing in

Go to the app's URL and sign in one of two ways:

- **Username and password** — for accounts an administrator created directly.
- **Sign in with Google** — for `@crosswaymtc.org` Google Workspace accounts an administrator has pre-approved. If your email hasn't been added to the **Users** page first, Google sign-in will be rejected even though your Google login itself succeeded — this is intentional (see [Administration](administration.md)).

Once signed in, you stay signed in until you explicitly log out or your session token expires.

## Finding your way around

The left-hand navigation is grouped into sections that mirror how the church actually thinks about its finances:

- **Overview** — Home (a dashboard) and Upload (the bank reconciliation wizard).
- **Ledgers** — Actual, Accrual, Budget, Restricted Net Assets.
- **Reporting** — General Ledger, Income Statement.
- **Pledge Campaigns** — Campaign Status, Import Campaigns.
- **Setup** — Rules, Chart of Accounts, Link Receipts.
- A few standalone items lower in the menu: **Giving App - Donors**, **Config**, **Users**.

You will only see the items you've been granted access to — an administrator controls this per user on the **Users** page. If a page you expect to see is missing, ask an administrator to check your permissions.

## The golden rule: every number traces back to a real transaction

Nothing in this app is a manual override sitting on top of a spreadsheet. Every dollar shown anywhere — the General Ledger, the Income Statement, a campaign's "Received Amount" — is computed live from the underlying ledger entries at the moment you load the page. If a number looks wrong, the fix is always to correct the underlying entry (or its categorization), never to edit a total directly, because there is no "total" to edit — it's always a live calculation.

## Where to go next

- New to reconciling bank statements? Start with the **[Bank Reconciliation & Upload Wizard](bank-reconciliation-upload-wizard.md)**.
- Need to record an expense that hasn't hit the bank yet, or check the annual plan? See **[Ledgers: Actual, Accrual, Budget, Restricted Net Assets](ledgers.md)**.
- Running a fundraising campaign? See **[Pledge Campaigns](pledge-campaigns.md)**.
- Setting up a new account code or an auto-categorization rule? See **[Chart of Accounts & Rules](chart-of-accounts-and-rules.md)**.
- Managing who can see what? See **[Administration: Users, Permissions & Config](administration.md)**.

---

*Part of the [Cross Way Ledger documentation](../README.md).*
