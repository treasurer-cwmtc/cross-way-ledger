import { useEffect, useState } from "react";
import { accountsApi, ChartAccount } from "../../api/accounts";
import { PcoPerson, Reimbursement, reimbursementsApi } from "../../api/reimbursements";
import MultiAccountPicker from "../ledger/MultiAccountPicker";

function fmtMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  paid: "Paid",
  rejected: "Rejected",
};

function QueueSection() {
  const [statusFilter, setStatusFilter] = useState("");
  const [requests, setRequests] = useState<Reimbursement[]>([]);
  const [selected, setSelected] = useState<Reimbursement | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    try {
      setRequests(await reimbursementsApi.list(statusFilter || undefined));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  function select(r: Reimbursement) {
    setSelected(r);
    setNotes(r.notes);
    setError("");
    setMsg("");
  }

  async function setStatus(status: string) {
    if (!selected) return;
    setError("");
    setMsg("");
    try {
      const updated = await reimbursementsApi.updateStatus(selected.id, status, notes);
      setSelected(updated);
      setMsg(`Marked ${STATUS_LABELS[status].toLowerCase()}.`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Reimbursement Requests</h3>
      <div className="row" style={{ marginBottom: 10 }}>
        <label className="field" style={{ maxWidth: 220 }}>
          <span>Status</span>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All</option>
            {Object.entries(STATUS_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Submitter</th>
            <th>Status</th>
            <th>Total</th>
            <th>Submitted</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.id} onClick={() => select(r)} style={{ cursor: "pointer" }}>
              <td>{r.name}</td>
              <td>
                {r.submitter_name} <span className="subtitle">({r.submitter_email})</span>
              </td>
              <td>{STATUS_LABELS[r.status]}</td>
              <td>{fmtMoney(r.total_amount)}</td>
              <td>{new Date(r.submitted_at).toLocaleString()}</td>
            </tr>
          ))}
          {requests.length === 0 && (
            <tr>
              <td colSpan={5} className="subtitle">
                No requests yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {selected && (
        <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
          <h4 style={{ marginTop: 0 }}>
            {selected.name} — {fmtMoney(selected.total_amount)}
          </h4>
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Amount</th>
                <th>Description</th>
                <th>Receipt</th>
              </tr>
            </thead>
            <tbody>
              {selected.lines.map((line) => (
                <tr key={line.id}>
                  <td>
                    {line.account_no} · {line.statement_description}
                  </td>
                  <td>{fmtMoney(line.amount)}</td>
                  <td>{line.description}</td>
                  <td>
                    {line.receipt_web_view_link ? (
                      <a href={line.receipt_web_view_link} target="_blank" rel="noreferrer">
                        {line.receipt_file_name || "View"}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <label className="field" style={{ marginTop: 10 }}>
            <span>Notes (visible to the submitter)</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </label>

          <div className="row" style={{ marginTop: 10, gap: 8 }}>
            {selected.status === "pending" && (
              <>
                <button className="btn" onClick={() => setStatus("approved")}>
                  Approve
                </button>
                <button className="btn secondary" onClick={() => setStatus("rejected")}>
                  Reject
                </button>
              </>
            )}
            {selected.status === "approved" && (
              <button className="btn" onClick={() => setStatus("paid")}>
                Mark Paid
              </button>
            )}
            <button className="btn secondary" onClick={() => setStatus(selected.status)}>
              Save notes
            </button>
          </div>
          {msg && <div className="ok">{msg}</div>}
          {error && <div className="error">{error}</div>}
        </div>
      )}
    </div>
  );
}

function AssignmentsSection() {
  const [people, setPeople] = useState<PcoPerson[]>([]);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [email, setEmail] = useState("");
  const [assigned, setAssigned] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    reimbursementsApi.listPcoPeople().then(setPeople).catch((e) => setError((e as Error).message));
    accountsApi.listAccounts().then(setAccounts).catch((e) => setError((e as Error).message));
  }, []);

  async function selectEmail(value: string) {
    setEmail(value);
    setError("");
    setMsg("");
    if (!value) {
      setAssigned([]);
      return;
    }
    try {
      const rows = await reimbursementsApi.getAssignments(value);
      setAssigned(rows.map((r) => r.account_no));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function save() {
    setError("");
    setMsg("");
    try {
      await reimbursementsApi.setAssignments(email, assigned);
      setMsg("Assignments saved.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // A person's email may appear on more than one PCO record (shared
  // household emails) - dedupe to one dropdown entry per email, showing
  // whichever name comes first.
  const byEmail = new Map<string, string>();
  for (const p of people) {
    if (p.email && !byEmail.has(p.email)) byEmail.set(p.email, p.name);
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Reimbursement Access</h3>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Pick an email from the imported PCO People list, then choose which Chart-of-Accounts
        they're allowed to submit reimbursements against.
      </p>
      <label className="field" style={{ maxWidth: 360 }}>
        <span>Email</span>
        <select value={email} onChange={(e) => selectEmail(e.target.value)}>
          <option value="">— select an email —</option>
          {[...byEmail.entries()].map(([addr, name]) => (
            <option key={addr} value={addr}>
              {name} ({addr})
            </option>
          ))}
        </select>
      </label>

      {email && (
        <>
          <div style={{ marginTop: 12 }}>
            <MultiAccountPicker value={assigned} accounts={accounts} onChange={setAssigned} />
          </div>
          <button className="btn" onClick={save} style={{ marginTop: 14 }}>
            Save assignments
          </button>
        </>
      )}
      {msg && <div className="ok">{msg}</div>}
      {error && <div className="error">{error}</div>}
    </div>
  );
}

function PcoImportSection() {
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  async function upload() {
    if (!file) return;
    setError("");
    setMsg("");
    try {
      const result = await reimbursementsApi.importPcoPeople(file);
      setMsg(`Imported ${result.people_imported} people.`);
      setFile(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Import PCO People</h3>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Upload the Planning Center People export. This is the allowlist for who can log into
        the Reimbursement portal - only emails on this list can request a login code.
      </p>
      <div className="row">
        <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <button className="btn" onClick={upload} disabled={!file}>
          Import
        </button>
      </div>
      {msg && <div className="ok">{msg}</div>}
      {error && <div className="error">{error}</div>}
    </div>
  );
}

export default function Reimbursements() {
  return (
    <div>
      <h2 className="page-title">Reimbursements</h2>
      <QueueSection />
      <AssignmentsSection />
      <PcoImportSection />
    </div>
  );
}
