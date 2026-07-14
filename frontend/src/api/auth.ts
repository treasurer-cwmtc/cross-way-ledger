// Auth/user-management endpoints. Used by pages/Login.tsx, pages/Users.tsx,
// and App.tsx (session bootstrap via `me`).
import { BASE, authHeaders, auth, j } from "./client";

export interface User {
  id: number;
  username: string;
  is_admin: boolean;
  active: boolean;
  created_at: string;
}

export const authApi = {
  login: async (username: string, password: string) => {
    const body = new URLSearchParams({ username, password });
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = await j<{ access_token: string }>(res);
    auth.set(data.access_token);
    return data;
  },

  me: () => fetch(`${BASE}/api/auth/me`, { headers: authHeaders() }).then(j<User>),

  changePassword: (current_password: string, new_password: string) =>
    fetch(`${BASE}/api/auth/change-password`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ current_password, new_password }),
    }).then(j<void>),

  listUsers: () =>
    fetch(`${BASE}/api/auth/users`, { headers: authHeaders() }).then(j<User[]>),

  createUser: (username: string, password: string, is_admin: boolean) =>
    fetch(`${BASE}/api/auth/users`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ username, password, is_admin }),
    }).then(j<User>),

  deactivateUser: (id: number) =>
    fetch(`${BASE}/api/auth/users/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then(j<void>),
};
