"""add status to pco_people_people

Revision ID: d8f4a2c9e6b1
Revises: c3e8a5f1b7d4
Create Date: 2026-08-08 16:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'd8f4a2c9e6b1'
down_revision: Union[str, None] = 'c3e8a5f1b7d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('pco_people_people', sa.Column('status', sa.String(length=20), nullable=False, server_default=''))
    # Every row synced so far was pulled under the old status=active-only
    # filter (see services/pco_people_sync.py) - backfill them as "active"
    # rather than leaving them blank, so the new Status column and the
    # reimbursement-gate's explicit status check both read correctly for
    # existing data without waiting on the next sync.
    op.execute("UPDATE pco_people_people SET status = 'active' WHERE status = ''")


def downgrade() -> None:
    op.drop_column('pco_people_people', 'status')
