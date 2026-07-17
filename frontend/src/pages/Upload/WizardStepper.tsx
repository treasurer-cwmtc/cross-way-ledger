const STEPS = [
  { key: 1, label: "Bank upload" },
  { key: 2, label: "Stripe upload" },
  { key: 3, label: "Reconcile" },
  { key: 4, label: "Data validation" },
] as const;

/** 4-step progress header. Only lets you jump back to a step you've already
 * completed - not forward past one you haven't finished yet. Evenly spaced:
 * each step gets an equal-width column, with a single connecting line drawn
 * behind them (not per-segment), so spacing doesn't depend on label length. */
export default function WizardStepper(props: {
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
