// Google Sign-In (identity, not authorization) - a separate GIS API from
// the OAuth token client in googleDrive.ts, but loaded from the same script
// and usable with the same Client ID. Produces a signed ID token (a JWT)
// that the backend verifies and matches against a pre-added user's email -
// this module never sees or stores any Drive/file access.

declare global {
  interface Window {
    google?: any;
  }
}

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

let scriptPromise: Promise<void> | null = null;

function loadGisScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Sign-In."));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/** Renders a real "Sign in with Google" button into `container`, calling
 * `onToken` with the raw ID token string once the user completes sign-in. */
export async function renderGoogleSignInButton(
  container: HTMLElement,
  onToken: (idToken: string) => void
): Promise<void> {
  if (!CLIENT_ID) return;
  await loadGisScript();
  window.google.accounts.id.initialize({
    client_id: CLIENT_ID,
    callback: (response: { credential: string }) => onToken(response.credential),
  });
  window.google.accounts.id.renderButton(container, {
    theme: "outline",
    size: "large",
    width: 320,
  });
}
