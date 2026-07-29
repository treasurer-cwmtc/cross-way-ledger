"""Backend-side Google Drive receipt uploads for the Reimbursements portal.

Unlike every other Drive integration in this app (frontend/src/lib/
googleDrive.ts, used for campaign imports and internal-user receipt
attachments), submitters here have no Google session for the browser to use
- they authenticate with an emailed one-time code, not Google Sign-In. So
the upload has to happen server-side, using a dedicated Google Cloud service
account (svc-cross-way-ledger-drive@...) added directly as an Editor on the
treasurer's existing root Drive folder (see docs/DEPLOYMENT.md) - a plain
folder share, not a Shared Drive or domain-wide delegation, so receipts land
in the same place as every other treasurer document.

No JSON key is generated or stored - the org's
constraints/iam.disableServiceAccountKeyCreation policy blocks that (and it's
unnecessary risk anyway). Instead, the Cloud Run runtime service account has
been granted roles/iam.serviceAccountTokenCreator on the Drive service
account, so we start from Cloud Run's ambient default credentials and
impersonate the Drive service account for short-lived tokens.

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
from google.auth import impersonated_credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload

from ..config import get_settings

logger = logging.getLogger("app.google_drive")
settings = get_settings()

_SCOPES = ["https://www.googleapis.com/auth/drive"]
_REIMBURSEMENTS_FOLDER_NAME = "Reimbursements"


def _client():
    if not settings.google_drive_service_account_email or not settings.google_drive_root_folder_id:
        raise RuntimeError(
            "Google Drive receipt uploads aren't configured yet "
            "(google_drive_service_account_email/google_drive_root_folder_id unset)."
        )
    source_creds, _ = google.auth.default()
    creds = impersonated_credentials.Credentials(
        source_credentials=source_creds,
        target_principal=settings.google_drive_service_account_email,
        target_scopes=_SCOPES,
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

    return {
        "file_id": created["id"],
        "file_name": created["name"],
        "web_view_link": created.get("webViewLink", ""),
    }
