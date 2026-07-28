"""Outbound email for the Reimbursements module (OTP codes, submission and
status-change notifications) - the only place in this app that sends real
email. Uses plain smtplib against Gmail/Workspace SMTP with an App Password
(see config.py's smtp_* settings), not a third-party transactional API.

Failures are logged, not raised, at every call site that isn't the OTP send
itself - a notification email failing to send should never block the
underlying database change (a submission, a status change) from completing.
The OTP send IS allowed to raise, since a code the submitter never receives
makes the whole login attempt pointless anyway - the router surfaces that as
a 502 rather than silently reporting success.
"""

from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

from ..config import get_settings

logger = logging.getLogger("app.email")
settings = get_settings()


def send_email(to: str, subject: str, body: str) -> None:
    if not settings.smtp_username or not settings.smtp_password:
        raise RuntimeError("SMTP is not configured (smtp_username/smtp_password unset).")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from_address or settings.smtp_username
    msg["To"] = to
    msg.set_content(body)

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
        if settings.smtp_use_tls:
            smtp.starttls()
        smtp.login(settings.smtp_username, settings.smtp_password)
        smtp.send_message(msg)


def send_email_best_effort(to: str, subject: str, body: str) -> None:
    """For notification emails where a delivery failure must not roll back
    or block the caller's actual work (a submission, a status change)."""
    try:
        send_email(to, subject, body)
    except Exception:
        logger.exception("Failed to send notification email to %s: %s", to, subject)
