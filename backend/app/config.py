from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application configuration.

    DATABASE_URL defaults to a local SQLite file so the app runs with zero
    external dependencies for the POC. In Docker / on a VPS, set DATABASE_URL
    to the Postgres connection string (see docker-compose.yml).
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./recon.db"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    # Max days between a bank Stripe payout line and the Stripe payout record
    # when matching on amount is ambiguous.
    payout_match_window_days: int = 7

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
