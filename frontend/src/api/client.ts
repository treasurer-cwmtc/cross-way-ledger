// Shared fetch/auth core. Every domain module depends on this file, but it
// changes rarely - domain modules (accounts.ts, rules.ts, etc.) are where
// day-to-day work happens, so parallel sessions rarely collide here.

export const BASE = import.meta.env.VITE_API_BASE || "";

const TOKEN_KEY = "recon_token";

export const auth = {
  get token(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  },
  set(token: string) {
    localStorage.setItem(TOKEN_KEY, token);
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
  },
};

export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const t = auth.token;
  return t ? { ...extra, Authorization: `Bearer ${t}` } : extra;
}

export class AuthError extends Error {}

export async function j<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    auth.clear();
    throw new AuthError("Session expired. Please log in again.");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
