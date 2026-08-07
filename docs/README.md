# Cross Way Ledger — Documentation

*The complete documentation set for Cross Way Ledger, Cross Way Mar Thoma Church's financial management system. Start here to find what you need.*

---

## For everyday users

Step-by-step guides for using the application — written for treasurers, bookkeepers, and campaign volunteers, not developers.

| Guide | Covers |
| --- | --- |
| **[Getting Started](guides/getting-started.md)** | Signing in, navigating the app, and the golden rule behind every number it shows |
| **[Bank Reconciliation & Upload Wizard](guides/bank-reconciliation-upload-wizard.md)** *(deprecated — hidden from nav, kept for reference)* | The 4-step wizard that turns a bank statement + Stripe export into reconciled ledger entries; being replaced by the automated Stripe/Plaid syncs below plus a new Reconciliation page ([issue #105](https://github.com/treasurer-cwmtc/cross-way-ledger/issues/105)) |
| **[Stripe: Automated Transaction Sync](guides/stripe-sync.md)** | Syncing donations/payouts directly from Stripe's API instead of a manual CSV export |
| **[Bank Transactions: Automated Chase Sync (Plaid)](guides/bank-transactions-plaid-sync.md)** | Connecting Chase via Plaid and syncing transactions automatically (currently Sandbox-only) |
| **[Ledgers: Actual, Accrual, Budget, Restricted Net Assets](guides/ledgers.md)** | The four core ledgers — editing entries, splitting lines, attaching receipts |
| **[Reporting: General Ledger & Income Statement](guides/reporting.md)** | The combined ledger view, the Plan-vs-Actual report, and exporting to Excel |
| **[Chart of Accounts & Rules](guides/chart-of-accounts-and-rules.md)** | The 3-level account hierarchy and automatic categorization rules |
| **[Pledge Campaigns](guides/pledge-campaigns.md)** | The 5-step campaign import wizard, plus the Status and Details dashboards |
| **[Donors & Link Receipts](guides/donors-and-receipts.md)** | The shared donor list and bulk-attaching receipts from Google Drive |
| **[Reimbursements](guides/reimbursements.md)** | The public submitter portal (email + one-time code login), the treasurer's review queue, and how it links to Accrual |
| **[Administration: Users, Permissions & Config](guides/administration.md)** | Adding users, granting permissions, and app-wide settings |

## For engineers & administrators

Technical reference for anyone building, deploying, or operating the system.

| Document | Covers |
| --- | --- |
| **[Architecture](ARCHITECTURE.md)** | System overview, authentication flow, request lifecycle, the full data model (with diagrams), and the deployment pipeline |
| **[Data Dictionary](DATA_DICTIONARY.md)** | Every table and column, in plain language, plus the reporting views exposed to BI tools |
| **[Deployment Guide](DEPLOYMENT.md)** | Standing up and operating the Google Cloud infrastructure — Cloud Run, Cloud SQL, CI/CD, backups, and access control |
| **[Project Knowledge Base](PROJECT.md)** | Business logic, feature history, and the reasoning behind non-obvious design decisions |
| **[Engineering Log](STATUS.md)** | A running record of what's been built, tested, and verified — read this first when resuming development |

---

## How this documentation is organized

**User guides** describe *what you can do and how to do it*, from inside the app itself — no knowledge of databases, code, or cloud infrastructure required. **Technical reference** describes *how the system is built and operated* — the audience there is a developer or system administrator.

If you're not sure where to start:

- New user, first day on the job → **[Getting Started](guides/getting-started.md)**.
- Something looks wrong and you need to understand where a number comes from → the relevant user guide above, or the **[Data Dictionary](DATA_DICTIONARY.md)** for the exact underlying table.
- You're setting up or troubleshooting the infrastructure itself → **[Deployment Guide](DEPLOYMENT.md)**.
- You're picking up development work → **[Engineering Log](STATUS.md)**, then **[Architecture](ARCHITECTURE.md)**.

---

*Back to the [project root](../README.md).*
