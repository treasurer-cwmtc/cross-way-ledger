import { useEffect, useState } from "react";
import { authApi, User } from "../api/auth";

export default function Users({ currentUserId }: { currentUserId: number }) {
  const [users, setUsers] = useState<User[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    try {
      setUsers(await authApi.listUsers());
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function addUser() {
    setError("");
    setMsg("");
    try {
      await authApi.createUser(username, password, isAdmin);
      setMsg(`Created user “${username}”.`);
      setUsername("");
      setPassword("");
      setIsAdmin(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function deactivate(u: User) {
    if (!confirm(`Deactivate ${u.username}? They will no longer be able to log in.`))
      return;
    setError("");
    try {
      await authApi.deactivateUser(u.id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <h2 className="page-title">Users</h2>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Add a user</h3>
        <div className="row">
          <label className="field">
            <span>Username</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Password (min 8 chars)</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className="field" style={{ maxWidth: 140 }}>
            <span>Admin</span>
            <input
              type="checkbox"
              checked={isAdmin}
              onChange={(e) => setIsAdmin(e.target.checked)}
            />
          </label>
        </div>
        <button
          className="btn"
          onClick={addUser}
          disabled={!username || password.length < 8}
        >
          Add user
        </button>
        {msg && <div className="ok">{msg}</div>}
        {error && <div className="error">{error}</div>}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Users</h3>
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Admin</th>
              <th>Active</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <b>{u.username}</b>
                  {u.id === currentUserId && (
                    <span style={{ color: "var(--muted)" }}> (you)</span>
                  )}
                </td>
                <td>{u.is_admin ? "Yes" : ""}</td>
                <td>{u.active ? "Yes" : "No"}</td>
                <td>{new Date(u.created_at).toLocaleDateString()}</td>
                <td>
                  {u.active && u.id !== currentUserId && (
                    <button className="link" onClick={() => deactivate(u)}>
                      Deactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
