from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application configuration.

    DATABASE_URL must be set to a real Postgres connection string - there is
    no SQLite fallback. Every environment (dev, CI tests, staging, prod) runs
    the same database engine on purpose (see docs/ARCHITECTURE.md) - a
    SQLite fallback previously hid a real schema bug that only surfaced
    against Postgres.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    # Max days between a bank Stripe payout line and the Stripe payout record
    # when matching on amount is ambiguous.
    payout_match_window_days: int = 7

    # --- Auth ---
    # SECRET_KEY signs JWTs. MUST be overridden in production (set in .env).
    secret_key: str = "dev-insecure-change-me"
    access_token_expire_minutes: int = 60 * 12  # 12 hours
    # Seed admin (created on first startup if no users exist).
    admin_username: str = "admin"
    admin_password: str = "changeme"
    # Same OAuth client the frontend uses for Drive (VITE_GOOGLE_CLIENT_ID) -
    # verifies the Google Sign-In ID token was issued for this app.
    google_client_id: str = ""
    google_workspace_domain: str = "crosswaymtc.org"

    # --- SMTP (Reimbursement portal OTP + notification emails) ---
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_address: str = ""
    smtp_use_tls: bool = True
    # Where "new submission" / "new unassigned submitter" notifications go -
    # defaults to the Workspace domain's treasurer mailbox.
    reimbursement_notify_email: str = "treasurer@crosswaymtc.org"

    # --- Google Drive (Reimbursement receipt uploads) ---
    # A dedicated service account (svc-cross-way-ledger-drive@...) that
    # impersonates google_drive_impersonate_user (the treasurer's real
    # Workspace account) via domain-wide delegation, uploading into that
    # user's existing root Drive folder (the same one frontend/src/lib/
    # googleDrive.ts's ROOT_FOLDER_ID points at, used for campaign imports/
    # bank uploads) - not a Shared Drive. A plain folder share + bare
    # service-account auth was tried first and rejected by the Drive API
    # (service accounts have no storage quota of their own), hence the
    # impersonation. No JSON key is stored anywhere - the org's
    # iam.disableServiceAccountKeyCreation policy blocks that; the Cloud Run
    # runtime service account instead has roles/iam.serviceAccountTokenCreator
    # on this service account, used to keylessly sign the domain-wide
    # delegation JWT via the IAM Credentials API (see
    # services/google_drive.py, docs/DEPLOYMENT.md). Empty by default;
    # receipt upload is skipped with a clear error until configured.
    google_drive_service_account_email: str = ""
    google_drive_root_folder_id: str = ""
    google_drive_impersonate_user: str = "treasurer@crosswaymtc.org"

    # --- Stripe API (automated transaction sync) ---
    # Empty by default; the Sync/scheduled-sync endpoints return a clear
    # error until configured, same convention as the Drive/SMTP settings
    # above. Secret (restricted) API key, not the publishable one.
    stripe_secret_key: str = ""
    # Re-pulled and re-upserted (by stripe_id) on every sync, rather than
    # tracked with an incremental cursor - cheap at this account's volume,
    # and self-healing if a payout gets amended/refunded after its first
    # sync. Widen this if a payout ever settles later than that.
    stripe_sync_lookback_days: int = 30
    # Shared secret the nightly Cloud Scheduler job presents (as the
    # X-Sync-Secret header) to call the scheduled-sync endpoint without a
    # user login - that endpoint has no other auth, so this must be set
    # before it's reachable in a real environment.
    stripe_sync_secret: str = ""

    # --- Plaid API (automated Chase bank sync) ---
    # Empty by default; the Link/sync endpoints return a clear error until
    # configured, same convention as every other integration above. Get
    # client_id/secret from dashboard.plaid.com - sandbox and production use
    # different secrets under the same client_id.
    plaid_client_id: str = ""
    plaid_secret: str = ""
    # "sandbox" (fake banks/data, free, no real billing risk) or
    # "production" (real Chase, real Plaid billing) - see
    # plaid.Environment.{Sandbox,Production} in services/plaid_client.py.
    plaid_env: str = "sandbox"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
