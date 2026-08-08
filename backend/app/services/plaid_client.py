"""Wraps the Plaid API: creating a Link token (for the frontend widget),
exchanging the public_token Link hands back for a real access_token, and
pulling transactions via the modern cursor-based transactions/sync endpoint.

Mirrors services/stripe_sync.py's shape (a plain function per operation,
config read fresh from get_settings() so it always reflects the current
env), but Plaid's flow has an extra step Stripe didn't need: a real OAuth-
style user consent (Link) happens in the browser before we ever get a
token, so unlike Stripe there's no way to "just fetch" without the
treasurer first connecting an account through the UI.
"""

from __future__ import annotations

import plaid
from plaid.api import plaid_api
from plaid.model.country_code import CountryCode
from plaid.model.item_public_token_exchange_request import ItemPublicTokenExchangeRequest
from plaid.model.item_remove_request import ItemRemoveRequest
from plaid.model.link_token_create_request import LinkTokenCreateRequest
from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
from plaid.model.link_token_transactions import LinkTokenTransactions
from plaid.model.products import Products
from plaid.model.transactions_sync_request import TransactionsSyncRequest

# Plaid defaults a new Link session's transaction history to 90 days unless
# told otherwise - discovered the hard way when a real Chase connection on
# prod only pulled data back to "May" instead of the ~24 months expected.
# 730 is Plaid's documented maximum for days_requested. This only affects
# *new* connections going forward - an already-connected Item's history
# depth was locked in at its own original Link session and can't be
# widened after the fact; the fix for an existing under-scoped connection
# is to disconnect and reconnect.
_TRANSACTIONS_DAYS_REQUESTED = 730

from ..config import get_settings
from .parsers import BankRow

_ENVIRONMENTS = {
    "sandbox": plaid.Environment.Sandbox,
    "production": plaid.Environment.Production,
}


def _client() -> plaid_api.PlaidApi:
    settings = get_settings()
    if not settings.plaid_client_id or not settings.plaid_secret:
        raise RuntimeError("Plaid API credentials are not configured.")
    host = _ENVIRONMENTS.get(settings.plaid_env, plaid.Environment.Sandbox)
    configuration = plaid.Configuration(
        host=host,
        api_key={"clientId": settings.plaid_client_id, "secret": settings.plaid_secret},
    )
    return plaid_api.PlaidApi(plaid.ApiClient(configuration))


def create_link_token(user_id: str) -> str:
    """A short-lived, one-time token the frontend passes to Plaid's Link
    widget to open the bank-login flow. `user_id` just needs to be a stable
    per-app-user string - it doesn't need to match anything else, Plaid uses
    it only to group Link sessions on their side."""
    client = _client()
    request = LinkTokenCreateRequest(
        client_name="Cross Way Ledger",
        language="en",
        country_codes=[CountryCode("US")],
        user=LinkTokenCreateRequestUser(client_user_id=user_id),
        products=[Products("transactions")],
        transactions=LinkTokenTransactions(days_requested=_TRANSACTIONS_DAYS_REQUESTED),
    )
    response = client.link_token_create(request)
    return response.link_token


def exchange_public_token(public_token: str) -> tuple[str, str]:
    """Trades Link's one-time public_token for the real, long-lived
    access_token - returns (access_token, item_id)."""
    client = _client()
    response = client.item_public_token_exchange(
        ItemPublicTokenExchangeRequest(public_token=public_token)
    )
    return response.access_token, response.item_id


def remove_item(access_token: str) -> None:
    """Disconnects a bank connection on Plaid's side - important to actually
    call this on disconnect, not just delete our own row: an Item Plaid
    still considers active keeps counting toward billing even if we never
    call it again."""
    client = _client()
    client.item_remove(ItemRemoveRequest(access_token=access_token))


def sync_transactions(access_token: str, cursor: str | None):
    """One page of transactions/sync - the caller loops while has_more is
    true, threading next_cursor through. Returns the raw Plaid response
    (added/modified/removed lists, next_cursor, has_more)."""
    client = _client()
    request = TransactionsSyncRequest(access_token=access_token)
    if cursor:
        request.cursor = cursor
    return client.transactions_sync(request)


def plaid_txn_to_fields(t) -> dict:
    """Maps one raw Plaid transaction (from transactions/sync's added or
    modified lists) onto transactions_bank's Chase-CSV-shaped columns - see
    PlaidTransaction's docstring in models.py for why `amount` is negated
    and `details`/`type` are only best-effort equivalents of Chase's own
    CSV columns, not identical to them."""
    amount = -t.amount  # Plaid: positive = money out. Ours: positive = deposit.
    category = ""
    if getattr(t, "personal_finance_category", None):
        category = t.personal_finance_category.primary or ""
    elif getattr(t, "payment_channel", None):
        category = str(t.payment_channel)
    return {
        "account_id": t.account_id,
        "details": "CREDIT" if amount > 0 else "DEBIT",
        "posting_date": f"{t.date.month}/{t.date.day}/{t.date.year}",
        "description": t.name or t.merchant_name or "",
        "amount": amount,
        "type": category,
        "pending": t.pending,
    }


def to_bank_row(t) -> BankRow:
    """Adapts a staged (already-synced) transactions_bank row back into the
    BankRow shape the reconciler's existing bank-CSV pipeline expects - not
    wired into the Upload wizard yet, but this is what makes that follow-up
    a small change instead of a second parallel code path, same reasoning
    as stripe_sync.py's to_stripe_row()."""
    return BankRow(
        details=t.details,
        posting_date=t.posting_date,
        description=t.description,
        amount=t.amount,
        type=t.type,
    )
