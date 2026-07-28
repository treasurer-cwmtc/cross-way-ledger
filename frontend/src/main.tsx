import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ReimbursementPortal from "./pages/ReimbursementPortal";
import "./styles.css";

// No client-side router in this app (view state is a plain `tab` useState,
// not URL-driven) - the Reimbursement portal is the one exception, since it
// has to be reachable WITHOUT logging into the internal tool at all (its
// users authenticate by emailed code against the PCO People list, not the
// app's normal login - see the Reimbursements module plan). A single
// pathname check here is enough; nginx.conf's try_files already falls back
// to index.html for this path, so a direct link/reload works.
const isPortal = window.location.pathname.startsWith("/reimbursements/portal");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{isPortal ? <ReimbursementPortal /> : <App />}</React.StrictMode>
);
