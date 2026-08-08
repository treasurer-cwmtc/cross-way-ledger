"""rename pco_people/campaign_donors to pco_people_people/pco_giving_people

Standardizing on a pco_<product>_people naming convention ahead of building
live Planning Center People + Giving API syncs (replacing the manual CSV
imports for both): pco_people (the People-API-sourced Reimbursements login
allowlist) becomes pco_people_people, and campaign_donors (the Giving-export
donor list used by Pledge Campaigns) becomes pco_giving_people - the table
name now says which PCO product it's sourced from. campaign_donations is
unchanged (not a "people" table). Same op.rename_table pattern as
da928a58891d and f1a9c3e7d502.

Revision ID: a2c6e8b1d4f7
Revises: f1a9c3e7d502
Create Date: 2026-08-08 06:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a2c6e8b1d4f7'
down_revision: Union[str, None] = 'f1a9c3e7d502'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (old table name, new table name) - matches app/models.py exactly.
RENAMES = [
    ("pco_people", "pco_people_people"),
    ("campaign_donors", "pco_giving_people"),
]


def upgrade() -> None:
    for old_name, new_name in RENAMES:
        op.rename_table(old_name, new_name)


def downgrade() -> None:
    for old_name, new_name in reversed(RENAMES):
        op.rename_table(new_name, old_name)
