from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .database import Base, SessionLocal, engine
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
    rules,
)
from .routers import settings as settings_router
from .seed import seed

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
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
app.include_router(general_ledger.router)
app.include_router(income_statement.router)
app.include_router(dashboard.router)
app.include_router(settings_router.router)
app.include_router(pledge_campaigns.router)
app.include_router(donors.router)
app.include_router(donations.router)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}
