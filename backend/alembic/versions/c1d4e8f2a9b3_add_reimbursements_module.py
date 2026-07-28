"""add reimbursements module

Revision ID: c1d4e8f2a9b3
Revises: da928a58891d
Create Date: 2026-07-27 03:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c1d4e8f2a9b3'
down_revision: Union[str, None] = 'da928a58891d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'pco_people',
        sa.Column('person_id', sa.String(length=40), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False, server_default=''),
        sa.Column('email', sa.String(length=255), nullable=False, server_default=''),
        sa.Column('phone_number', sa.String(length=40), nullable=False, server_default=''),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('person_id'),
    )
    op.create_index('ix_pco_people_email', 'pco_people', ['email'])

    op.create_table(
        'reimbursement_user_relationship',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('account_no', sa.String(length=20), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['account_no'], ['chartofaccounts.account_no']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('email', 'account_no', name='uq_reimbursement_assignment'),
    )
    op.create_index('ix_reimbursement_user_relationship_email', 'reimbursement_user_relationship', ['email'])

    op.create_table(
        'reimbursement_otp_codes',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('code_hash', sa.String(length=255), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('consumed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_reimbursement_otp_codes_email', 'reimbursement_otp_codes', ['email'])

    op.create_table(
        'reimbursement',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('submitter_email', sa.String(length=255), nullable=False),
        sa.Column('submitter_name', sa.String(length=200), nullable=False, server_default=''),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='pending'),
        sa.Column('notes', sa.Text(), nullable=False, server_default=''),
        sa.Column('total_amount', sa.Float(), nullable=False, server_default='0'),
        sa.Column('submitted_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('paid_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name'),
    )
    op.create_index('ix_reimbursement_submitter_email', 'reimbursement', ['submitter_email'])
    op.create_index('ix_reimbursement_status', 'reimbursement', ['status'])

    op.create_table(
        'reimbursement_lines',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('reimbursement_id', sa.Integer(), nullable=False),
        sa.Column('account_no', sa.String(length=20), nullable=True),
        sa.Column('amount', sa.Float(), nullable=False, server_default='0'),
        sa.Column('description', sa.String(length=300), nullable=False, server_default=''),
        sa.Column('receipt_file_id', sa.String(length=200), nullable=False, server_default=''),
        sa.Column('receipt_file_name', sa.String(length=300), nullable=False, server_default=''),
        sa.Column('receipt_web_view_link', sa.Text(), nullable=False, server_default=''),
        sa.Column('accrual_entry_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['reimbursement_id'], ['reimbursement.id']),
        sa.ForeignKeyConstraint(['account_no'], ['chartofaccounts.account_no']),
        sa.ForeignKeyConstraint(['accrual_entry_id'], ['ledger_accrual.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_reimbursement_lines_reimbursement_id', 'reimbursement_lines', ['reimbursement_id'])


def downgrade() -> None:
    op.drop_index('ix_reimbursement_lines_reimbursement_id', table_name='reimbursement_lines')
    op.drop_table('reimbursement_lines')
    op.drop_index('ix_reimbursement_status', table_name='reimbursement')
    op.drop_index('ix_reimbursement_submitter_email', table_name='reimbursement')
    op.drop_table('reimbursement')
    op.drop_index('ix_reimbursement_otp_codes_email', table_name='reimbursement_otp_codes')
    op.drop_table('reimbursement_otp_codes')
    op.drop_index('ix_reimbursement_user_relationship_email', table_name='reimbursement_user_relationship')
    op.drop_table('reimbursement_user_relationship')
    op.drop_index('ix_pco_people_email', table_name='pco_people')
    op.drop_table('pco_people')
