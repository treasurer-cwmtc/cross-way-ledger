import { useEffect, useState } from "react";
import { accountsApi, ChartAccount } from "../../api/accounts";
import {
  PcoPerson,
  Reimbursement,
  ReimbursementAccessSummary,
  reimbursementsApi,
} from "../../api/reimbursements";
import MultiAccountPicker from "../ledger/MultiAccountPicker";
import MultiEmailPicker from "./MultiEmailPicker";
import AccessDetailModal from "./AccessDetailModal";

function fmtMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] || "", last: parts.slice(1).join(" ") };
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  paid: "Paid",
  rejected: "Rejected",
};

const STATUS_PILL_CLASS: Record<string, string> = {
  pending: "warn",
  paid: "bank",
  rejected: "danger",
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
              <td>
                <span className={"pill lg " + STATUS_PILL_CLASS[r.status]}>{STATUS_LABELS[r.status]}</span>
              </td>
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
                <th>Date</th>
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
                  <td>{line.transaction_date || "—"}</td>
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
                <button className="btn" onClick={() => setStatus("paid")}>
                  Mark Paid
                </button>
                <button className="btn secondary" onClick={() => setStatus("rejected")}>
                  Reject
                </button>
              </>
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
  const [summary, setSummary] = useState<ReimbursementAccessSummary[]>([]);
  const [detailFor, setDetailFor] = useState<ReimbursementAccessSummary | null>(null);
  const [emails, setEmails] = useState<string[]>([]);
  const [assigned, setAssigned] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  function loadSummary() {
    reimbursementsApi.getAssignmentsSummary().then(setSummary).catch((e) => setError((e as Error).message));
  }

  useEffect(() => {
    reimbursementsApi.listPcoPeople().then(setPeople).catch((e) => setError((e as Error).message));
    accountsApi.listAccounts().then(setAccounts).catch((e) => setError((e as Error).message));
    loadSummary();
  }, []);

  // Budget accounts are planning figures, never real expenses/income - a
  // reimbursement should never be allowed to post against one.
  const assignableAccounts = accounts.filter((a) => a.category !== "Budget");

  async function selectEmails(values: string[]) {
    setEmails(values);
    setError("");
    setMsg("");
    // Only prefill from an existing person's assignments when exactly one
    // is selected - with several selected at once, their existing sets may
    // differ, and prefilling from just one would be misleading. Saving
    // with multiple selected applies the same chosen list to everyone
    // picked (see `save` below), so start from a clean slate.
    if (values.length === 1) {
      try {
        const rows = await reimbursementsApi.getAssignments(values[0]);
        setAssigned(rows.map((r) => r.account_no));
      } catch (e) {
        setError((e as Error).message);
      }
    } else {
      setAssigned([]);
    }
  }

  async function save() {
    setError("");
    setMsg("");
    try {
      await Promise.all(emails.map((email) => reimbursementsApi.setAssignments(email, assigned)));
      setMsg(
        emails.length === 1
          ? "Assignments saved."
          : `Assignments saved for ${emails.length} people.`
      );
      loadSummary();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Reimbursement Access</h3>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Pick one or more people from the imported PCO People list, then choose which
        Chart-of-Accounts they're allowed to submit reimbursements against. Selecting more than
        one person applies the same account list to everyone selected.
      </p>
      <label className="field" style={{ maxWidth: 480 }}>
        <span>People</span>
        <MultiEmailPicker value={emails} people={people} onChange={selectEmails} />
      </label>

      {emails.length > 0 && (
        <>
          <div style={{ marginTop: 12 }}>
            <MultiAccountPicker value={assigned} accounts={assignableAccounts} onChange={setAssigned} />
          </div>
          <button className="btn" onClick={save} style={{ marginTop: 14 }}>
            Save assignments
          </button>
        </>
      )}
      {msg && <div className="ok">{msg}</div>}
      {error && <div className="error">{error}</div>}

      <h4 style={{ marginTop: 24, marginBottom: 8 }}>People with access</h4>
      <table>
        <thead>
          <tr>
            <th>First Name</th>
            <th>Last Name</th>
            <th>Email</th>
          </tr>
        </thead>
        <tbody>
          {summary.map((s) => {
            const { first, last } = splitName(s.name);
            return (
              <tr key={s.email} onClick={() => setDetailFor(s)} style={{ cursor: "pointer" }}>
                <td>{first || "—"}</td>
                <td>{last || "—"}</td>
                <td>{s.email}</td>
              </tr>
            );
          })}
          {summary.length === 0 && (
            <tr>
              <td colSpan={3} className="subtitle">
                No one has been granted access yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {detailFor && (
        <AccessDetailModal
          summary={detailFor}
          accounts={accounts}
          onClose={() => setDetailFor(null)}
          onSaved={loadSummary}
        />
      )}
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
