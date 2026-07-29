"""Backend-side Google Drive receipt uploads for the Reimbursements portal.

Unlike every other Drive integration in this app (frontend/src/lib/
googleDrive.ts, used for campaign imports and internal-user receipt
attachments), submitters here have no Google session for the browser to use
- they authenticate with an emailed one-time code, not Google Sign-In. So
the upload has to happen server-side, using a dedicated Google Cloud service
account (svc-cross-way-ledger-drive@...) that impersonates
settings.google_drive_impersonate_user (the treasurer's real Workspace
account) via domain-wide delegation, uploading into that user's existing
root Drive folder (see docs/DEPLOYMENT.md) - not a Shared Drive.

Plain service-account auth (no impersonation) was tried first and rejected
by the Drive API with `storageQuotaExceeded`: a bare service account has no
storage quota of its own, so it can't own files in a regular (non-Shared-
Drive) folder even when added as an Editor on it - Google's own error
message says to use a Shared Drive or OAuth/domain-wide delegation instead.
Since receipts need to land in the treasurer's existing personal folder
(not a separate Shared Drive), this uses domain-wide delegation - the
one-time setup is a Workspace Admin Console step (Security > API Controls >
Domain-wide Delegation), authorizing this service account's client ID for
the full drive scope (not the narrower drive.file scope - the year/
Reimbursements subfolders already exist, created by a different OAuth
client via the frontend's Picker flow, and drive.file only grants access to
files an app itself created or that were explicitly opened through it).

No JSON key is generated or stored - the org's
constraints/iam.disableServiceAccountKeyCreation policy blocks that (and a
key would be unnecessary risk anyway). Domain-wide delegation normally needs
a service account's own private key to self-sign the JWT assertion it swaps
for a delegated token, but google.auth.iam.Signer does that signing via the
IAM Credentials API's signBlob method instead - the Cloud Run runtime
service account only needs roles/iam.serviceAccountTokenCreator on the
Drive service account (already granted, see docs/DEPLOYMENT.md), no key
ever touches disk.

Returns the same {file_id, file_name, web_view_link} shape the frontend's
existing PickedFile type already uses for every other Drive-linked receipt,
so ReimbursementLine's receipt_* columns and the rest of the UI treat a
backend-uploaded receipt identically to a Picker-uploaded one.
"""

from __future__ import annotations

import io
import logging
from datetime import datetime

import google.auth
from google.auth import iam
from google.auth.transport import requests as google_requests
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload

from ..config import get_settings

logger = logging.getLogger("app.google_drive")
settings = get_settings()

_SCOPES = ["https://www.googleapis.com/auth/drive"]
_REIMBURSEMENTS_FOLDER_NAME = "Reimbursements"


def _client():
    if (
        not settings.google_drive_service_account_email
        or not settings.google_drive_root_folder_id
        or not settings.google_drive_impersonate_user
    ):
        raise RuntimeError(
            "Google Drive receipt uploads aren't configured yet "
            "(google_drive_service_account_email/google_drive_root_folder_id/"
            "google_drive_impersonate_user unset)."
        )
    source_creds, _ = google.auth.default()
    request = google_requests.Request()
    signer = iam.Signer(request, source_creds, settings.google_drive_service_account_email)
    creds = service_account.Credentials(
        signer=signer,
        service_account_email=settings.google_drive_service_account_email,
        token_uri="https://oauth2.googleapis.com/token",
        scopes=_SCOPES,
        subject=settings.google_drive_impersonate_user,
    )
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def _find_or_create_folder(drive, name: str, parent_id: str) -> str:
    query = (
        f"name = '{name}' and '{parent_id}' in parents "
        "and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    )
    result = drive.files().list(
        q=query,
        supportsAllDrives=True,
        includeItemsFromAllDrives=True,
        fields="files(id)",
    ).execute()
    files = result.get("files", [])
    if files:
        return files[0]["id"]

    created = drive.files().create(
        body={
            "name": name,
            "mimeType": "application/vnd.google-apps.folder",
            "parents": [parent_id],
        },
        supportsAllDrives=True,
        fields="id",
    ).execute()
    return created["id"]


def upload_receipt(submitter_email: str, filename: str, content: bytes, content_type: str) -> dict:
    """Uploads into <root>/<year>/Reimbursements/<submitter_email>/
    <timestamp>_<filename> - <root> is the treasurer's existing "Cross Way
    Ledger" Drive folder (same one campaign imports/bank uploads use),
    shared directly with the service account as an Editor. Matches the
    <root>/<year>/<category>/... convention used elsewhere (year first).
    Creates the year/Reimbursements/email subfolders as needed. Returns
    {file_id, file_name, web_view_link}."""
    drive = _client()
    year = str(datetime.now().year)
    root_id = settings.google_drive_root_folder_id
    year_folder_id = _find_or_create_folder(drive, year, root_id)
    top_folder_id = _find_or_create_folder(drive, _REIMBURSEMENTS_FOLDER_NAME, year_folder_id)
    email_folder_id = _find_or_create_folder(drive, submitter_email, top_folder_id)

    stamped_name = f"{datetime.now().strftime('%Y-%m-%d_%H%M%S')}_{filename}"
    media = MediaIoBaseUpload(io.BytesIO(content), mimetype=content_type or "application/octet-stream")
    created = drive.files().create(
        body={"name": stamped_name, "parents": [email_folder_id]},
        media_body=media,
        supportsAllDrives=True,
        fields="id, name, webViewLink",
    ).execute()

    # Submitters authenticate with an emailed code, not a Google account, and
    # often aren't on a crosswaymtc.org Workspace account at all (personal
    # Gmail, or no Google account whatsoever) - unlike the treasurer/auditor,
    # who already see this file via the folder's normal Workspace sharing,
    # a submitter has no path to view their own upload unless the file
    # itself is opened up. Scoped to just this one file (not the whole
    # folder), since the alternative - naming the submitter's exact email -
    # can't be guaranteed to resolve to a real Google account.
    drive.permissions().create(
        fileId=created["id"],
        body={"type": "anyone", "role": "reader"},
        supportsAllDrives=True,
        fields="id",
    ).execute()

    return {
        "file_id": created["id"],
        "file_name": created["name"],
        "web_view_link": created.get("webViewLink", ""),
    }
