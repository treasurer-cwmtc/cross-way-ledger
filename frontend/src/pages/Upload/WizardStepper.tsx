const STEPS = [
  { key: 1, label: "Bank upload" },
  { key: 2, label: "Stripe upload" },
  { key: 3, label: "Reconcile" },
  { key: 4, label: "Data validation" },
] as const;

/** 4-step progress header. Only lets you jump back to a step you've already
 * completed - not forward past one you haven't finished yet. */
export default function WizardStepper(props: {
  step: number;
  maxStepReached: number;
  onJump: (step: number) => void;
}) {
  return (
    <div className="wizard-steps">
      {STEPS.map((s, i) => {
        const done = s.key < props.step;
        const active = s.key === props.step;
        const reachable = s.key <= props.maxStepReached;
        return (
          <div key={s.key} className="wizard-step-wrap">
            {i > 0 && (
              <div className={`wizard-step-connector${s.key <= props.maxStepReached ? " done" : ""}`} />
            )}
            <button
              className={`wizard-step${active ? " active" : ""}${done ? " done" : ""}`}
              onClick={() => reachable && props.onJump(s.key)}
              disabled={!reachable}
            >
              <span className="wizard-step-circle">{done ? "✓" : s.key}</span>
              <span className="wizard-step-label">{s.label}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
