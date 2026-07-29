import { useEffect, useState } from "react";
import { submitterAuth, SubmitterAuthError } from "../../api/reimbursementPortal";
import { Reimbursement, ReimbursementAssignment, reimbursementPortalApi } from "../../api/reimbursementPortal";
import ReimbursementLogin from "./Login";
import RequestList from "./RequestList";
import ReimbursementWizard from "./Wizard";

type View = "list" | "new" | { edit: Reimbursement };

/** Entirely separate from the internal app's <App/> shell - see main.tsx.
 * Submitters authenticate by emailed one-time code against the imported PCO
 * People list, not the app's normal login, and are never rows in `users`. */
export default function ReimbursementPortal() {
  const [loggedIn, setLoggedIn] = useState(!!submitterAuth.token);
  const [coas, setCoas] = useState<ReimbursementAssignment[] | null>(null);
  const [view, setView] = useState<View>("list");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loggedIn) return;
    reimbursementPortalApi
      .myCoas()
      .then(setCoas)
      .catch((e) => {
        if (e instanceof SubmitterAuthError) {
          setLoggedIn(false);
        } else {
          setError((e as Error).message);
        }
      });
  }, [loggedIn]);

  if (!loggedIn) {
    return <ReimbursementLogin onSuccess={() => setLoggedIn(true)} />;
  }

  function logout() {
    submitterAuth.clear();
    setLoggedIn(false);
    setCoas(null);
    setView("list");
  }

  return (
    <div className="app-shell" style={{ display: "block", padding: "24px" }}>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
          <h2 className="page-title" style={{ margin: 0 }}>
            Reimbursement Requests
          </h2>
          <button className="link" onClick={logout}>
            Log out
          </button>
        </div>

        {error && <div className="error">{error}</div>}

        {view === "list" && (
          <>
            {coas && coas.length > 0 ? (
              <div className="row" style={{ marginBottom: 16 }}>
                <button className="btn" onClick={() => setView("new")}>
                  New reimbursement request
                </button>
              </div>
            ) : coas ? (
              <div className="card">
                <p className="subtitle" style={{ margin: 0 }}>
                  Your account isn't set up to submit reimbursements yet. We've notified the
                  church office - check back soon.
                </p>
              </div>
            ) : null}
            <RequestList onEdit={(r) => setView({ edit: r })} />
          </>
        )}

        {view === "new" && coas && (
          <ReimbursementWizard
            coas={coas}
            onDone={() => setView("list")}
            onCancel={() => setView("list")}
          />
        )}

        {typeof view === "object" && "edit" in view && coas && (
          <ReimbursementWizard
            coas={coas}
            existing={view.edit}
            onDone={() => setView("list")}
            onCancel={() => setView("list")}
          />
        )}
      </div>
    </div>
  );
}
