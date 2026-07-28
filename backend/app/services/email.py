"""Outbound email for the Reimbursements module (OTP codes, submission and
status-change notifications) - the only place in this app that sends real
email. Uses plain smtplib against Gmail/Workspace SMTP with an App Password
(see config.py's smtp_* settings), not a third-party transactional API.

Every email is sent as multipart/alternative (plain text + HTML) - the HTML
part uses the church's actual brand colors (see styles.css's :root
variables) rather than a generic template, and the plain text part is a
real fallback (not just the HTML stripped), for text-only mail clients and
spam-filter scoring.

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

# Matches styles.css's :root brand variables - kept in sync by hand, since
# email HTML can't reference CSS custom properties.
_NAVY = "#0a0f1c"
_TEXT = "#131a24"
_MUTED = "#64707d"
_BORDER = "#e1e6ea"
_PRIMARY = "#22b8d1"
_PRIMARY_DARK = "#1a94a8"
_BG = "#f3f5f7"


def render_email_html(heading: str, body_html: str, button: tuple[str, str] | None = None) -> str:
    """Wraps `body_html` (already-safe HTML - callers control all content,
    none of it is raw user input) in the branded shell used by every
    Reimbursements email: dark navy header with the church name, a white
    card for the message, and an optional call-to-action button.
    `button` is (label, url)."""
    button_html = ""
    if button:
        label, url = button
        button_html = f"""
        <tr>
          <td style="padding-top:20px;">
            <a href="{url}"
               style="display:inline-block;background:{_PRIMARY};color:#ffffff;
                      text-decoration:none;font-weight:600;font-size:14px;
                      padding:11px 22px;border-radius:8px;">
              {label}
            </a>
          </td>
        </tr>
        """

    return f"""\
<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:{_BG};
               font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{_BG};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0"
                 style="max-width:480px;width:100%;">
            <tr>
              <td style="background:{_NAVY};border-radius:12px 12px 0 0;padding:20px 28px;">
                <span style="color:#ffffff;font-size:15px;font-weight:700;letter-spacing:0.01em;">
                  Cross Way Mar Thoma Church
                </span>
              </td>
            </tr>
            <tr>
              <td style="background:#ffffff;border:1px solid {_BORDER};border-top:none;
                         border-radius:0 0 12px 12px;padding:28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="color:{_TEXT};font-size:19px;font-weight:700;padding-bottom:14px;">
                      {heading}
                    </td>
                  </tr>
                  <tr>
                    <td style="color:{_TEXT};font-size:14px;line-height:1.6;">
                      {body_html}
                    </td>
                  </tr>
                  {button_html}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 8px;color:{_MUTED};font-size:12px;text-align:center;">
                Cross Way Ledger &middot; automated message, please don't reply
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""


def send_email(to: str, subject: str, text_body: str, html_body: str | None = None) -> None:
    if not settings.smtp_username or not settings.smtp_password:
        raise RuntimeError("SMTP is not configured (smtp_username/smtp_password unset).")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from_address or settings.smtp_username
    msg["To"] = to
    msg.set_content(text_body)
    if html_body:
        msg.add_alternative(html_body, subtype="html")

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
        if settings.smtp_use_tls:
            smtp.starttls()
        smtp.login(settings.smtp_username, settings.smtp_password)
        smtp.send_message(msg)


def send_email_best_effort(to: str, subject: str, text_body: str, html_body: str | None = None) -> None:
    """For notification emails where a delivery failure must not roll back
    or block the caller's actual work (a submission, a status change)."""
    try:
        send_email(to, subject, text_body, html_body)
    except Exception:
        logger.exception("Failed to send notification email to %s: %s", to, subject)
