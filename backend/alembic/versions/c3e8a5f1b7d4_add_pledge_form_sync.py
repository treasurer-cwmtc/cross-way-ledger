"""add pledge form sync (pco_form_id + campaign_pledge_form_mapping)

Revision ID: c3e8a5f1b7d4
Revises: b7d2f4a9c1e6
Create Date: 2026-08-08 14:30:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c3e8a5f1b7d4'
down_revision: Union[str, None] = 'b7d2f4a9c1e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('campaign', sa.Column('pco_form_id', sa.String(length=40), nullable=False, server_default=''))

    op.create_table(
        'campaign_pledge_form_mapping',
        sa.Column('campaign_id', sa.Integer(), nullable=False),
        sa.Column('initial_amount_field_id', sa.String(length=40), nullable=False, server_default=''),
        sa.Column('due_date_field_id', sa.String(length=40), nullable=False, server_default=''),
        sa.Column('monthly_amount_field_id', sa.String(length=40), nullable=False, server_default=''),
        sa.Column('contact_method_field_id', sa.String(length=40), nullable=False, server_default=''),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['campaign_id'], ['campaign.id']),
        sa.PrimaryKeyConstraint('campaign_id'),
    )


def downgrade() -> None:
    op.drop_table('campaign_pledge_form_mapping')
    op.drop_column('campaign', 'pco_form_id')
