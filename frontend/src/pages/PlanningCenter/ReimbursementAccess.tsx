import { useEffect, useState } from "react";
import { PcoListOption, reimbursementsApi } from "../../api/reimbursements";

/** Planning Center > Reimbursement Access - optionally narrows who can log
 * into the Reimbursement portal from "every active PCO Person" (the
 * default, see PlanningCenter/People.tsx) down to members of one specific
 * PCO List. Clearing the selection goes back to the default. Every People
 * sync also re-syncs this list's membership, so a single "Sync now" on
 * either screen keeps both current. */
export default function ReimbursementAccess() {
  const [options, setOptions] = useState<PcoListOption[] | null>(null);
  const [current, setCurrent] = useState<{ list_id: string | null; list_name: string | null; member_count: number } | null>(
    null
  );
  const [selected, setSelected] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  function load() {
    setError("");
    reimbursementsApi
      .getGateList()
      .then((r) => {
        setCurrent(r);
        setSelected(r.list_id ?? "");
      })
      .catch((e) => setError((e as Error).message));
    reimbursementsApi.listPcoLists().then(setOptions).catch((e) => setError((e as Error).message));
  }

  useEffect(load, []);

  async function save() {
    setSaving(true);
    setError("");
    setMsg("");
    try {
      const result = await reimbursementsApi.setGateList(selected || null);
      setCurrent(result);
      setMsg(
        selected
          ? `Reimbursement portal login is now limited to "${result.list_name}" (${result.member_count} people).`
          : "Reimbursement portal login is open to any active PCO Person again."
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2 className="page-title">Planning Center · Reimbursement Access</h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        By default, any active PCO Person (see Planning Center &gt; People) can request a login
        code for the Reimbursement portal. Pick a PCO List here to narrow that down to just its
        members instead - clear the selection to go back to the default.
      </p>

      {error && <div className="error">{error}</div>}
      {msg && <div className="ok">{msg}</div>}

      {current && (
        <p className="pill">
          Currently: {current.list_id ? `"${current.list_name}" - ${current.member_count} people` : "Any active person"}
        </p>
      )}

      <div className="row" style={{ alignItems: "center" }}>
        <label className="field" style={{ minWidth: 280 }}>
          <span>Gate list</span>
          <select value={selected} onChange={(e) => setSelected(e.target.value)} disabled={!options}>
            <option value="">— any active person (default) —</option>
            {(options ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" onClick={save} disabled={saving || !options}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
