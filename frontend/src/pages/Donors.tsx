import { useEffect, useState } from "react";
import { donorsApi, Donor } from "../api/donors";

function fmtMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

/** The persistent Giving App donor list - "Giving App - Donors" under
 * Setup. Reusable for any reporting, not tied to a single pledge campaign;
 * kept simple/read-only since it's refreshed via each campaign's import
 * wizard rather than hand-edited here. */
export default function Donors() {
  const [donors, setDonors] = useState<Donor[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    donorsApi.list().then(setDonors).catch((err) => setError((err as Error).message));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!donors) return <p className="subtitle">Loading…</p>;

  const q = query.trim().toLowerCase();
  const filtered = !q
    ? donors
    : donors.filter(
        (d) =>
          `${d.first_name} ${d.last_name}`.toLowerCase().includes(q) ||
          d.email.toLowerCase().includes(q)
      );

  return (
    <div>
      <h2 className="page-title">Giving App - Donors</h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        The donor list from the Giving App, refreshed by each pledge campaign's import wizard -
        shared across any reporting that needs it. {donors.length} donors on file.
      </p>

      <input
        type="text"
        placeholder="Search by name or email…"
        value={query}
        onChange={(ev) => setQuery(ev.target.value)}
        style={{ marginBottom: 14, maxWidth: 320 }}
      />

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>City</th>
              <th>State</th>
              <th># Gifts</th>
              <th>Lifetime Total</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((d) => (
              <tr key={d.donor_id}>
                <td>
                  {d.first_name} {d.last_name}
                </td>
                <td>{d.email}</td>
                <td>{d.phone_number}</td>
                <td>{d.city}</td>
                <td>{d.state}</td>
                <td>{d.donation_count}</td>
                <td>{fmtMoney(d.total_given)}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="subtitle">
                  No donors match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
