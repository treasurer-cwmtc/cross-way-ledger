const STEPS = [
  { key: 1, label: "Date range" },
  { key: 2, label: "Sync" },
  { key: 3, label: "Reconcile" },
  { key: 4, label: "Data validation" },
] as const;

/** Same 4-step progress header as pages/Upload/WizardStepper.tsx, just with
 * this page's own step labels (steps 3-4 reuse that page's actual Step3/
 * Step4 components, but this page's own steps 1-2 replace the file-upload
 * ones with a date range + sync step) - kept as its own copy rather than
 * making the shared one take a labels prop, so the (deprecated, kept only
 * as a manual fallback) Upload wizard's file stays untouched. */
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
