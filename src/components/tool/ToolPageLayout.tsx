import type { LucideIcon } from "lucide-react";
import { StepIndicator } from "./StepIndicator";
import { TrustBadges, type TrustBadge } from "./TrustBadges";

interface ToolPageLayoutProps {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  steps: { key: string; label: string }[];
  currentStep: string;
  completedSteps?: string[];
  trustBadges?: TrustBadge[];
  showBadgesOnStep?: string;
  children: React.ReactNode;
}

export function ToolPageLayout({
  icon: Icon,
  title,
  subtitle,
  steps,
  currentStep,
  completedSteps = [],
  trustBadges,
  showBadgesOnStep = "upload",
  children,
}: ToolPageLayoutProps) {
  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      {/* Header */}
      <div className="mb-8 animate-fade-in">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
            <Icon className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h1
              className="text-2xl font-bold text-foreground"
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            >
              {title}
            </h1>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
        </div>

        <StepIndicator steps={steps} currentStep={currentStep} completedSteps={completedSteps} />
      </div>

      {/* Trust badges */}
      {trustBadges && currentStep === showBadgesOnStep && (
        <TrustBadges badges={trustBadges} />
      )}

      {children}
    </div>
  );
}
