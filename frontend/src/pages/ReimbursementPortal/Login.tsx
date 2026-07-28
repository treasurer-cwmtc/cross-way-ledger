import { useState } from "react";
import { reimbursementPortalApi } from "../../api/reimbursementPortal";
import logo from "../../assets/cross-way-logo-white.png";

/** Email + emailed one-time code - not the internal app's username/password
 * or Google sign-in. Submitters authenticate against the imported PCO
 * People list instead (see the Reimbursements module plan). The
 * request-otp response is deliberately generic either way, so this can't
 * tell the user whether their email matched - that's intentional. */
export default function ReimbursementLogin({ onSuccess }: { onSuccess: () => void }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function requestCode() {
    setError("");
    setBusy(true);
    try {
      const result = await reimbursementPortalApi.requestOtp(email.trim().toLowerCase());
      setMessage(result.message);
      setStep("code");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    setError("");
    setBusy(true);
    try {
      await reimbursementPortalApi.verifyOtp(email.trim().toLowerCase(), code.trim());
      onSuccess();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        background: "var(--sidebar-bg)",
        padding: 24,
      }}
    >
      <img src={logo} alt="Cross Way Mar Thoma Church" style={{ width: 220, maxWidth: "80vw" }} />
      <div style={{ width: "100%", maxWidth: 360 }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Reimbursement Requests</h2>
          <p className="subtitle" style={{ marginTop: 0 }}>Cross Way Mar Thoma Church</p>

          {step === "email" ? (
            <>
              <label className="field">
                <span>Email address</span>
                <input
                  type="email"
                  value={email}
                  autoFocus
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && email && requestCode()}
                />
              </label>
              <button className="btn" onClick={requestCode} disabled={!email.trim() || busy}>
                {busy ? "Sending…" : "Send login code"}
              </button>
            </>
          ) : (
            <>
              {message && <p className="subtitle">{message}</p>}
              <label className="field">
                <span>6-digit code</span>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  autoFocus
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={(e) => e.key === "Enter" && code.length === 6 && verifyCode()}
                />
              </label>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn" onClick={verifyCode} disabled={code.length !== 6 || busy}>
                  {busy ? "Checking…" : "Log in"}
                </button>
                <button className="btn secondary" onClick={() => setStep("email")}>
                  Use a different email
                </button>
              </div>
            </>
          )}
          {error && <div className="error">{error}</div>}
        </div>
      </div>
    </div>
  );
}
