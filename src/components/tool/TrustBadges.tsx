import type { LucideIcon } from "lucide-react";

export interface TrustBadge {
  icon: LucideIcon;
  label: string;
}

interface TrustBadgesProps {
  badges: TrustBadge[];
}

export function TrustBadges({ badges }: TrustBadgesProps) {
  return (
    <div className="flex items-center gap-6 mb-6 text-xs text-muted-foreground animate-fade-in">
      {badges.map((badge) => (
        <span key={badge.label} className="flex items-center gap-1.5">
          <badge.icon className="w-3.5 h-3.5 text-primary" />
          {badge.label}
        </span>
      ))}
    </div>
  );
}
