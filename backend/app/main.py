from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .database import Base, SessionLocal, engine
from .routers import auth, bank_accounts, coa, reconcile, reconciliation, rules
from .seed import seed

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed(db)
    yield


app = FastAPI(title="Bank / Stripe Reconciliation", version="0.1.0", lifespan=lifespan)

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


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}
