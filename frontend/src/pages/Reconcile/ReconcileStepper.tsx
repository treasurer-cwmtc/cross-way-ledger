const STEPS = [
  { key: 1, label: "Date range" },
  { key: 2, label: "Review" },
  { key: 3, label: "Check Stripe funds" },
  { key: 4, label: "Reconcile" },
  { key: 5, label: "Data validation" },
] as const;

/** Same progress-header pattern as pages/Upload/WizardStepper.tsx, with
 * this page's own step labels (steps 4-5 reuse that page's actual Step3/
 * Step4 components unmodified; steps 1-3 replace the file-upload ones with
 * date range + sync, bank-line review, and Stripe fund-coverage check -
 * see issue #122, these were dropped when the page was first built and
 * are restored here) - kept as its own copy rather than making the shared
 * one take a labels prop, so the (deprecated, kept only as a manual
 * fallback) Upload wizard's file stays untouched. */
export default function ReconcileStepper(props: {
  step: number;
  maxStepReached: number;
  onJump: (step: number) => void;
}) {
  const n = STEPS.length;
  const half = 100 / (2 * n);
  const doneFraction = Math.max(0, Math.min(1, (props.maxStepReached - 1) / (n - 1)));

  return (
    <div className="wizard-steps">
      <div className="wizard-steps-line" style={{ left: `${half}%`, right: `${half}%` }} />
      <div
        className="wizard-steps-line done"
        style={{ left: `${half}%`, right: `${half}%`, transform: `scaleX(${doneFraction})` }}
      />
      {STEPS.map((s) => {
        const done = s.key < props.step;
        const active = s.key === props.step;
        const reachable = s.key <= props.maxStepReached;
        return (
          <button
            key={s.key}
            className={`wizard-step${active ? " active" : ""}${done ? " done" : ""}`}
            onClick={() => reachable && props.onJump(s.key)}
            disabled={!reachable}
          >
            <span className="wizard-step-circle">{done ? "✓" : s.key}</span>
            <span className="wizard-step-label">{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}
