"""Every Planning Center (PCO) API integration, one module per PCO product:
people.py (People API), giving.py (Giving API - Donors + Donations),
forms.py (People Forms API - Pledge Form sync). All endpoints live under
/api/pco/<module>/... - the single standardized spelling for "Planning
Center" across this app's URLs, matching the "pco" convention already used
throughout the DB tables, models, config fields, and GCP infra (Secret
Manager, Cloud Scheduler) - see docs/DATA_DICTIONARY.md.

Route registration in each submodule reuses the exact function objects
still defined in routers/reimbursements.py, routers/pledge_campaigns.py,
and routers/donations.py (e.g. `router.post(path, ...)(some_module.
some_func)`) rather than duplicating their bodies - those functions stay
in their original modules because their logic is genuinely shared with
non-PCO code there (CSV import fallbacks, campaign/donor matching), so
there is exactly one implementation of each, registered fresh at its new
/api/pco/... path with no old path left behind.
"""
