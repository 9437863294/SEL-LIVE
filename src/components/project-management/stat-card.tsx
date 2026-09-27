import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export default function StatCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone: string;
}) {
  // Callers lay these out two to a row on a phone (~150px each), so the chip, padding and figure
  // all step down there; a rupee figure still wraps rather than spilling out of the card.
  return (
    <Card>
      <CardContent className="flex items-center gap-2.5 p-3 sm:gap-3 sm:p-4">
        <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg sm:h-10 sm:w-10", tone)}>
          <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
        </div>
        <div className="min-w-0">
          <p className="break-words text-lg font-bold leading-tight sm:text-2xl">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
