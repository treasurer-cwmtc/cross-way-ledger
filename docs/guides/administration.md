# Administration: Users, Permissions & Config

*Managing who can sign in, what they can see, and the app-wide settings that only need attention a few times a year.*

**Required permission:** admin only (this entire area is invisible to non-admin users)

---

## Adding a user

On the **Users** page, choose the account type:

- **Local (username/password)** — enter a **Username** and a **Password** (minimum 8 characters), then click **Add user**.
- **Google sign-in** — enter the person's **Google account** (their `@crosswaymtc.org` email), then click **Add user**. This pre-approves that email to sign in with Google; the account isn't usable until they actually complete the Google sign-in flow themselves.

> **Google accounts must be pre-added here before that email can sign in** — an unrecognized email is rejected at login, even if the underlying Google authentication succeeded. This is a deliberate safeguard, not a bug.

The users table shows every account's username, email, admin status, active status, and creation date. Use **Deactivate** to disable an account without deleting its history — a deactivated user can no longer log in. You can't deactivate your own account, and you can't strip your own admin access, so there's always at least one way back in.

## Permissions

Select a user, then either:

- Check **Admin (full access to everything, including this page)** — admins bypass every individual permission check and always see every page, including this one.
- Or leave Admin unchecked and grant individual pages instead, from this exact list:

| Permission | Grants access to |
| --- | --- |
| Upload | The bank reconciliation wizard |
| Actual | The Actual ledger |
| Accrual | The Accrual ledger |
| Budget | The Budget ledger |
| Restricted Net Assets | The Restricted Net Assets ledger |
| General Ledger | The combined ledger report |
| Income Statement | The Plan vs. Actual report |
| Rules | Categorization rules |
| Chart of Accounts | The account hierarchy |
| Link Receipts | Bulk receipt attachment |
| Config | App-wide settings |
| Campaign Status | The campaign dashboard |
| Campaign Details | The row-level pledge/giving table (checking this one box grants both the underlying pledge and actual-giving permissions at once) |
| Giving App - Donors | The shared donor list |

There's also a standalone toggle, independent of every permission above:

- **Hide donor names** — redacts donor names and emails on the Campaign Details page for this specific user, showing only Donor ID / Joint Donor ID instead. This is a *restriction*, not a grant: it applies even if the user is also an admin, and it only affects that one page — nothing else about their access changes.

Click **Save permissions** to apply your changes.

## Config

App-wide settings the treasurer adjusts by hand — nothing here is derived from today's real date, so it's your responsibility to update it at the right time (typically once a year, at fiscal year rollover).

- **Fiscal year (CY / PY)** — set the **Current Year Date**. Every date after it counts as the "current year" throughout the app (the Txn CY/PY and Posted CY/PY columns on Actual and Accrual); everything before it is "prior year." The Prior Year Date, Current Year, and Prior Year fields update automatically once you save.
- **Frequency** — how many periods per year (Monthly, Yearly, Quarterly), matching the legacy spreadsheet's frequency lookup table.
- **Audit validation** — a From/To date range for spot-checking a specific stretch of transactions. This is independent of the fiscal year setting above — set it to whatever range you're currently auditing.
- **Bank accounts** — the list of accounts available to tag when uploading a bank statement on the Upload tab. Add a new one by name, or delete one that's no longer in use.

---

## Tips

- **Set up permissions role-by-role, not person-by-person**, if your staff turns over — decide once what a "bookkeeper" or "campaign volunteer" should see, then replicate that same set of checkboxes for each new person in that role.
- **The Current Year Date is the single most impactful setting on this page** — it drives fiscal-year filtering across Actual, Accrual, and every date-part column built from them. Get in the habit of updating it at the same time every year (e.g. January 1st), rather than waiting until a report looks wrong.

---

*Part of the [Cross Way Ledger documentation](../README.md).*
