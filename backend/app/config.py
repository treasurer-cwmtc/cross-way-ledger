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

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
