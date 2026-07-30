"""Guards against ever pointing the test suite's destructive bootstrap
(Base.metadata.drop_all + create_all) at a real database.

On 2026-07-30, a manual local `pytest` run had DATABASE_URL set to the real
dev Cloud SQL instance's public IP instead of a throwaway Postgres - every
table in ledger-db-dev got dropped and reseeded, wiping real campaign,
reimbursement, ledger, and PCO data (recovered via point-in-time recovery,
see issue #75). CI was never at risk - its Postgres is a disposable
per-run container, always on `localhost` - only a manual run against a
real DATABASE_URL can hit this, so the check only needs to allow loopback
hosts and refuse everything else.
"""
from urllib.parse import urlsplit

_SAFE_HOSTS = {"localhost", "127.0.0.1", "::1", "db"}


def assert_safe_test_database(database_url: str) -> None:
    host = urlsplit(database_url.replace("postgresql+psycopg", "postgresql", 1)).hostname
    if host not in _SAFE_HOSTS:
        raise RuntimeError(
            f"Refusing to run destructive test bootstrap (drop_all/create_all) "
            f"against DATABASE_URL host '{host}' - this looks like a real "
            f"database, not a throwaway one. Tests must run against a local "
            f"Postgres (`docker compose up -d db`) or let CI's disposable "
            f"container run them instead. If '{host}' is genuinely a scratch "
            f"instance you stood up on purpose, add it to _SAFE_HOSTS in "
            f"tests/_db_safety.py explicitly - never bypass this silently."
        )
