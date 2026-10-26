'use client';

/**
 * Generate a payment report: a calendar month (the one that is approved for payment), or a custom
 * period as a preview.
 *
 * The 1st-of-the-month job generates last month on its own; this is for running it early, again
 * after trips were reviewed, or for a period that is not a month. A month already approved is locked
 * and cannot be generated again — the dialog says so before anything is sent.
 */

import { useState } from 'react';
import { CalendarRange, Mail } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormDialog } from '@/components/shared/form-dialog';
import { useToast } from '@/hooks/use-toast';
import { fleetErrorMessage, fleetFetch } from '@/components/fleet/fleet-api';
import { istDateKey, monthLabel, previousMonthKey } from '@/lib/fleet/dates';
import type { PaymentReport } from '@/lib/fleet/types';
import { cn } from '@/lib/utils';
import { VM_SEGMENT_TRACK, vmSegmentItem } from '../vm-ui';

type Mode = 'month' | 'custom';

export function GenerateReportDialog({
  open,
  onOpenChange,
  reports,
  onGenerated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Reports that exist, to warn before regenerating a month and to refuse an approved one. */
  reports: Pick<PaymentReport, 'id' | 'monthKey' | 'status'>[];
  onGenerated: (report: PaymentReport) => void;
}) {
  const { toast } = useToast();
  const [today] = useState(() => istDateKey(new Date()));
  const thisMonth = today.slice(0, 7);
  const [mode, setMode] = useState<Mode>('month');
  const [monthKey, setMonthKey] = useState(() => previousMonthKey(today.slice(0, 7)));
  const [from, setFrom] = useState(() => `${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [email, setEmail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // A fresh form each time the dialog opens (adjusted during render, not in an effect).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setMode('month');
      setMonthKey(previousMonthKey(thisMonth));
      setFrom(`${thisMonth}-01`);
      setTo(today);
      setEmail(false);
      setFailure(null);
    }
  }

  const existing = mode === 'month' ? reports.find((report) => report.monthKey === monthKey) : undefined;
  const locked = existing?.status === 'approved';
  const monthValid = /^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey) && monthKey <= thisMonth;
  const customValid = Boolean(from && to && from <= to && to <= today);
  const valid = mode === 'month' ? monthValid && !locked : customValid;

  async function submit() {
    if (!valid) return;
    setSubmitting(true);
    setFailure(null);
    try {
      const body = mode === 'month' ? { monthKey, email } : { from, to, email };
      const result = await fleetFetch<{ report: PaymentReport }>('reports', { body });
      toast({
        title: mode === 'month' ? `${monthLabel(monthKey)} report generated` : 'Preview generated',
        description: `${result.report.totals.trips} trips · version ${result.report.version}${result.report.emailedTo.length ? ` · emailed to ${result.report.emailedTo.length}` : ''}`,
      });
      onGenerated(result.report);
      onOpenChange(false);
    } catch (error) {
      const message = fleetErrorMessage(error, 'The report could not be generated.');
      setFailure(message);
      toast({ variant: 'destructive', title: 'Report not generated', description: message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title="Generate a payment report"
      description="Project-wise and vehicle-wise running and cost, held and flagged trips, and driver reimbursements — with Excel, PDF and JSON files."
      onSubmit={submit}
      submitting={submitting}
      submitDisabled={!valid}
      submitLabel={mode === 'month' ? (existing ? 'Generate again' : 'Generate') : 'Generate preview'}
    >
      <div className={VM_SEGMENT_TRACK} role="tablist" aria-label="Period">
        <button type="button" role="tab" aria-selected={mode === 'month'} className={vmSegmentItem(mode === 'month')} onClick={() => setMode('month')}>
          A month
        </button>
        <button type="button" role="tab" aria-selected={mode === 'custom'} className={vmSegmentItem(mode === 'custom')} onClick={() => setMode('custom')}>
          Custom period
        </button>
      </div>

      {mode === 'month' ? (
        <div className="space-y-1.5">
          <Label htmlFor="report-month" className="text-xs font-medium">
            Month
          </Label>
          <Input id="report-month" type="month" value={monthKey} max={thisMonth} onChange={(event) => setMonthKey(event.target.value)} className="bg-white sm:max-w-[14rem]" />
          {locked ? (
            <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{monthLabel(monthKey)} is approved for payment and locked. Trips settled since then go into the next month&apos;s report.</p>
          ) : existing ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">A draft for {monthLabel(monthKey)} exists. Generating again replaces it with a new version from today&apos;s figures.</p>
          ) : monthKey === thisMonth ? (
            <p className="text-xs text-muted-foreground">This month is still running: the figures are to date, and the report can be generated again later.</p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="report-from" className="text-xs font-medium">
                From
              </Label>
              <Input id="report-from" type="date" value={from} max={today} onChange={(event) => setFrom(event.target.value)} className="bg-white" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="report-to" className="text-xs font-medium">
                To
              </Label>
              <Input id="report-to" type="date" value={to} min={from} max={today} onChange={(event) => setTo(event.target.value)} className="bg-white" />
            </div>
          </div>
          <p className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
            <CalendarRange className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            A custom period is a preview: it shows the figures but cannot be approved for payment and marks no trip as paid. Payment runs month by month.
          </p>
          {!customValid && from && to && <p className="text-xs text-rose-700">The period must end on or before today, after it starts.</p>}
        </div>
      )}

      <label className={cn('flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 bg-white p-3 text-sm')}>
        <Checkbox checked={email} onCheckedChange={(value) => setEmail(value === true)} className="mt-0.5" aria-label="Email the report" />
        <span className="min-w-0 text-slate-700">
          <span className="flex items-center gap-1.5 font-medium">
            <Mail className="h-3.5 w-3.5 text-slate-500" aria-hidden />
            Email it with the Excel and PDF
          </span>
          <span className="block text-xs text-muted-foreground">To the report recipients in Settings › Fleet. Nothing is sent when none are set.</span>
        </span>
      </label>

      {failure && <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{failure}</p>}
    </FormDialog>
  );
}
