'use client';

/**
 * The Expenses reports, as a page to choose from rather than a list in the sidebar: every report
 * under a thin heading for its category, one line each — icon, name and what it shows — and a
 * search across them all.
 * `/expenses/reports` opens here; a report opens at `?report=<id>`, where `ReportSwitcher` moves
 * to another without coming back.
 *
 * The list is the catalogue in `@/lib/expenses-reports` plus the custom pivot, so a report added
 * there shows up here — and in the switcher — with nothing else to change.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BadgeIndianRupee,
  BarChart3,
  BookOpen,
  Building2,
  CalendarDays,
  ChevronRight,
  Copy,
  FileText,
  FolderKanban,
  Grid3x3,
  Hourglass,
  Inbox,
  LayoutGrid,
  Layers,
  ListTree,
  PieChart,
  ScrollText,
  ShieldCheck,
  Table2,
  TrendingUp,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { ToolbarSearch } from '@/components/bill-tracking/bt-toolbar';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EXPENSE_REPORTS, EXPENSE_REPORT_GROUPS, type ExpenseReportGroup } from '@/lib/expenses-reports';
import { cn } from '@/lib/utils';

/** The custom pivot sits in the list alongside the fixed reports, under its own id. */
export const PIVOT_REPORT_ID = 'custom-pivot';

type HubGroup = ExpenseReportGroup | 'Custom';

const HUB_GROUPS: HubGroup[] = [...EXPENSE_REPORT_GROUPS, 'Custom'];

/** Each group's icon, its chip colours, and a line on what its reports are for. */
const GROUP_LOOKS: Record<HubGroup, { icon: LucideIcon; chip: string; hint: string }> = {
  Summary: { icon: BarChart3, chip: 'bg-cyan-50 text-cyan-600', hint: 'Totals by department and by project' },
  Breakdown: { icon: Layers, chip: 'bg-emerald-50 text-emerald-600', hint: 'Spend taken apart by head, sub-head, party and requester' },
  Trend: { icon: TrendingUp, chip: 'bg-violet-50 text-violet-600', hint: 'Day by day, month by month, and two ways at once' },
  Control: { icon: ShieldCheck, chip: 'bg-amber-50 text-amber-600', hint: 'What is waiting, unusually large or possibly raised twice' },
  Payments: { icon: Wallet, chip: 'bg-indigo-50 text-indigo-600', hint: 'Where each request stands in Daily Requisition' },
  Detail: { icon: FileText, chip: 'bg-slate-100 text-slate-600', hint: 'Every request, one row each' },
  Custom: { icon: Table2, chip: 'bg-fuchsia-50 text-fuchsia-600', hint: 'Rows, columns and figures of your own choosing' },
};

/** Each report's own icon; one not listed here takes its group's. */
const REPORT_ICONS: Record<string, LucideIcon> = {
  'department-summary': Building2,
  'project-summary': FolderKanban,
  'head-summary': BookOpen,
  'subhead-summary': ListTree,
  'party-summary': Users,
  'raised-by-summary': UserRound,
  'monthly-trend': TrendingUp,
  'daily-summary': CalendarDays,
  'department-month-matrix': Grid3x3,
  'project-month-matrix': Grid3x3,
  'head-department-matrix': LayoutGrid,
  'pending-reception': Inbox,
  'reception-aging': Hourglass,
  'high-value': BadgeIndianRupee,
  'duplicate-suspects': Copy,
  'payment-status': Wallet,
  'payment-summary': PieChart,
  'expense-register': ScrollText,
  'custom-pivot': Table2,
};

export interface HubReport {
  id: string;
  title: string;
  description: string;
  group: HubGroup;
}

export const HUB_REPORTS: HubReport[] = [
  ...EXPENSE_REPORTS.map((report) => ({ id: report.id, title: report.title, description: report.description, group: report.group })),
  {
    id: PIVOT_REPORT_ID,
    title: 'Custom Pivot',
    description: 'Choose what runs down the side, across the top and in the cells, over the same filters as every report.',
    group: 'Custom',
  },
];

export const hubReportById = (id: string | null | undefined) => HUB_REPORTS.find((report) => report.id === id);

const iconOf = (report: HubReport) => REPORT_ICONS[report.id] ?? GROUP_LOOKS[report.group].icon;

/** The reports page: every report, under its category, and a search across them. */
export function ExpenseReportsHub({ hrefOf, scopeNote }: { hrefOf: (id: string) => string; scopeNote?: string }) {
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();
  const matches = HUB_REPORTS.filter(
    (report) => !needle || `${report.title} ${report.description} ${report.group}`.toLowerCase().includes(needle),
  );
  const sections = HUB_GROUPS.map((group) => ({ group, items: matches.filter((report) => report.group === group) })).filter(
    (section) => section.items.length > 0,
  );

  return (
    <div className="w-full space-y-3">
      <section className="rounded-xl border bg-card px-4 py-3 shadow-sm sm:px-5 sm:py-4">
        {/* A `space-y-*` parent: globals.css then drops the header's own bottom margin. */}
        <div className="space-y-0">
          <PageHeader
            icon={BarChart3}
            backHref="/expenses"
            breadcrumbs={[{ label: 'Expenses', href: '/expenses' }, { label: 'Reports' }]}
            title="Expense Reports"
            description="Pick a report. Each opens with the same filters and exports to Excel."
            badge={
              scopeNote ? (
                <span className="whitespace-nowrap rounded-full border border-primary/20 bg-primary/5 px-2 text-[11px] font-medium leading-5 text-primary">
                  {scopeNote}
                </span>
              ) : undefined
            }
            actions={<ToolbarSearch className="w-full sm:w-72" value={search} onChange={setSearch} placeholder="Search all reports…" />}
          />
        </div>
      </section>

      <section aria-label="Reports" className="min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm">
        {sections.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm text-muted-foreground">No report matches “{search.trim()}”.</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setSearch('')}>
              Clear search
            </Button>
          </div>
        ) : (
          sections.map(({ group, items }) => (
            // A rule between categories; the first sits against the card's own edge.
            <div key={group} className="border-t first:border-t-0">
              {/* Each category gets a thin heading of its own. */}
              <div className="flex items-center justify-between gap-3 border-b bg-muted/40 px-4 py-1.5 sm:px-5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group}</span>
                <span className="text-[11px] tabular-nums text-muted-foreground">{items.length}</span>
              </div>
              <ul className="divide-y">
                  {items.map((report) => {
                    const Icon = iconOf(report);
                    return (
                      <li key={report.id}>
                        <Link
                          href={hrefOf(report.id)}
                          className="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-2 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none sm:px-5 md:grid-cols-[auto_minmax(0,15rem)_minmax(0,1fr)_auto]"
                        >
                          <span className={cn('flex h-7 w-7 items-center justify-center rounded-md', GROUP_LOOKS[report.group].chip)} aria-hidden="true">
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-foreground group-hover:text-primary">{report.title}</span>
                            {/* Below `md` the description sits under the name; from `md` it has a column. */}
                            <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground md:hidden">{report.description}</span>
                          </span>
                          <span className="hidden truncate text-xs text-muted-foreground md:block" title={report.description}>
                            {report.description}
                          </span>
                          <ChevronRight
                            className="h-4 w-4 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                            aria-hidden="true"
                          />
                        </Link>
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

/** "Report: Monthly Trend ▾" — another report, grouped as on the reports page, without going back. */
export function ReportSwitcher({ value, hrefOf, className }: { value: string; hrefOf: (id: string) => string; className?: string }) {
  const router = useRouter();
  return (
    <Select value={value} onValueChange={(next) => router.push(hrefOf(next))}>
      <SelectTrigger aria-label="Report" className={cn('h-9 w-full gap-1.5 bg-white text-sm shadow-sm sm:w-auto sm:min-w-[13rem] sm:max-w-[18rem] print:hidden', className)}>
        <span className="shrink-0 text-muted-foreground">Report:</span>
        <span className="min-w-0 flex-1 truncate text-left font-medium">
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent className="max-h-80">
        {HUB_GROUPS.map((group) => {
          const items = HUB_REPORTS.filter((report) => report.group === group);
          if (items.length === 0) return null;
          return (
            <SelectGroup key={group}>
              <SelectLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">{group}</SelectLabel>
              {items.map((report) => (
                <SelectItem key={report.id} value={report.id}>
                  {report.title}
                </SelectItem>
              ))}
            </SelectGroup>
          );
        })}
      </SelectContent>
    </Select>
  );
}
