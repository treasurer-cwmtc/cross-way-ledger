# Architecture

_How Cross Way Ledger is put together: the layers, how a user gets signed in,
how a request flows from click to database and back, and the full table
diagram. Diagrams are [Mermaid](https://mermaid.js.org/) - GitHub renders
them automatically right here, no extra tool needed._

---

## 1. System overview

```mermaid
%%{init: {"themeVariables": {"fontSize": "20px"}, "flowchart": {"nodeSpacing": 50, "rankSpacing": 70}}}%%
flowchart LR
    User(["Treasurer / Staff"])

    subgraph App["Cross Way Ledger"]
        direction LR
        FE["Frontend\nReact + Vite"]
        BE["Backend API\nFastAPI"]
        DB[("Database\nSQLite / Postgres")]
        FE --> BE --> DB
    end

    Google["Google\nSign-In + Drive"]

    User --> FE
    FE --> Google
    BE --> Google
```

- **Frontend** - a single-page React app. Holds the login session, calls the
  backend, and is the only place that talks to Google's Sign-In and Drive
  Picker UI directly.
- **Backend** - one FastAPI process. Every route sits behind an auth check
  before it touches the database.
- **Database** - SQLite locally, PostgreSQL in production - same code either
  way.
- **Google** - verifies who's signing in, and stores receipt files (the app
  never sees a Google password or keeps a copy of the file itself).

- The **frontend** is a single-page React app (no server-side rendering) -
  it talks to the backend purely over `fetch()` calls to `/api/...`, carrying
  a JWT in the `Authorization: Bearer` header once signed in. It's also the
  *only* place that talks to Google's Sign-In and Drive Picker UI directly -
  the backend never sees a Google password, only a token to verify.
- The **backend** is one FastAPI process. Every route is grouped into a
  router file (`app/routers/*.py`), each guarded by an auth dependency
  before it touches the database.
- The **database** is SQLite for local development (`recon.db`, zero setup)
  and PostgreSQL in production (`docker-compose.yml` provisions it) - the
  same SQLAlchemy models work against either.
- **Google** is only ever talked to directly by the browser (Sign-In button,
  Drive file picker) or by the backend for two narrow purposes: verifying a
  Google Sign-In token really came from Google, and creating/finding the
  dated Drive folder receipts get filed under. The app never stores a
  Google password or a long-lived Drive credential - see the receipt
  attachment flow in `docs/PROJECT.md`.

---

## 2. Authentication - two ways in, one session afterward

```mermaid
%%{init: {"themeVariables": {"fontSize": "18px"}}}%%
sequenceDiagram
    actor U as User
    participant FE as Frontend
    participant BE as Backend
    participant G as Google
    participant DB as Database

    rect rgb(235, 245, 255)
    note over U,DB: Username / password
    U->>FE: enters username + password
    FE->>BE: POST /api/auth/login
    BE->>DB: verify password hash
    BE-->>FE: JWT
    end

    rect rgb(235, 255, 240)
    note over U,DB: Sign in with Google
    U->>FE: clicks "Sign in with Google"
    FE->>G: opens Google Sign-In popup
    G-->>FE: signed ID token
    FE->>BE: POST /api/auth/google
    BE->>G: verify the token is real
    BE->>DB: look up user by email
    BE-->>FE: JWT
    end

    FE->>FE: save JWT
    note over FE,BE: every later request sends the JWT
```

Key points:

- **Both paths end the same way**: a JWT signed by our own backend
  (`security.py`'s `create_access_token`). Google is only involved in the
  Google path, and only to *vouch for the person's identity* - it never
  issues the token the rest of the app actually trusts.
- **Google accounts must be pre-added by an admin** (on the Users page, by
  email) before that email can sign in - an unrecognized email is rejected
  rather than silently creating an account.
- The domain restriction (`crosswaymtc.org`) is checked **twice**: once by
  Google's own OAuth consent screen (set to Internal), and independently by
  the backend reading the token's `hd` claim - so it doesn't rely on a
  single point of configuration in the Google Cloud Console.

---

## 3. A typical request - how a page actually gets its data

```mermaid
%%{init: {"themeVariables": {"fontSize": "18px"}}}%%
sequenceDiagram
    actor U as User
    participant Page as React page
    participant Router as FastAPI router
    participant Perm as Permission check
    participant DB as Database

    U->>Page: opens the Accrual tab
    Page->>Router: GET /api/accrual (with JWT)
    Router->>Perm: allowed to see this page?

    alt has permission
        Perm-->>Router: yes
        Router->>DB: query
        DB-->>Router: rows
        Router-->>Page: 200 + data
        Page-->>U: shows the table
    else no permission
        Perm-->>Router: no
        Router-->>Page: 403
        Page-->>U: (nav item is also hidden -<br/>this matters if hit directly)
    end
```

This same shape repeats for every page - only the router and the permission
key change. The permission check happens **on the backend**, not just by
hiding the nav button, so a page you don't have access to is actually
inaccessible, not just invisible.

A few tables are the exception: **Chart of Accounts** and **Bank Accounts**
`GET` endpoints stay open to *any* signed-in user (not gated by a specific
permission), because other pages' pickers (e.g. choosing an account on a
transaction) need to read them regardless of which pages that user has been
granted. Only *editing* those two is permission-gated.

---

## 4. Data model

Split into two diagrams - one crowded diagram with all 12 tables rendered
too small to read, so this is the Chart of Accounts hierarchy on its own,
then the ledgers that categorize against it. Each box shows only its most
important fields, not every column - see `backend/app/models.py` for the
complete field list.

### 4a. Chart of Accounts hierarchy

```mermaid
%%{init: {"themeVariables": {"fontSize": "18px"}}}%%
erDiagram
    STATEMENT_CATEGORIES {
        int id PK
        string category "Budget, Expense, or Income"
        string name
    }
    STATEMENT_ITEMS {
        int id PK
        string name
    }
    CHART_OF_ACCOUNTS {
        string account_no PK "derived, never hand-typed"
        string statement_detail
        string statement_description
    }
    CATEGORY_RULES {
        int id PK
        string pattern "matches a bank line or Stripe fund"
        string account_no "assigns this account"
    }

    STATEMENT_CATEGORIES ||--o{ STATEMENT_ITEMS : has
    STATEMENT_ITEMS ||--o{ CHART_OF_ACCOUNTS : has
    CHART_OF_ACCOUNTS ||--o{ CATEGORY_RULES : "assigned by"
```

3 levels: Category → Item → Account (the leaf/"Detail" level). `account_no`
is always built from the chain (never typed by hand). Rules assign an
account automatically during Upload based on a bank keyword or Stripe fund
name match.

### 4b. Ledgers

```mermaid
%%{init: {"themeVariables": {"fontSize": "18px"}}}%%
erDiagram
    CHART_OF_ACCOUNTS {
        string account_no PK
    }
    BANK_ACCOUNTS {
        int id PK
        string name "e.g. Chase Operating"
    }
    RECON_RUNS {
        int id PK
        string bank_filename
    }
    RECONCILIATION_ENTRIES {
        int id PK
        string account_no FK
        float amount
        string dedup_key UK
    }
    ACCRUAL_ENTRIES {
        int id PK
        string account_no FK
        float amount
    }
    BUDGET_ENTRIES {
        int id PK
        string account_no FK
        float amount
    }

    CHART_OF_ACCOUNTS ||--o{ RECONCILIATION_ENTRIES : categorizes
    CHART_OF_ACCOUNTS ||--o{ ACCRUAL_ENTRIES : categorizes
    CHART_OF_ACCOUNTS ||--o{ BUDGET_ENTRIES : categorizes
    BANK_ACCOUNTS ||--o{ RECONCILIATION_ENTRIES : "posted to"
    BANK_ACCOUNTS ||--o{ ACCRUAL_ENTRIES : "posted to"
    RECON_RUNS ||--o{ RECONCILIATION_ENTRIES : "imported from"
```

- **Actual** (`RECONCILIATION_ENTRIES`), **Accrual**, and **Budget** are
  three separate ledgers, all categorized against the same Chart of
  Accounts. Actual and Accrual also carry a `bank_account_id`, a receipt
  (Google Drive file id/link), and split/undo-split support (a child row
  points back at its original via `split_parent_id`, not shown above to
  keep this readable).
- `RECON_RUNS` is the *preview* output of one Upload wizard run - pushing it
  into Actual is what creates the persistent `RECONCILIATION_ENTRIES` rows.
- The `account_no` links in both diagrams are **logical today, not yet
  enforced by the database** - the fix is planned in
  [issue #23](https://github.com/treasurer-cwmtc/cross-way-ledger/issues/23)
  (on hold pending a Docker install).
- Not pictured: `USERS` and `APP_SETTINGS` - standalone tables that
  configure the app itself, not tied to any of the above.

---

_See [PROJECT.md](PROJECT.md) for the full feature-by-feature knowledge base
and [DEPLOYMENT.md](DEPLOYMENT.md) for how this actually gets run on a
server._
