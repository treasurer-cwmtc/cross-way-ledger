import { useEffect, useState } from "react";
import { bankAccountsApi, BankAccount } from "../../api/bankAccounts";
import { ReconRun } from "../../api/reconcile";
import { Rule } from "../../api/rules";
import Step3Reconcile from "../Upload/Step3Reconcile";
import Step4Validate from "../Upload/Step4Validate";
import ReconcileStepper from "./ReconcileStepper";
import Step1DateRange, { isoDaysAgo } from "./Step1DateRange";
import Step2Sync from "./Step2Sync";

/** Replaces the (deprecated, hidden-from-nav) Upload wizard's manual
 * file-upload steps with the automated Stripe/Plaid sync - steps 3 and 4
 * are the exact same components Upload used, completely unmodified, only
 * fed by a run that came from ledger_plaid/ledger_stripe instead of an
 * uploaded CSV. See docs/guides/bank-reconciliation-upload-wizard.md and
 * issue #105 for the full design reasoning. */
export default function Reconcile() {
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [bankAccountId, setBankAccountId] = useState<number | "">("");
  const [error, setError] = useState("");

  const [step, setStep] = useState(1);
  const [maxStepReached, setMaxStepReached] = useState(1);

  const [startDate, setStartDate] = useState(isoDaysAgo(30));
  const [endDate, setEndDate] = useState(isoDaysAgo(0));
  const [run, setRun] = useState<ReconRun | null>(null);
  const [rulesAdded, setRulesAdded] = useState<Rule[]>([]);
  const [importResult, setImportResult] = useState<{
    imported: number;
    skipped_duplicates: number;
  } | null>(null);

  useEffect(() => {
    bankAccountsApi
      .list()
      .then((accounts) => {
        setBankAccounts(accounts);
        if (accounts.length) setBankAccountId(accounts[0].id);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  function goTo(n: number) {
    setStep(n);
    setMaxStepReached((m) => Math.max(m, n));
  }

  function startOver() {
    setStep(1);
    setMaxStepReached(1);
    setRun(null);
    setRulesAdded([]);
    setImportResult(null);
  }

  return (
    <div>
      <h2 className="page-title">Reconciliation</h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        A guided reconciliation: pick a date range, sync Stripe and Bank Transactions fresh,
        then reconcile and validate before pushing to Actual - the same reconciliation logic
        the Upload wizard always used, just fed by the automated syncs instead of a manual
        file upload.
      </p>
      {error && <div className="error">{error}</div>}
      {!bankAccounts.length && !error && (
        <p className="subtitle">
          No bank account is set up yet - add one on the Setup page before continuing.
        </p>
      )}

      {importResult ? (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Done</h3>
          <p className="ok">
            ✓ Added {importResult.imported} line{importResult.imported === 1 ? "" : "s"} to
            Actual
            {importResult.skipped_duplicates
              ? ` (${importResult.skipped_duplicates} already there, skipped).`
              : "."}
          </p>
          <button className="btn" onClick={startOver}>
            Start another reconciliation
          </button>
        </div>
      ) : (
        <>
          <ReconcileStepper step={step} maxStepReached={maxStepReached} onJump={goTo} />

          {step === 1 && (
            <Step1DateRange
              startDate={startDate}
              endDate={endDate}
              onStartDateChange={setStartDate}
              onEndDateChange={setEndDate}
              onNext={() => goTo(2)}
            />
          )}

          {step === 2 && (
            <Step2Sync
              startDate={startDate}
              endDate={endDate}
              onRunCreated={setRun}
              onNext={() => goTo(3)}
            />
          )}

          {step === 3 && run && (
            <Step3Reconcile run={run} onRunChange={setRun} onNext={() => goTo(4)} />
          )}

          {step === 4 && run && (
            <Step4Validate
              run={run}
              bankAccountId={bankAccountId}
              rulesAdded={rulesAdded}
              onImported={setImportResult}
            />
          )}
        </>
      )}
    </div>
  );
}
