import { useEffect, useState } from "react";
import { authApi, User } from "../api/auth";
import { ColGroup, ColResizeHandle, useColumnWidths } from "../components/ColumnResize";

// Matches the backend's GRANTABLE_PERMISSIONS (app/deps.py) and the
// corresponding Tab keys in App.tsx - kept as its own small list here since
// App.tsx's NAV_GROUPS isn't exported, and this is the only other place a
// page key needs a human label.
// Most entries grant one permission key; "Campaign Details" grants two at
// once (pledge-campaign-pledges + pledge-campaign-actuals) since the two
// tabs those used to gate were merged into one Details tab - kept as two
// backend keys (require_any_permission on the read side) so nobody already
// granted one of them silently loses page access.
const GRANTABLE_PAGES: { keys: string[]; label: string }[] = [
  { keys: ["upload"], label: "Upload" },
  { keys: ["reconciliation"], label: "Actual" },
  { keys: ["accrual"], label: "Accrual" },
  { keys: ["budget"], label: "Budget" },
  { keys: ["restricted-net-assets"], label: "Restricted Net Assets" },
  { keys: ["general-ledger"], label: "General Ledger" },
  { keys: ["income-statement"], label: "Income Statement" },
  { keys: ["rules"], label: "Rules" },
  { keys: ["accounts"], label: "Chart of Accounts" },
  { keys: ["link-receipts"], label: "Link Receipts" },
  { keys: ["config"], label: "Config" },
  { keys: ["pledge-campaign-status"], label: "Campaign Status" },
  { keys: ["pledge-campaign-pledges", "pledge-campaign-actuals"], label: "Campaign Details" },
  { keys: ["donors"], label: "Giving App - Donors" },
];

type AccountType = "local" | "google";

export default function Users({ currentUserId }: { currentUserId: number }) {
  const [users, setUsers] = useState<User[]>([]);
  const [accountType, setAccountType] = useState<AccountType>("local");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const [selectedUserId, setSelectedUserId] = useState<number | "">("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [isAdminGrant, setIsAdminGrant] = useState(false);
  const [hideDonorNames, setHideDonorNames] = useState(false);
  const [permError, setPermError] = useState("");
  const [permMsg, setPermMsg] = useState("");
  const { widths, startResize } = useColumnWidths("users-list");

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
      if (accountType === "google") {
        const local = email.split("@")[0];
        await authApi.createUser({ username: local || email, email });
        setMsg(`Created Google account for "${email}".`);
      } else {
        await authApi.createUser({ username, password });
        setMsg(`Created user "${username}".`);
      }
      setUsername("");
      setPassword("");
      setEmail("");
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

  function selectUserForPermissions(id: number | "") {
    setSelectedUserId(id);
    setPermError("");
    setPermMsg("");
    const u = users.find((x) => x.id === id);
    setPermissions(u ? [...u.permissions] : []);
    setIsAdminGrant(u ? u.is_admin : false);
    setHideDonorNames(u ? u.hide_donor_names : false);
  }

  function togglePermission(keys: string[]) {
    setPermissions((prev) =>
      keys.every((k) => prev.includes(k))
        ? prev.filter((p) => !keys.includes(p))
        : [...prev.filter((p) => !keys.includes(p)), ...keys]
    );
  }

  async function savePermissions() {
    if (selectedUserId === "") return;
    setPermError("");
    setPermMsg("");
    try {
      await authApi.updatePermissions(selectedUserId, permissions, isAdminGrant, hideDonorNames);
      setPermMsg("Permissions saved.");
      await load();
    } catch (e) {
      setPermError((e as Error).message);
    }
  }

  const selectedUser = users.find((u) => u.id === selectedUserId) || null;
  const addDisabled =
    accountType === "local"
      ? !username || password.length < 8
      : !email.trim().includes("@");

  return (
    <div>
      <h2 className="page-title">Users</h2>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Add a user</h3>
        <div className="row">
          <label className="field" style={{ maxWidth: 220 }}>
            <span>Type</span>
            <select
              value={accountType}
              onChange={(e) => setAccountType(e.target.value as AccountType)}
            >
              <option value="local">Local (username/password)</option>
              <option value="google">Google sign-in</option>
            </select>
          </label>
        </div>

        {accountType === "local" ? (
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
          </div>
        ) : (
          <div className="row">
            <label className="field">
              <span>Google account</span>
              <input
                type="email"
                placeholder="name@crosswaymtc.org"
                value={email}
                autoFocus
                onChange={(e) => setEmail(e.target.value)}
                style={{ fontSize: 16, padding: "12px 14px" }}
              />
            </label>
          </div>
        )}

        <button className="btn" onClick={addUser} disabled={addDisabled}>
          Add user
        </button>
        {msg && <div className="ok">{msg}</div>}
        {error && <div className="error">{error}</div>}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Users</h3>
        <table className="resizable-cols">
          <ColGroup
            columns={["username", "email", "admin", "active", "created", "actions"]}
            widths={widths}
          />
          <thead>
            <tr>
              <th>
                Username
                <ColResizeHandle col="username" startResize={startResize} />
              </th>
              <th>
                Email
                <ColResizeHandle col="email" startResize={startResize} />
              </th>
              <th>
                Admin
                <ColResizeHandle col="admin" startResize={startResize} />
              </th>
              <th>
                Active
                <ColResizeHandle col="active" startResize={startResize} />
              </th>
              <th>
                Created
                <ColResizeHandle col="created" startResize={startResize} />
              </th>
              <th>
                <ColResizeHandle col="actions" startResize={startResize} />
              </th>
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
                <td>{u.email || "—"}</td>
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

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Permissions</h3>
        <p className="subtitle" style={{ marginTop: 0 }}>
          Pick a user, then grant Admin (full access to everything, including this
          page) or check individual pages. Only an admin can change this.
        </p>
        <label className="field" style={{ maxWidth: 340 }}>
          <span>User</span>
          <select
            value={selectedUserId}
            onChange={(e) => selectUserForPermissions(e.target.value ? Number(e.target.value) : "")}
          >
            <option value="">— select a user —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.username}
                {u.is_admin ? " (admin)" : ""}
              </option>
            ))}
          </select>
        </label>

        {selectedUser && (
          <>
            <label className="field-checkbox" style={{ marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={isAdminGrant}
                disabled={selectedUser.id === currentUserId}
                onChange={(e) => setIsAdminGrant(e.target.checked)}
              />
              <span>Admin (full access to everything)</span>
            </label>

            <label className="field-checkbox" style={{ marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={hideDonorNames}
                onChange={(e) => setHideDonorNames(e.target.checked)}
              />
              <span>
                Hide donor names (redacts donor name/email on the Campaign Details page for
                this user - applies even if they're an admin)
              </span>
            </label>

            {!isAdminGrant && (
              <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
                {GRANTABLE_PAGES.map((p) => (
                  <label key={p.keys.join("+")} className="field-checkbox" style={{ minWidth: 180 }}>
                    <input
                      type="checkbox"
                      checked={p.keys.every((k) => permissions.includes(k))}
                      onChange={() => togglePermission(p.keys)}
                    />
                    <span>{p.label}</span>
                  </label>
                ))}
              </div>
            )}

            <button
              className="btn"
              onClick={savePermissions}
              disabled={selectedUser.id === currentUserId && !isAdminGrant}
              style={{ marginTop: 14 }}
            >
              Save permissions
            </button>
            {permMsg && <div className="ok">{permMsg}</div>}
            {permError && <div className="error">{permError}</div>}
          </>
        )}
      </div>
    </div>
  );
}
