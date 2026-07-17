// Google Drive receipt picker - loads Google's own scripts at runtime (no
// npm package: Google doesn't ship official types/bundles for these, so we
// treat window.google/window.gapi as opaque and only type what we consume).
// Uses the `drive.file` scope: the app only ever gets access to files the
// user explicitly picks or uploads through this Picker, never their whole
// Drive. We store only the file's id/name/link - the file itself stays in
// the user's Drive.

declare global {
  interface Window {
    google?: any;
    gapi?: any;
  }
}

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
const SCOPE = "https://www.googleapis.com/auth/drive.file";

export interface PickedFile {
  id: string;
  name: string;
  url: string;
}

const scriptPromises = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  let promise = scriptPromises.get(src);
  if (promise) return promise;
  promise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
  scriptPromises.set(src, promise);
  return promise;
}

let pickerApiPromise: Promise<void> | null = null;

function ensurePickerApiLoaded(): Promise<void> {
  if (pickerApiPromise) return pickerApiPromise;
  pickerApiPromise = loadScript("https://apis.google.com/js/api.js").then(
    () =>
      new Promise((resolve) => {
        window.gapi.load("picker", () => resolve());
      })
  );
  return pickerApiPromise;
}

let tokenClient: any = null;
let cachedToken: { token: string; expiresAt: number } | null = null;

async function ensureTokenClient(): Promise<any> {
  await loadScript("https://accounts.google.com/gsi/client");
  if (!tokenClient) {
    if (!CLIENT_ID) {
      throw new Error("Google Drive isn't configured (missing VITE_GOOGLE_CLIENT_ID).");
    }
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: () => {}, // overridden per-request below
      error_callback: () => {}, // overridden per-request below - popup-blocked etc. land here, not `callback`
    });
  }
  return tokenClient;
}

/** Requests an access token, reusing a still-valid one silently. The first
 * call in a session opens Google's consent popup; later calls within the
 * token's ~1hr lifetime resolve immediately. */
async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }
  const client = await ensureTokenClient();
  return new Promise((resolve, reject) => {
    client.callback = (resp: { access_token?: string; error?: string; expires_in?: number }) => {
      if (resp.error || !resp.access_token) {
        reject(new Error(resp.error || "Google sign-in was cancelled."));
        return;
      }
      cachedToken = {
        token: resp.access_token,
        expiresAt: Date.now() + (resp.expires_in || 3600) * 1000,
      };
      resolve(resp.access_token);
    };
    client.error_callback = (err: { type?: string; message?: string }) => {
      reject(
        new Error(
          err.type === "popup_failed_to_open"
            ? "Google sign-in popup was blocked - allow popups for this site and try again."
            : err.message || err.type || "Google sign-in failed."
        )
      );
    };
    client.requestAccessToken({ prompt: "" });
  });
}

const DRIVE_FILES_API = "https://www.googleapis.com/drive/v3/files";
const RECEIPTS_ROOT_FOLDER_NAME = "Cross Way Ledger Receipts";

/** Finds a folder by exact name (optionally under a parent), among folders
 * this app can see - which, under the drive.file scope, means only folders
 * the app itself created. Returns null if not found. */
async function findFolder(name: string, parentId: string | null, token: string): Promise<string | null> {
  const clauses = [
    "mimeType='application/vnd.google-apps.folder'",
    `name='${name.replace(/'/g, "\\'")}'`,
    "trashed=false",
  ];
  if (parentId) clauses.push(`'${parentId}' in parents`);
  const url = `${DRIVE_FILES_API}?q=${encodeURIComponent(clauses.join(" and "))}&fields=files(id)&spaces=drive`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error("Couldn't look up the receipts folder in Google Drive.");
  const data = await res.json();
  return data.files?.[0]?.id ?? null;
}

async function createFolder(name: string, parentId: string | null, token: string): Promise<string> {
  const res = await fetch(DRIVE_FILES_API, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : undefined,
    }),
  });
  if (!res.ok) throw new Error("Couldn't create the receipts folder in Google Drive.");
  const data = await res.json();
  return data.id as string;
}

async function getOrCreateFolder(name: string, parentId: string | null, token: string): Promise<string> {
  const existing = await findFolder(name, parentId, token);
  if (existing) return existing;
  return createFolder(name, parentId, token);
}

/** Resolves (creating if needed) "Cross Way Ledger Receipts/<year>" in the
 * user's Drive, so uploaded receipts land in a dated folder instead of
 * Drive's root. */
async function getReceiptsFolderForYear(token: string, year: number): Promise<string> {
  const root = await getOrCreateFolder(RECEIPTS_ROOT_FOLDER_NAME, null, token);
  return getOrCreateFolder(String(year), root, token);
}

function openPicker(accessToken: string, uploadFolderId: string | null): Promise<PickedFile | null> {
  if (!API_KEY) {
    return Promise.reject(new Error("Google Drive isn't configured (missing VITE_GOOGLE_API_KEY)."));
  }
  const google = window.google;
  return new Promise((resolve, reject) => {
    try {
      const uploadView = new google.picker.DocsUploadView();
      if (uploadFolderId) uploadView.setParent(uploadFolderId);
      const pickView = new google.picker.DocsView(google.picker.ViewId.DOCS)
        .setIncludeFolders(false)
        .setSelectFolderEnabled(false);

      const picker = new google.picker.PickerBuilder()
        .addView(uploadView)
        .addView(pickView)
        .setOAuthToken(accessToken)
        .setDeveloperKey(API_KEY)
        .setCallback((data: any) => {
          if (data.action === google.picker.Action.PICKED) {
            const doc = data.docs[0];
            resolve({ id: doc.id, name: doc.name, url: doc.url });
          } else if (data.action === google.picker.Action.CANCEL) {
            resolve(null);
          }
        })
        .build();
      picker.setVisible(true);
    } catch (err) {
      reject(err as Error);
    }
  });
}

function openMultiPicker(accessToken: string): Promise<PickedFile[]> {
  if (!API_KEY) {
    return Promise.reject(new Error("Google Drive isn't configured (missing VITE_GOOGLE_API_KEY)."));
  }
  const google = window.google;
  return new Promise((resolve, reject) => {
    try {
      const pickView = new google.picker.DocsView(google.picker.ViewId.DOCS)
        .setIncludeFolders(false)
        .setSelectFolderEnabled(false);

      const picker = new google.picker.PickerBuilder()
        .addView(pickView)
        .addView(new google.picker.DocsUploadView())
        .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
        .setOAuthToken(accessToken)
        .setDeveloperKey(API_KEY)
        .setCallback((data: any) => {
          if (data.action === google.picker.Action.PICKED) {
            resolve(data.docs.map((doc: any) => ({ id: doc.id, name: doc.name, url: doc.url })));
          } else if (data.action === google.picker.Action.CANCEL) {
            resolve([]);
          }
        })
        .build();
      picker.setVisible(true);
    } catch (err) {
      reject(err as Error);
    }
  });
}

/** For bulk-linking pre-existing files already sitting in Drive (e.g. old
 * invoices) to ledger entries - lets the user select many files in one
 * consent step, rather than the single-file flow `pickReceiptFile` uses. */
export async function pickMultipleReceiptFiles(): Promise<PickedFile[]> {
  await ensurePickerApiLoaded();
  const token = await getAccessToken();
  return openMultiPicker(token);
}

/** Full flow: ensure Google's scripts are loaded, get an access token
 * (prompting for consent on first use), open the Picker (upload new or pick
 * existing), and resolve with the chosen file - or null if the user
 * cancelled. When `year` is given, a new upload is filed under
 * "Cross Way Ledger Receipts/<year>" instead of Drive's root - if that setup
 * step fails for any reason, the upload still proceeds, just into the root,
 * rather than blocking the whole attach flow. */
export async function pickReceiptFile(opts?: { year?: number }): Promise<PickedFile | null> {
  await ensurePickerApiLoaded();
  const token = await getAccessToken();
  let uploadFolderId: string | null = null;
  if (opts?.year) {
    try {
      uploadFolderId = await getReceiptsFolderForYear(token, opts.year);
    } catch {
      uploadFolderId = null;
    }
  }
  return openPicker(token, uploadFolderId);
}
