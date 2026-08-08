"""add ledger_assets

Revision ID: c7e9a4f0d61b
Revises: a3c8f7e2b419
Create Date: 2026-08-07 21:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c7e9a4f0d61b'
down_revision: Union[str, None] = 'a3c8f7e2b419'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # A simple standalone equipment/inventory reference list - mirrors the
    # treasurer's existing "Equipment List" Google Sheet. Deliberately not
    # linked to Chart of Accounts/General Ledger. See issue #113.
    op.create_table(
        "ledger_assets",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("purchase_date", sa.Date(), nullable=True),
        sa.Column("category", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("item", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("cost", sa.Float(), nullable=False, server_default="0"),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("receipt_file_id", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("receipt_file_name", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("receipt_web_view_link", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )


def downgrade() -> None:
    op.drop_table("ledger_assets")
