"use client";

import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  ChartNoAxesCombined,
  History,
  IndianRupee,
  Landmark,
  ShieldAlert,
  Store,
  Timer,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import ProfessionalRecurringReports from "./professional-reports";

interface ReportTile {
  title: string;
  description: string;
  href: string;
  icon: React.ElementType;
}

const REPORT_TILES: ReportTile[] = [
  { title: "Upcoming Payments", description: "Obligations due in a selected future period", href: "/recurring-payments/reports/upcoming", icon: CalendarClock },
  { title: "Overdue Payments", description: "Outstanding items grouped by ageing", href: "/recurring-payments/reports/overdue", icon: AlertTriangle },
  { title: "Expense Summary", description: "Bills actually received, by category and vendor", href: "/recurring-payments/reports/expenses", icon: ChartNoAxesCombined },
  { title: "Cash-Flow Forecast", description: "Expected and confirmed outflow, plus a 7–90 day horizon view", href: "/recurring-payments/reports/cash-flow", icon: IndianRupee },
  { title: "Vendor Spend & Ageing", description: "Total paid, outstanding and ageing, per vendor", href: "/recurring-payments/reports/vendor-spend", icon: Store },
  { title: "Pending Work Aging", description: "What's stuck at which workflow step right now, for how long, and with whom", href: "/recurring-payments/reports/pending-work", icon: Timer },
  { title: "Payment Mode & Bank Reconciliation", description: "How recorded payments moved, by mode and account", href: "/recurring-payments/reports/payment-modes", icon: Landmark },
  { title: "Automation & Generation Health", description: "Masters not generating and obligations stuck before workflow", href: "/recurring-payments/reports/automation-health", icon: ShieldAlert },
  { title: "Workflow Completion Summary", description: "Step-wise workload, on-time rate and exactly what completed when", href: "/recurring-payments/reports/workflow-completion", icon: History },
];

export default function RecurringReportsHome() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-slate-700">Jump to a report</h2>
        <p className="text-xs text-muted-foreground">
          Each has its own filters and export. The overview below never needs any — it's always the full picture.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {REPORT_TILES.map(({ title, description, href, icon: Icon }) => (
          <Link href={href} key={href} className="min-w-0">
            <Card className="h-full transition hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md">
              <CardContent className="flex h-full flex-col gap-2 p-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-tight text-slate-900">{title}</p>
                  <p className="mt-1 text-xs leading-snug text-muted-foreground">{description}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
      <ProfessionalRecurringReports />
    </div>
  );
}
