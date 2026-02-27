interface Step {
  key: string;
  label: string;
}

interface StepIndicatorProps {
  steps: Step[];
  currentStep: string;
  /** Keys of steps that should show as completed */
  completedSteps?: string[];
}

export function StepIndicator({ steps, currentStep, completedSteps = [] }: StepIndicatorProps) {
  return (
    <div className="flex items-center gap-2 mt-5">
      {steps.map((s, i) => {
        const isActive = s.key === currentStep;
        const isDone = completedSteps.includes(s.key);

        return (
          <div key={s.key} className="flex items-center gap-2">
            {i > 0 && (
              <div
                className={`w-8 h-0.5 rounded-full transition-colors duration-300 ${
                  isDone ? "bg-primary" : "bg-border"
                }`}
              />
            )}
            <span
              className={`text-xs font-medium px-3 py-1 rounded-full transition-all duration-300 ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : isDone
                  ? "bg-primary/20 text-primary"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
