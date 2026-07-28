"""Backend-side Google Drive receipt uploads for the Reimbursements portal.

Unlike every other Drive integration in this app (frontend/src/lib/
googleDrive.ts, used for campaign imports and internal-user receipt
attachments), submitters here have no Google session for the browser to use
- they authenticate with an emailed one-time code, not Google Sign-In. So
the upload has to happen server-side, using a Google Cloud service account
added as a member of a dedicated Shared Drive (see docs/DEPLOYMENT.md for
the one-time setup) - not domain-wide delegation/impersonation, which would
need Workspace Super Admin console changes for no real benefit here.

Returns the same {file_id, file_name, web_view_link} shape the frontend's
existing PickedFile type already uses for every other Drive-linked receipt,
so ReimbursementLine's receipt_* columns and the rest of the UI treat a
backend-uploaded receipt identically to a Picker-uploaded one.
"""

from __future__ import annotations

import io
import json
import logging
from datetime import datetime

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload

from ..config import get_settings

logger = logging.getLogger("app.google_drive")
settings = get_settings()

_SCOPES = ["https://www.googleapis.com/auth/drive"]
_REIMBURSEMENTS_FOLDER_NAME = "Reimbursements"


def _client():
    if not settings.google_drive_service_account_json or not settings.google_drive_shared_drive_id:
        raise RuntimeError(
            "Google Drive receipt uploads aren't configured yet "
            "(google_drive_service_account_json/google_drive_shared_drive_id unset)."
        )
    info = json.loads(settings.google_drive_service_account_json)
    creds = service_account.Credentials.from_service_account_info(info, scopes=_SCOPES)
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def _find_or_create_folder(drive, name: str, parent_id: str) -> str:
    query = (
        f"name = '{name}' and '{parent_id}' in parents "
        "and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    )
    result = drive.files().list(
        q=query,
        corpora="drive",
        driveId=settings.google_drive_shared_drive_id,
        includeItemsFromAllDrives=True,
        supportsAllDrives=True,
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
    """Uploads into <SharedDrive>/Reimbursements/<year>/<submitter_email>/
    <timestamp>_<filename>, creating the year/email subfolders as needed.
    Returns {file_id, file_name, web_view_link}."""
    drive = _client()
    year = str(datetime.now().year)
    root_id = settings.google_drive_shared_drive_id
    top_folder_id = _find_or_create_folder(drive, _REIMBURSEMENTS_FOLDER_NAME, root_id)
    year_folder_id = _find_or_create_folder(drive, year, top_folder_id)
    email_folder_id = _find_or_create_folder(drive, submitter_email, year_folder_id)

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
