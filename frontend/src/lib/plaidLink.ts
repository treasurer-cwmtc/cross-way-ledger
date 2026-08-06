// Plaid Link - the hosted widget that walks the treasurer through logging
// into Chase (or, in sandbox, a fake test bank) to authorize a read-only
// connection. Loaded from Plaid's own CDN (never bundled - see Plaid's
// docs), same lazy-script-load pattern as googleIdentity.ts.

declare global {
  interface Window {
    Plaid?: {
      create: (config: {
        token: string;
        onSuccess: (publicToken: string, metadata: PlaidLinkSuccessMetadata) => void;
        onExit?: (err: unknown, metadata: unknown) => void;
      }) => { open: () => void };
    };
  }
}

export interface PlaidLinkSuccessMetadata {
  institution: { name: string; institution_id: string } | null;
}

let scriptPromise: Promise<void> | null = null;

function loadPlaidScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Plaid Link."));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/** Opens the Plaid Link flow using a link_token already created by the
 * backend. Resolves with (publicToken, institutionName) once the treasurer
 * completes linking; never resolves if they close the widget without
 * finishing (same as clicking away from any modal). */
export async function openPlaidLink(
  linkToken: string
): Promise<{ publicToken: string; institutionName: string }> {
  await loadPlaidScript();
  return new Promise((resolve) => {
    const handler = window.Plaid!.create({
      token: linkToken,
      onSuccess: (publicToken, metadata) => {
        resolve({ publicToken, institutionName: metadata.institution?.name || "" });
      },
    });
    handler.open();
  });
}
