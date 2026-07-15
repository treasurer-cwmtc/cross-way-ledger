import { useEffect, useState } from "react";
import { settingsApi } from "../../api/settings";

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function yearOf(iso: string): string {
  return iso.slice(0, 4) || "—";
}

/** Mirrors the legacy sheet's "Configurations" tab. Every value here is a
 * generic AppSetting (key/value) - editable by hand, nothing derived from
 * the server's real-world date, same as the sheet the treasurer is used to. */
export default function Config() {
  return (
    <div>
      <h2 className="page-title">Config</h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        App-wide settings the treasurer adjusts by hand, matching the legacy
        sheet's Configurations tab. Nothing here is derived from today's real
        date - update it yourself at year-end rollover or whenever else it's
        needed.
      </p>
      <FiscalYearCard />
      <FrequencyCard />
      <AuditValidationCard />
    </div>
  );
}

function FiscalYearCard() {
  const [currentYearDate, setCurrentYearDate] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    settingsApi
      .get("prior_year_end_date")
      .then((s) => setCurrentYearDate(addDays(s.value, 1)))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const priorYearDate = currentYearDate ? addDays(currentYearDate, -1) : "";

  async function save() {
    setError("");
    setSaved(false);
    try {
      await settingsApi.update("prior_year_end_date", priorYearDate);
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Fiscal year (CY / PY)</h3>
      <p className="subtitle">
        Drives the Txn CY/PY and Posted CY/PY columns on Actual and
        Accrual: any date after Current Year Date counts as "CY", everything
        before is "PY". Update this once a year at rollover (matches the
        sheet's Current Year Date, Prior Year Date, Current Year, and Prior
        Year cells).
      </p>
      {loading ? (
        <p className="subtitle">Loading…</p>
      ) : (
        <>
          <div className="row">
            <label className="field">
              <span>Current Year Date</span>
              <input
                type="date"
                value={currentYearDate}
                onChange={(e) => {
                  setCurrentYearDate(e.target.value);
                  setSaved(false);
                }}
              />
            </label>
          </div>
          <div className="modal-readonly-grid" style={{ marginBottom: 14 }}>
            <div>
              <span>Prior Year Date</span>
              {priorYearDate || "—"}
            </div>
            <div>
              <span>Current Year</span>
              {yearOf(currentYearDate)}
            </div>
            <div>
              <span>Prior Year</span>
              {yearOf(priorYearDate)}
            </div>
          </div>
          <div className="toolbar">
            <button className="btn" onClick={save} disabled={!currentYearDate}>
              Save
            </button>
            {saved && <span className="ok">Saved.</span>}
          </div>
        </>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}

function FrequencyCard() {
  const [monthly, setMonthly] = useState("");
  const [yearly, setYearly] = useState("");
  const [quarterly, setQuarterly] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      settingsApi.get("frequency_monthly"),
      settingsApi.get("frequency_yearly"),
      settingsApi.get("frequency_quarterly"),
    ])
      .then(([m, y, q]) => {
        setMonthly(m.value);
        setYearly(y.value);
        setQuarterly(q.value);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setError("");
    setSaved(false);
    try {
      await Promise.all([
        settingsApi.update("frequency_monthly", monthly),
        settingsApi.update("frequency_yearly", yearly),
        settingsApi.update("frequency_quarterly", quarterly),
      ]);
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Frequency</h3>
      <p className="subtitle">Periods per year, matching the sheet's Frequency lookup table.</p>
      {loading ? (
        <p className="subtitle">Loading…</p>
      ) : (
        <>
          <div className="row">
            <label className="field">
              <span>Monthly</span>
              <input
                type="number"
                value={monthly}
                onChange={(e) => {
                  setMonthly(e.target.value);
                  setSaved(false);
                }}
              />
            </label>
            <label className="field">
              <span>Yearly</span>
              <input
                type="number"
                value={yearly}
                onChange={(e) => {
                  setYearly(e.target.value);
                  setSaved(false);
                }}
              />
            </label>
            <label className="field">
              <span>Quarterly</span>
              <input
                type="number"
                value={quarterly}
                onChange={(e) => {
                  setQuarterly(e.target.value);
                  setSaved(false);
                }}
              />
            </label>
          </div>
          <div className="toolbar">
            <button className="btn" onClick={save}>
              Save
            </button>
            {saved && <span className="ok">Saved.</span>}
          </div>
        </>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}

function AuditValidationCard() {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      settingsApi.get("audit_validation_from_date"),
      settingsApi.get("audit_validation_to_date"),
    ])
      .then(([f, t]) => {
        setFromDate(f.value);
        setToDate(t.value);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setError("");
    setSaved(false);
    try {
      await Promise.all([
        settingsApi.update("audit_validation_from_date", fromDate),
        settingsApi.update("audit_validation_to_date", toDate),
      ]);
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Audit validation</h3>
      <p className="subtitle">
        A date range for spot-checking a specific stretch of transactions,
        matching the sheet's Audit Validation From/To Date cells. Not tied to
        the fiscal year above - set it to whatever range you're auditing.
      </p>
      {loading ? (
        <p className="subtitle">Loading…</p>
      ) : (
        <>
          <div className="row">
            <label className="field">
              <span>From Date</span>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setSaved(false);
                }}
              />
            </label>
            <label className="field">
              <span>To Date</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                  setSaved(false);
                }}
              />
            </label>
          </div>
          <div className="toolbar">
            <button className="btn" onClick={save}>
              Save
            </button>
            {saved && <span className="ok">Saved.</span>}
          </div>
        </>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
