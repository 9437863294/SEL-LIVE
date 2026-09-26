'use client';

import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { AlertTriangle, Bell, CheckCircle2, Clock3, FileText, Info, Search, TrendingUp, X, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FloatingNavPhonePreview } from '@/components/navigation/FloatingNavShowcase';
import type { NavStyle } from '@/lib/appearance/model';
import { cn } from '@/lib/utils';

/**
 * Representative SEL Live screens built from the real shared components, so whatever theme,
 * density, text size or contrast is active applies to them exactly as it does to the modules.
 * Used as the live preview on My Appearance and inside the Theme Management preview frames.
 *
 * Every status here carries an icon and a word, never colour alone — the same rule the screens
 * it stands in for follow.
 */
export const GALLERY_SECTIONS = ['dashboard', 'form', 'table', 'approval', 'reports', 'dialog', 'notifications', 'mobile'] as const;
export type GallerySection = (typeof GALLERY_SECTIONS)[number];

const monthly = [
  { month: 'Apr', approved: 42, pending: 12 },
  { month: 'May', approved: 51, pending: 9 },
  { month: 'Jun', approved: 38, pending: 15 },
  { month: 'Jul', approved: 64, pending: 7 },
  { month: 'Aug', approved: 58, pending: 11 },
  { month: 'Sep', approved: 71, pending: 6 },
];

const chartConfig = {
  approved: { label: 'Approved', color: 'hsl(var(--chart-1))' },
  pending: { label: 'Pending', color: 'hsl(var(--chart-3))' },
} satisfies ChartConfig;

type Tone = 'success' | 'warning' | 'danger' | 'info';

const toneStyles: Record<Tone, string> = {
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  danger: 'border-danger/30 bg-danger/10 text-danger',
  info: 'border-primary/30 bg-primary/10 text-primary',
};
const toneIcons = { success: CheckCircle2, warning: Clock3, danger: XCircle, info: Info } as const;

export function StatusBadge({ tone, children }: { tone: Tone; children: string }) {
  const Icon = toneIcons[tone];
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium', toneStyles[tone])}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {children}
    </span>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</h3>;
}

function Dashboard() {
  return (
    <section>
      <SectionTitle>Dashboard</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Open requisitions', value: '128', change: '+12 this week' },
          { label: 'Awaiting my approval', value: '9', change: '3 overdue' },
          { label: 'Budget used', value: '64%', change: 'of ₹4.2 Cr' },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="pt-[var(--card-pad,1.5rem)]">
              <p className="text-xs text-muted-foreground">{kpi.label}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{kpi.value}</p>
              <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                <TrendingUp className="h-3 w-3" aria-hidden="true" />
                {kpi.change}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="mt-3">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Approvals by month</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-40 w-full">
            <BarChart data={monthly} margin={{ left: 0, right: 8, top: 4 }}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} width={32} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="approved" fill="var(--color-approved)" radius={4} />
              <Bar dataKey="pending" fill="var(--color-pending)" radius={4} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </section>
  );
}

function FormSample() {
  return (
    <section>
      <SectionTitle>Form</SectionTitle>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">New site fund request</CardTitle>
          <CardDescription>Fields, choices and actions as they appear in every module.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="g-project">Project</Label>
            <Select defaultValue="tl4">
              <SelectTrigger id="g-project">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tl4">400 kV Tower Line 4</SelectItem>
                <SelectItem value="ss2">Substation Package 2</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="g-amount">Amount (₹)</Label>
            <Input id="g-amount" inputMode="decimal" defaultValue="2,45,000" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="g-purpose">Purpose</Label>
            <Input id="g-purpose" placeholder="Foundation work, labour advance…" />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="g-urgent" defaultChecked />
            <Label htmlFor="g-urgent">Mark as urgent</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="g-notify" defaultChecked />
            <Label htmlFor="g-notify">Notify approvers</Label>
          </div>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button>Submit for approval</Button>
            <Button variant="outline">Save draft</Button>
            <Button variant="ghost">Cancel</Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

const rows = [
  { id: 'SFR-2419', project: 'Tower Line 4', amount: '₹2,45,000', status: ['success', 'Approved'] },
  { id: 'SFR-2420', project: 'Substation 2', amount: '₹88,500', status: ['warning', 'Pending'] },
  { id: 'SFR-2421', project: 'Tower Line 6', amount: '₹1,12,000', status: ['danger', 'Rejected'] },
  { id: 'SFR-2422', project: 'Store — Nagpur', amount: '₹34,900', status: ['info', 'In review'] },
] as const;

function TableSample() {
  return (
    <section>
      <SectionTitle>Data table</SectionTitle>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="text-sm">All requests</CardTitle>
          <div className="relative w-full sm:w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input aria-label="Search requests" placeholder="Search…" className="pl-8" />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Request</TableHead>
                <TableHead>Project</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.id}</TableCell>
                  <TableCell>{row.project}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.amount}</TableCell>
                  <TableCell>
                    <StatusBadge tone={row.status[0]}>{row.status[1]}</StatusBadge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </section>
  );
}

const steps = [
  { who: 'Raised by Site Engineer', when: '12 Sep, 10:14', tone: 'success', label: 'Submitted' },
  { who: 'Project Manager', when: '12 Sep, 16:40', tone: 'success', label: 'Approved' },
  { who: 'Finance Head', when: 'Due 15 Sep', tone: 'warning', label: 'Pending' },
  { who: 'Director', when: 'Not started', tone: 'info', label: 'Waiting' },
] as const;

function ApprovalSample() {
  return (
    <section>
      <SectionTitle>Approval workflow</SectionTitle>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">E-Approval · Capex for crane hire</CardTitle>
          <CardDescription>Each stage states its outcome in words and with an icon.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {steps.map((step, i) => {
              const Icon = toneIcons[step.tone];
              return (
                <li key={step.who} className="flex items-start gap-3">
                  <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full border', toneStyles[step.tone])}>
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="sr-only">Step {i + 1}</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{step.who}</p>
                    <p className="text-xs text-muted-foreground">{step.when}</p>
                  </div>
                  <StatusBadge tone={step.tone}>{step.label}</StatusBadge>
                </li>
              );
            })}
          </ol>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button className="gap-1.5">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Approve
            </Button>
            <Button variant="destructive" className="gap-1.5">
              <XCircle className="h-4 w-4" aria-hidden="true" /> Reject
            </Button>
            <Button variant="outline">Send back</Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function ReportsSample() {
  return (
    <section>
      <SectionTitle>Reports</SectionTitle>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm">Cash flow</CardTitle>
          <Tabs defaultValue="month">
            <TabsList className="h-8">
              <TabsTrigger value="week" className="px-2.5 py-1 text-xs">Week</TabsTrigger>
              <TabsTrigger value="month" className="px-2.5 py-1 text-xs">Month</TabsTrigger>
              <TabsTrigger value="year" className="px-2.5 py-1 text-xs">Year</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-36 w-full">
            <AreaChart data={monthly} margin={{ left: 0, right: 8, top: 4 }}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} width={32} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area dataKey="approved" type="monotone" fill="var(--color-approved)" fillOpacity={0.18} stroke="var(--color-approved)" strokeWidth={2} />
            </AreaChart>
          </ChartContainer>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="gap-1.5">
              <FileText className="h-3.5 w-3.5" aria-hidden="true" /> Export PDF
            </Button>
            <Badge variant="secondary">Printed reports always use the light theme</Badge>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function DialogSample() {
  return (
    <section>
      <SectionTitle>Dialog</SectionTitle>
      <div className="rounded-2xl bg-black/40 p-4 sm:p-6">
        <div className="mx-auto max-w-sm rounded-lg border bg-background p-5 shadow-lg" role="group" aria-label="Sample dialog">
          <div className="flex items-start justify-between gap-2">
            <p className="text-base font-semibold">Delete draft?</p>
            <X className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">The draft and its attachments will be removed. This cannot be undone.</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" size="sm">Keep</Button>
            <Button variant="destructive" size="sm">Delete</Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function NotificationsSample() {
  const items = [
    { tone: 'success', icon: CheckCircle2, title: 'Request SFR-2419 approved', body: 'Finance released ₹2,45,000.' },
    { tone: 'warning', icon: AlertTriangle, title: 'Insurance renewal due in 5 days', body: 'Policy PI-7781 · Site vehicles.' },
    { tone: 'info', icon: Bell, title: 'You were mentioned in Office Hub', body: '“Please review the minutes.”' },
  ] as const;
  return (
    <section>
      <SectionTitle>Notifications</SectionTitle>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.title} className="flex items-start gap-3 rounded-lg border bg-card p-3 shadow-sm">
            <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full border', toneStyles[item.tone])}>
              <item.icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium">{item.title}</p>
              <p className="text-xs text-muted-foreground">{item.body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function AppearanceGallery({
  sections = [...GALLERY_SECTIONS],
  navStyle = 'blue',
  className,
}: {
  sections?: readonly GallerySection[];
  navStyle?: NavStyle;
  className?: string;
}) {
  const show = (s: GallerySection) => sections.includes(s);
  return (
    <div className={cn('space-y-6', className)}>
      {show('dashboard') && <Dashboard />}
      {show('form') && <FormSample />}
      {show('table') && <TableSample />}
      {show('approval') && <ApprovalSample />}
      {show('reports') && <ReportsSample />}
      {show('dialog') && <DialogSample />}
      {show('notifications') && <NotificationsSample />}
      {show('mobile') && (
        <section>
          <SectionTitle>Mobile navigation</SectionTitle>
          <FloatingNavPhonePreview theme={navStyle} />
        </section>
      )}
    </div>
  );
}
