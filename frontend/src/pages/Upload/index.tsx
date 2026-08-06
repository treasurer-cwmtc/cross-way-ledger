import { useEffect, useState } from "react";
import { accountsApi, ChartAccount } from "../../api/accounts";
import { bankAccountsApi, BankAccount } from "../../api/bankAccounts";
import { ReconRun, StripeFundCheckResult } from "../../api/reconcile";
import { Rule } from "../../api/rules";
import Step1BankUpload from "./Step1BankUpload";
import Step2StripeUpload from "./Step2StripeUpload";
import Step3Reconcile from "./Step3Reconcile";
import Step4Validate from "./Step4Validate";
import WizardStepper from "./WizardStepper";

export default function Upload() {
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [error, setError] = useState("");

  const [step, setStep] = useState(1);
  const [maxStepReached, setMaxStepReached] = useState(1);

  const [bankAccountId, setBankAccountId] = useState<number | "">("");
  const [run, setRun] = useState<ReconRun | null>(null);
  const [stripeFile, setStripeFile] = useState<File | null>(null);
  const [stripeCheck, setStripeCheck] = useState<StripeFundCheckResult | null>(null);
  const [rulesAdded, setRulesAdded] = useState<Rule[]>([]);
  const [importResult, setImportResult] = useState<{
    imported: number;
    skipped_duplicates: number;
  } | null>(null);

  useEffect(() => {
    Promise.all([bankAccountsApi.list(), accountsApi.listAccounts()])
      .then(([b, a]) => {
        setBankAccounts(b);
        setAccounts(a);
        if (b.length) setBankAccountId(b[0].id);
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
    setStripeFile(null);
    setStripeCheck(null);
    setRulesAdded([]);
    setImportResult(null);
  }

  return (
    <div>
      <h2 className="page-title">Upload</h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        A guided, 4-step import: bank statement, Stripe transactions, reconcile the two,
        then validate before pushing to Actual.
      </p>
      {error && <div className="error">{error}</div>}

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
            Upload another statement
          </button>
        </div>
      ) : (
        <>
          <WizardStepper step={step} maxStepReached={maxStepReached} onJump={goTo} />

          {step === 1 && (
            <Step1BankUpload
              bankAccounts={bankAccounts}
              accounts={accounts}
              bankAccountId={bankAccountId}
              onBankAccountChange={setBankAccountId}
              run={run}
              onRunChange={setRun}
              onRuleAdded={(r) => setRulesAdded((prev) => [...prev, r])}
              onNext={() => goTo(2)}
            />
          )}

          {step === 2 && (
            <Step2StripeUpload
              accounts={accounts}
              stripeFile={stripeFile}
              onStripeFileChange={setStripeFile}
              check={stripeCheck}
              onCheckChange={setStripeCheck}
              rulesAdded={rulesAdded}
              onRuleAdded={(r) => setRulesAdded((prev) => [...prev, r])}
              onNext={() => goTo(3)}
            />
          )}

          {step === 3 && run && (
            <Step3Reconcile
              run={run}
              stripeFile={stripeFile}
              onRunChange={setRun}
              onNext={() => goTo(4)}
            />
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
