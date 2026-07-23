from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

from .config import get_settings
from .database import SessionLocal
from .routers import (
    accrual,
    auth,
    bank_accounts,
    budget,
    coa,
    dashboard,
    donations,
    donors,
    general_ledger,
    income_statement,
    pledge_campaigns,
    reconcile,
    reconciliation,
    restricted_transfers,
    rules,
)
from .routers import settings as settings_router
from .seed import seed

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Schema is owned entirely by Alembic now (see `alembic upgrade head` in
    # the Dockerfile CMD / local dev workflow) - the app no longer creates or
    # changes tables itself, so a stale schema fails loudly instead of being
    # silently patched over.
    with SessionLocal() as db:
        seed(db)
    yield


app = FastAPI(title="Cross Way Ledger", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(reconcile.router)
app.include_router(rules.router)
app.include_router(coa.router)
app.include_router(bank_accounts.router)
app.include_router(reconciliation.router)
app.include_router(accrual.router)
app.include_router(budget.router)
app.include_router(restricted_transfers.router)
app.include_router(general_ledger.router)
app.include_router(income_statement.router)
app.include_router(dashboard.router)
app.include_router(settings_router.router)
app.include_router(pledge_campaigns.router)
app.include_router(donors.router)
app.include_router(donations.router)


@app.exception_handler(IntegrityError)
async def integrity_error_handler(request: Request, exc: IntegrityError) -> JSONResponse:
    # Catches whatever a router didn't already turn into a friendly 400
    # itself (e.g. a bad account_no rejected by the FK constraint) - a
    # database constraint violation should never surface as a raw 500.
    return JSONResponse(
        status_code=400,
        content={"detail": "This would violate a database constraint (e.g. an invalid account number)."},
    )


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}
