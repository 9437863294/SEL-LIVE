'use client';

import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  CalendarClock,
  CalendarDays,
  CircleDollarSign,
  ClipboardCheck,
  HelpCircle,
  LayoutDashboard,
  ListChecks,
  ReceiptIndianRupee,
  Repeat2,
  Settings,
  Tags,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type StepItem = { title: string; detail: string };

function StepList({ items }: { items: StepItem[] }) {
  return (
    <ol className="space-y-3">
      {items.map((item, index) => (
        <li key={item.title} className="flex gap-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-700">
            {index + 1}
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-800">{item.title}</p>
            <p className="text-sm text-muted-foreground">{item.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

const lifecycle: { title: string; who: string; detail: string }[] = [
  {
    title: 'A Recurring Master is created',
    who: 'Admin',
    detail:
      'An admin sets up a Recurring Master under Recurring Masters — vendor, category, amount, frequency (weekly / monthly / bi-monthly / quarterly / half-yearly / yearly / renewable / custom), due-day rule, and who is assigned to each step (bill owner, verifier, approver, accounts processor).',
  },
  {
    title: 'A payment obligation is generated',
    who: 'System (or Admin)',
    detail:
      'Every day, the system checks each active master and creates the next cycle’s obligation once it falls inside that master’s "Generate before due (days)" window — or an admin can trigger it manually with "Generate all" on Recurring Masters, or "Generate now" on a single master’s detail page. It starts as Scheduled, then becomes Generated / Awaiting Bill once the due date is close enough to activate the workflow.',
  },
  {
    title: 'Bill Collection',
    who: 'Bill / Payment Owner',
    detail:
      'The assigned owner submits the bill number, bill date and final amount, and uploads the bill copy (required at this step). They can also raise a Dispute or put the payment On Hold instead.',
  },
  {
    title: 'Bill Verification',
    who: 'Verifier',
    detail:
      'The verifier works through a mandatory checklist (vendor, amount, tax, account details, supporting documents, and more), sees the variance against previous bills, then Verifies, Returns for Correction, or Rejects.',
  },
  {
    title: 'Payment Approval',
    who: 'Approver(s)',
    detail:
      'The obligation is routed to whichever approver(s) match the Approval Rule for its amount, category and project — Sequential (one approver at a time, in order) or Parallel (everyone must sign off). They Approve, Return for Correction, Reject, or place it On Hold.',
  },
  {
    title: 'Payment Processing',
    who: 'Accounts / Processor',
    detail:
      'The accounts team records the payment date, amount, mode (NEFT / RTGS / IMPS / UPI / Cheque / Cash / Auto-debit / etc.), bank details or UTR/cheque number, TDS/GST deductions, and uploads the receipt. Partial payments are supported — the obligation stays Partially Paid until the full outstanding amount is recorded.',
  },
  {
    title: 'Receipt & Closure',
    who: 'Accounts / Processor',
    detail:
      'Once the receipt is verified and the amount is fully settled, the obligation is Closed. If your organization’s controls require it, closed payments are then locked from further edits.',
  },
];

const navMap: { href: string; label: string; icon: React.ElementType; description: string }[] = [
  { href: '/recurring-payments', label: 'Dashboard', icon: LayoutDashboard, description: 'Due today / this week, overdue, awaiting bill, pending approval and cash-outflow charts at a glance.' },
  { href: '/recurring-payments/payments', label: 'All Payments', icon: ReceiptIndianRupee, description: 'Every payment obligation, filterable by status, vendor, category and project.' },
  { href: '/recurring-payments/upcoming', label: 'Upcoming', icon: CalendarClock, description: 'Obligations due soon but not yet overdue.' },
  { href: '/recurring-payments/overdue', label: 'Overdue', icon: CircleDollarSign, description: 'Anything past its due date that is not yet paid or closed.' },
  { href: '/recurring-payments/approvals', label: 'Pending Approvals', icon: ClipboardCheck, description: 'Your personal approval queue — My Pending, Approved, Rejected, Delegated and All.' },
  { href: '/recurring-payments/calendar', label: 'Payment Calendar', icon: CalendarDays, description: 'A calendar view of every obligation by due date.' },
  { href: '/recurring-payments/masters', label: 'Recurring Masters', icon: Repeat2, description: 'The recurring bill templates — create, edit and bulk-generate obligations from here.' },
  { href: '/recurring-payments/vendors', label: 'Vendors', icon: Users, description: 'Vendor master data used across masters and payments.' },
  { href: '/recurring-payments/categories', label: 'Categories', icon: Tags, description: 'Payment categories used for classification, reporting and approval rules.' },
  { href: '/recurring-payments/reports', label: 'Reports', icon: BarChart3, description: 'Upcoming, overdue, expenses, cash-flow, payment-mode reconciliation, automation-health and workflow-completion reports.' },
  { href: '/recurring-payments/settings', label: 'Settings', icon: Settings, description: 'Approval rules, notification rules, automation, workflow steps and permissions.' },
];

const statusGlossary: { status: string; tone: string; meaning: string }[] = [
  { status: 'Draft', tone: 'bg-slate-100 text-slate-700 border-slate-200', meaning: 'Not yet finalized — not visible in the active workflow.' },
  { status: 'Scheduled', tone: 'bg-slate-100 text-slate-700 border-slate-200', meaning: 'A master’s next cycle exists but hasn’t entered the workflow yet.' },
  { status: 'Generated', tone: 'bg-blue-50 text-blue-700 border-blue-200', meaning: 'Obligation created; waiting for the workflow to activate near the due date.' },
  { status: 'Awaiting Bill', tone: 'bg-blue-50 text-blue-700 border-blue-200', meaning: 'At Bill Collection — waiting on the payment owner to submit the bill.' },
  { status: 'Bill Received', tone: 'bg-blue-50 text-blue-700 border-blue-200', meaning: 'Bill submitted; about to move into Verification.' },
  { status: 'Under Verification', tone: 'bg-blue-50 text-blue-700 border-blue-200', meaning: 'The verifier is checking the bill against the checklist.' },
  { status: 'Pending Approval', tone: 'bg-amber-50 text-amber-700 border-amber-200', meaning: 'Waiting on one or more approvers.' },
  { status: 'Approved', tone: 'bg-blue-50 text-blue-700 border-blue-200', meaning: 'Cleared for payment; about to enter Processing.' },
  { status: 'Payment Processing', tone: 'bg-blue-50 text-blue-700 border-blue-200', meaning: 'Accounts is recording the transaction.' },
  { status: 'Partially Paid', tone: 'bg-amber-50 text-amber-700 border-amber-200', meaning: 'Some amount recorded; balance still outstanding.' },
  { status: 'Paid', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200', meaning: 'Full amount paid; awaiting receipt verification and closure.' },
  { status: 'Closed', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200', meaning: 'Fully settled and closed. Locked if "Lock closed payments" is enabled.' },
  { status: 'Returned for Correction', tone: 'bg-amber-50 text-amber-700 border-amber-200', meaning: 'Sent back one step for a fix.' },
  { status: 'Rejected', tone: 'bg-rose-50 text-rose-700 border-rose-200', meaning: 'Stopped at verification or approval.' },
  { status: 'Disputed', tone: 'bg-rose-50 text-rose-700 border-rose-200', meaning: 'The payment owner flagged a disagreement with the vendor or amount.' },
  { status: 'Payment Failed', tone: 'bg-rose-50 text-rose-700 border-rose-200', meaning: 'A payment attempt failed at Processing.' },
  { status: 'Paid Receipt Pending', tone: 'bg-amber-50 text-amber-700 border-amber-200', meaning: 'Paid, but the receipt/proof isn’t yet uploaded or verified.' },
  { status: 'On Hold', tone: 'bg-amber-50 text-amber-700 border-amber-200', meaning: 'Manually paused at any actionable step.' },
  { status: 'Waived', tone: 'bg-slate-100 text-slate-700 border-slate-200', meaning: 'Marked as not payable and closed without payment.' },
  { status: 'Cancelled', tone: 'bg-slate-100 text-slate-700 border-slate-200', meaning: 'Cancelled before completion.' },
  { status: 'Overdue', tone: 'bg-rose-50 text-rose-700 border-rose-200', meaning: 'Computed live — past due date and not yet paid/closed. Shown on the Dashboard and Overdue page.' },
];

const faqs: { q: string; a: string }[] = [
  {
    q: 'What’s the difference between a Recurring Master and a Payment (obligation)?',
    a: 'A Master is the reusable template — vendor, category, amount, frequency and assignees — configured once under Recurring Masters. Each billing cycle, one Payment obligation is generated from that master, and it’s the obligation that actually moves through Bill Collection → Verification → Approval → Processing → Closure.',
  },
  {
    q: 'How does auto-generation decide exactly when to create a payment?',
    a: 'Each master has its own "Generate before due (days)" setting — the daily automation only creates the obligation once today falls within that many days of the computed due date, and only if Settings › Automation has auto-generation switched on. Separately, an org-wide "Workflow starts before due" setting decides when a Scheduled obligation actually enters the workflow’s first step.',
  },
  {
    q: 'Can I generate a payment outside the automatic schedule?',
    a: 'Yes — with the "Generate Manually" permission, use "Generate all" on the Recurring Masters list to generate the next due cycle for every eligible master, or "Generate now" on a single master’s detail page for just that one.',
  },
  {
    q: 'What’s the difference between Sequential and Parallel approval?',
    a: 'Sequential means approvers act one at a time in the configured order — the obligation only reaches the next approver after the previous one approves. Parallel means every configured approver must approve before the step is considered complete.',
  },
  {
    q: 'Can I make a partial payment?',
    a: 'Yes — Record Payment can be entered more than once against the same obligation. It stays Partially Paid until the recorded total covers the full outstanding amount, at which point Closure becomes available.',
  },
  {
    q: 'What do "Return for Correction", "Reject", "On Hold" and "Disputed" actually do?',
    a: 'Return for Correction sends the obligation back one step (e.g. verifier → bill owner) for a fix. Reject stops it entirely at verification or approval. On Hold pauses it at any actionable step without rejecting it. Disputed is raised by the payment owner during Bill Collection when there’s a disagreement with the vendor or amount.',
  },
  {
    q: 'Where do reminders come from?',
    a: 'Settings › Notifications controls the channels (in-app / email / push / WhatsApp), how many days before and after the due date reminders fire, and whether overdue items escalate daily. The daily automation run builds that reminder queue alongside generating new obligations.',
  },
  {
    q: 'I don’t see a page or button I need — who do I ask?',
    a: 'Every section (Dashboard, Payments, Approvals, Masters, Vendors, Categories, Reports, Settings) is individually permission-gated. Ask your administrator to grant the relevant action under Settings › Permissions (or role management) if something is greyed out or missing entirely.',
  },
];

export default function RecurringPaymentsHandbook() {
  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-none bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg">
        <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15">
            <BookOpen className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Recurring Payments Handbook</h1>
            <p className="mt-1 max-w-2xl text-sm text-white/85">
              A step-by-step guide to collecting bills, verifying, approving, paying and closing recurring
              obligations in this module — written for anyone new here.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-emerald-600" /> Quick start — find your role
          </CardTitle>
          <CardDescription>Pick the role that matches what you do, and follow the steps below.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="owner">
            <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-5">
              <TabsTrigger value="owner">Bill Owner</TabsTrigger>
              <TabsTrigger value="verifier">Verifier</TabsTrigger>
              <TabsTrigger value="approver">Approver</TabsTrigger>
              <TabsTrigger value="processor">Accounts</TabsTrigger>
              <TabsTrigger value="admin">Admin</TabsTrigger>
            </TabsList>

            <TabsContent value="owner" className="space-y-4 pt-4">
              <p className="text-sm text-muted-foreground">
                You submit the bill when it’s your turn at the <strong>Bill Collection</strong> step — usually
                because you’re the assigned (or backup) owner on a Recurring Master.
              </p>
              <StepList
                items={[
                  { title: 'Open your task queue', detail: 'Go to Bill Collection in the left menu (your organization may have renamed it) and switch to "My pending tasks".' },
                  { title: 'Submit the bill', detail: 'Click "Submit Bill" on the payment, enter the bill number, bill date and final amount, then upload the bill copy — it is required at this step.' },
                  { title: 'Or flag a problem', detail: 'Use "Dispute" if the vendor amount or details are wrong, or "On Hold" to pause it without rejecting.' },
                  { title: 'Track what’s due', detail: 'Check Upcoming and Overdue regularly — reminders are sent automatically before and after the due date based on Settings › Notifications.' },
                ]}
              />
            </TabsContent>

            <TabsContent value="verifier" className="space-y-4 pt-4">
              <p className="text-sm text-muted-foreground">
                You work items sitting at the <strong>Bill Verification</strong> step, checking the bill before it
                moves on for approval.
              </p>
              <StepList
                items={[
                  { title: 'Open your task queue', detail: 'Go to Bill Verification and switch to "My pending tasks".' },
                  { title: 'Work the checklist', detail: 'Verify the vendor, amount, tax details, account details and supporting documents against the mandatory checklist shown in the action dialog.' },
                  { title: 'Check the variance', detail: 'The screen shows the amount vs. the previous bill and the 3- and 6-month averages, so anything unusual stands out before you sign off.' },
                  { title: 'Decide', detail: '"Verify" moves it on to approval, "Return for Correction" sends it back to the bill owner, "Reject" stops it here.' },
                ]}
              />
            </TabsContent>

            <TabsContent value="approver" className="space-y-4 pt-4">
              <p className="text-sm text-muted-foreground">
                You act on items at the <strong>Payment Approval</strong> step, routed to you by the Approval Rule
                that matches the amount, category and project.
              </p>
              <StepList
                items={[
                  { title: 'Check your queue', detail: 'Use Pending Approvals for a personal, cross-payment view — My Pending, Approved by Me, Rejected by Me, Delegated and All.' },
                  { title: 'Know the mode', detail: 'Sequential rules need one approver at a time in order; Parallel rules need every configured approver to sign off before the step completes.' },
                  { title: 'Decide', detail: '"Approve" sends it to Processing, "Return for Correction" sends it back, "Reject" stops it, "On Hold" pauses it without deciding yet.' },
                  { title: 'Delegate if needed', detail: 'If you’ll be away, use Delegate from the approvals queue so approvals keep moving.' },
                ]}
              />
            </TabsContent>

            <TabsContent value="processor" className="space-y-4 pt-4">
              <p className="text-sm text-muted-foreground">
                You handle <strong>Payment Processing</strong> and <strong>Receipt &amp; Closure</strong> — actually
                paying the vendor and closing the obligation out.
              </p>
              <StepList
                items={[
                  { title: 'Record the payment', detail: 'Enter the payment date, amount, mode (NEFT/RTGS/UPI/Cheque/etc.), and the matching bank account, UTR or cheque number, plus any TDS/GST deductions.' },
                  { title: 'Upload the receipt', detail: 'Attach the payment receipt/proof — required before the obligation can be closed.' },
                  { title: 'Partial payments are fine', detail: 'You can record payment more than once; the obligation shows Partially Paid until the full outstanding amount is recorded.' },
                  { title: 'Close it out', detail: 'Once the outstanding amount is fully settled and the receipt is verified, use "Close" to finish the obligation.' },
                ]}
              />
            </TabsContent>

            <TabsContent value="admin" className="space-y-4 pt-4">
              <p className="text-sm text-muted-foreground">
                You set up the master data, rules and automation everyone else relies on.
              </p>
              <StepList
                items={[
                  { title: 'Set up master data', detail: 'Add Vendors and Categories first — masters and approval rules reference them.' },
                  { title: 'Create Recurring Masters', detail: 'Define the vendor, category, amount, frequency, due-day rule and who’s assigned to each step (owner, verifier, approver, processor).' },
                  { title: 'Configure Approval Rules', detail: 'Under Settings › Approval Rules, set amount ranges, category/project scope, and Sequential vs. Parallel approvers.' },
                  { title: 'Configure Notifications', detail: 'Under Settings › Notifications, set reminder channels and days before/after due date.' },
                  { title: 'Configure Automation', detail: 'Under Settings › Automation, control auto-generation and the workflow activation lead time — or trigger "Run automation now" manually.' },
                  { title: 'Configure the Workflow', detail: 'Under Settings › Workflow, customize the steps, TAT, assignment type, available actions and whether an upload is required at each step.' },
                  { title: 'Manage Permissions', detail: 'Under Settings › Permissions, control which roles can view or act on each resource.' },
                ]}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-emerald-600" /> How a payment moves through the system
          </CardTitle>
          <CardDescription>The full lifecycle, from master to closure.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-5">
            {lifecycle.map((item, index) => (
              <li key={item.title} className="flex gap-4">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-sm font-semibold text-white">
                  {index + 1}
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-slate-800">{item.title}</p>
                    <Badge variant="outline" className="text-xs">{item.who}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-5 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
            At any actionable step, "Return for Correction" sends the obligation back one step, "Reject"/"Dispute"
            stop or flag it, and "On Hold" pauses it without deciding. If your organization allows it (Settings
            › Organization › "Allow authorized reopening"), a closed payment can later be reopened.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LayoutDashboard className="h-5 w-5 text-emerald-600" /> Where to find things
          </CardTitle>
          <CardDescription>What each section of the left menu is for.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {navMap.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="group flex flex-col gap-2 rounded-xl border p-4 transition-colors hover:border-emerald-300 hover:bg-emerald-50/40"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                      <Icon className="h-4 w-4" />
                    </span>
                    <p className="text-sm font-semibold text-slate-800">{item.label}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                  <span className="mt-auto flex items-center gap-1 text-xs font-medium text-emerald-700 opacity-0 transition-opacity group-hover:opacity-100">
                    Open <ArrowRight className="h-3 w-3" />
                  </span>
                </Link>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-emerald-600" /> Status glossary
          </CardTitle>
          <CardDescription>What every status you’ll see on a payment actually means.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-48">Status</TableHead>
                <TableHead>Meaning</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {statusGlossary.map((item) => (
                <TableRow key={item.status}>
                  <TableCell>
                    <Badge variant="outline" className={item.tone}>{item.status}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{item.meaning}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-emerald-600" /> Frequently asked questions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="w-full">
            {faqs.map((item, index) => (
              <AccordionItem key={item.q} value={`faq-${index}`}>
                <AccordionTrigger className="text-left">{item.q}</AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground">{item.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}
