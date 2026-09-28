'use client';

/**
 * The frame the New Payment and New Receipt forms share: the date and bank account the batch is
 * for, the entry table (one row per payment/receipt, the page supplies the columns), and a footer
 * with the running figures and the Save button underneath the table — nothing in a side panel.
 */

import { useState, type ReactNode } from 'react';
import { format } from 'date-fns';
import { AlertCircle, AlertTriangle, Calendar as CalendarIcon, Loader2, Paperclip, Plus, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { accountLabel } from '@/components/bank-balance/page-kit';
import { isCashCredit } from '@/lib/bank-balance-ledger';
import type { BankAccount } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Classes for an input sitting in a grid cell: compact, full width, red when invalid. */
export const cellInput = (invalid?: boolean) =>
  cn('h-9 w-full min-w-0 rounded-md', invalid && 'border-destructive focus-visible:ring-destructive');

export function DateBankBar({
  kind,
  date,
  onDateChange,
  accounts,
  accountId,
  onAccountChange,
  showErrors,
}: {
  kind: 'payment' | 'receipt';
  date: Date | undefined;
  onDateChange: (date: Date | undefined) => void;
  accounts: BankAccount[];
  accountId: string;
  onAccountChange: (id: string) => void;
  showErrors: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:max-w-3xl">
      <div className="space-y-1.5">
        <Label htmlFor={`${kind}-date`}>
          {kind === 'payment' ? 'Payment date' : 'Receipt date'}
          <span className="text-destructive"> *</span>
        </Label>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              id={`${kind}-date`}
              variant="outline"
              className={cn('w-full justify-start text-left font-normal', !date && 'text-muted-foreground', showErrors && !date && 'border-destructive')}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {date ? format(date, 'EEE, dd MMM yyyy') : 'Pick a date'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={date}
              disabled={{ after: new Date() }}
              onSelect={(picked) => {
                onDateChange(picked || undefined);
                setOpen(false);
              }}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${kind}-bank`}>
          Bank account<span className="text-destructive"> *</span>
        </Label>
        <Select value={accountId} onValueChange={onAccountChange}>
          <SelectTrigger id={`${kind}-bank`} className={cn(showErrors && !accountId && 'border-destructive')}>
            <SelectValue placeholder={accounts.length ? 'Select a bank account' : 'No active accounts'} />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {accountLabel(account)} — {account.bankName}
                {isCashCredit(account) ? ' (CC)' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

/** The scrolling table frame: a native overflow box, so the scrollbar is real on every width. */
export function EntryTable({ minWidth, head, children, foot }: { minWidth: number; head: ReactNode; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="min-w-0 overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-sm" style={{ minWidth }}>
        <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{head}</thead>
        <tbody className="divide-y">{children}</tbody>
        {foot && <tfoot className="border-t bg-muted/30">{foot}</tfoot>}
      </table>
    </div>
  );
}

export const TH = ({ children, className, required }: { children?: ReactNode; className?: string; required?: boolean }) => (
  <th className={cn('whitespace-nowrap px-2 py-2.5 font-semibold first:pl-3 last:pr-3', className)}>
    {children}
    {required && <span className="text-destructive"> *</span>}
  </th>
);

export const TD = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <td className={cn('px-2 py-2 align-top first:pl-3 last:pr-3', className)}>{children}</td>
);

const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const fileSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** A file picker that fits a table cell: "Attach" until chosen, then the file name with a remove. */
export function FileCell({
  id,
  file,
  onChange,
  onTooLarge,
  invalid,
  label,
}: {
  id: string;
  file: File | null;
  onChange: (file: File | null) => void;
  onTooLarge: (file: File) => void;
  invalid?: boolean;
  label: string;
}) {
  return (
    <div className="min-w-0">
      <input
        id={id}
        type="file"
        accept="application/pdf,image/*"
        className="sr-only"
        aria-label={label}
        onChange={(e) => {
          const picked = e.target.files?.[0] ?? null;
          e.target.value = '';
          if (picked && picked.size > MAX_FILE_BYTES) onTooLarge(picked);
          else onChange(picked);
        }}
      />
      {file ? (
        <div className="flex h-9 items-center gap-1.5 rounded-md border bg-muted/40 pl-2 pr-1" title={`${file.name} · ${fileSize(file.size)}`}>
          <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{file.name}</span>
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => onChange(null)} aria-label={`Remove ${file.name}`}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <label
          htmlFor={id}
          className={cn(
            'flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed px-2 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary',
            invalid && 'border-destructive text-destructive'
          )}
        >
          <Paperclip className="h-3.5 w-3.5" />
          Attach
        </label>
      )}
    </div>
  );
}

export interface FooterFigure {
  label: string;
  value: string;
  tone?: 'good' | 'bad';
}

export interface FooterNote {
  tone: 'error' | 'warning';
  text: ReactNode;
}

/** Under the table: add a row on the left; the figures and Save on the right; notes above them. */
export function EntryFooter({
  addLabel,
  onAdd,
  figures,
  notes,
  saveLabel,
  saving,
  saveDisabled,
  onSave,
}: {
  addLabel: string;
  onAdd: () => void;
  figures: FooterFigure[];
  notes: FooterNote[];
  saveLabel: string;
  saving: boolean;
  saveDisabled: boolean;
  onSave: () => void;
}) {
  return (
    <div className="space-y-3">
      {notes.length > 0 && (
        <div className="space-y-1.5">
          {notes.map((note, index) => (
            <p
              key={index}
              className={cn(
                'flex items-start gap-1.5 rounded-md px-3 py-2 text-xs',
                note.tone === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800'
              )}
            >
              {note.tone === 'error' ? <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              <span>{note.text}</span>
            </p>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-3 border-t pt-4 lg:flex-row lg:items-center lg:justify-between">
        <Button type="button" variant="outline" className="border-dashed lg:w-auto" onClick={onAdd}>
          <Plus className="mr-2 h-4 w-4" />
          {addLabel}
        </Button>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end sm:gap-6">
          <dl className="grid grid-cols-1 gap-2 text-sm sm:flex sm:items-center sm:gap-6">
            {figures.map((figure) => (
              <div key={figure.label} className="flex items-baseline justify-between gap-3 sm:block sm:text-right">
                <dt className="text-xs text-muted-foreground">{figure.label}</dt>
                <dd
                  className={cn(
                    'font-semibold tabular-nums',
                    figure.tone === 'good' && 'text-emerald-700',
                    figure.tone === 'bad' && 'text-destructive'
                  )}
                >
                  {figure.value}
                </dd>
              </div>
            ))}
          </dl>
          <Button className="sm:min-w-44" onClick={onSave} disabled={saving || saveDisabled}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {saving ? 'Saving…' : saveLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The card the whole form sits in. */
export function EntryCard({ children }: { children: ReactNode }) {
  return (
    <Card className="border-white/60 bg-white/80 shadow-sm backdrop-blur-sm">
      <CardContent className="space-y-5 p-4 sm:p-5">{children}</CardContent>
    </Card>
  );
}
