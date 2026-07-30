import { useState } from "react";
import { authApi, User } from "../api/auth";

/** Admin-only "forgot password" flow for a local (username/password)
 * account - sets a new password directly, no knowledge of the old one
 * required. Mirrors the overlay/card pattern used by AccessDetailModal.tsx.
 * Never offered for Google accounts - see Users.tsx's account-type check. */
export default function ResetPasswordModal({
  user,
  onClose,
  onSaved,
}: {
  user: User;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function onEsc(ev: React.KeyboardEvent) {
    if (ev.key === "Escape") onClose();
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      await authApi.resetPassword(user.id, newPassword);
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      onKeyDown={onEsc}
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div
        className="card"
        onClick={(ev) => ev.stopPropagation()}
        style={{ maxWidth: 420, width: "90%" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <h3 style={{ marginTop: 0 }}>Reset password for {user.username}</h3>
          <button className="link" onClick={onClose}>
            Close
          </button>
        </div>
        <label className="field">
          <span>New password (min 8 chars)</span>
          <input
            type="password"
            autoFocus
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </label>
        <div className="row" style={{ marginTop: 14, gap: 8 }}>
          <button className="btn" onClick={save} disabled={saving || newPassword.length < 8}>
            {saving ? "Saving…" : "Reset password"}
          </button>
          <button className="btn secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}
