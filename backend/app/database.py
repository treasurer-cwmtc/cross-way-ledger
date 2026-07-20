from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings

settings = get_settings()

engine = create_engine(settings.database_url, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    except Exception:
        # A failed commit (e.g. a FOREIGN KEY violation) leaves the session
        # unusable until rolled back - without this, the global
        # IntegrityError handler's own response would raise a second,
        # confusing error when the session closes.
        db.rollback()
        raise
    finally:
        db.close()
