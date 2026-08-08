"""add pco_list_members and pco_giving_people_link

Revision ID: b7d2f4a9c1e6
Revises: a2c6e8b1d4f7
Create Date: 2026-08-08 14:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b7d2f4a9c1e6'
down_revision: Union[str, None] = 'a2c6e8b1d4f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'pco_list_members',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('list_id', sa.String(length=40), nullable=False),
        sa.Column('person_id', sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(['person_id'], ['pco_people_people.person_id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('list_id', 'person_id', name='uq_pco_list_member'),
    )
    op.create_index('ix_pco_list_members_list_id', 'pco_list_members', ['list_id'])
    op.create_index('ix_pco_list_members_person_id', 'pco_list_members', ['person_id'])

    op.create_table(
        'pco_giving_people_link',
        sa.Column('donor_id', sa.String(length=40), nullable=False),
        sa.Column('person_id', sa.String(length=40), nullable=False),
        sa.Column('match_source', sa.String(length=10), nullable=False, server_default='auto'),
        sa.Column('linked_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['donor_id'], ['pco_giving_people.donor_id']),
        sa.ForeignKeyConstraint(['person_id'], ['pco_people_people.person_id']),
        sa.PrimaryKeyConstraint('donor_id'),
    )


def downgrade() -> None:
    op.drop_table('pco_giving_people_link')
    op.drop_index('ix_pco_list_members_person_id', table_name='pco_list_members')
    op.drop_index('ix_pco_list_members_list_id', table_name='pco_list_members')
    op.drop_table('pco_list_members')
