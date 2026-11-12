'use client';

/**
 * One payment checklist, laid out as Settings › Printing Setup says (src/lib/daily-requisition-print.ts).
 *
 * The checklist print page prints it; Printing Setup previews the very same component on a sample
 * requisition, so the preview is the print. On paper the page margins come from `@page`; the
 * callers draw them as padding on screen.
 *
 * Each section is a panel tinted in its own colour. The colours print as they show on screen
 * (`print-color-adjust: exact`, so "Background graphics" need not be ticked), and the sheet is
 * `keep-light`, so dark mode's compat layer leaves it as paper.
 */

import type { CSSProperties, ReactNode } from 'react';
import { format } from 'date-fns';
import { BookOpen, ClipboardList, FileText, History, Landmark, Wallet, type LucideIcon } from 'lucide-react';

import { CompanyLetterhead, SignatureBlock } from '@/components/shared/company-letterhead';
import { useUiText } from '@/hooks/use-company-profile';
import { isIfsc, storedBankOf } from '@/lib/expenses-bank';
import { cn } from '@/lib/utils';
import {
  amountInWords,
  copyLabel,
  DEFAULT_SIGNATURE_LABELS,
  FONT_SCALE,
  pageSizeMm,
  watermarkFor,
  type DRPrintSettings,
} from '@/lib/daily-requisition-print';
import type { DailyRequisitionEntry, ExpenseRequest } from '@/lib/types';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (value: unknown) => inr.format(Number(value) || 0);

const toDateSafe = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const maybe = value as { toDate?: () => Date; seconds?: number };
  if (typeof maybe.toDate === 'function') return maybe.toDate();
  if (typeof maybe.seconds === 'number') return new Date(maybe.seconds * 1000);
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};
const formatDate = (value: unknown) => {
  const date = toDateSafe(value);
  return date ? format(date, 'dd MMM yyyy') : 'N/A';
};
const formatWhen = (value: unknown) => {
  const date = toDateSafe(value);
  return date ? format(date, 'dd MMM yyyy, HH:mm') : '—';
};

/* ── colours ─────────────────────────────────────────────────────────────── */

type Tone = 'indigo' | 'emerald' | 'sky' | 'violet' | 'amber' | 'teal';

/** One hue per section — written out whole, so Tailwind sees every class. */
const TONES: Record<Tone, { panel: string; head: string; chip: string; label: string; rule: string }> = {
  indigo: { panel: 'border-indigo-200 bg-indigo-50', head: 'text-indigo-800', chip: 'bg-indigo-600', label: 'text-indigo-700', rule: 'border-indigo-200' },
  emerald: { panel: 'border-emerald-200 bg-emerald-50', head: 'text-emerald-800', chip: 'bg-emerald-600', label: 'text-emerald-700', rule: 'border-emerald-200' },
  sky: { panel: 'border-sky-200 bg-sky-50', head: 'text-sky-800', chip: 'bg-sky-600', label: 'text-sky-700', rule: 'border-sky-300' },
  violet: { panel: 'border-violet-200 bg-violet-50', head: 'text-violet-800', chip: 'bg-violet-600', label: 'text-violet-700', rule: 'border-violet-200' },
  amber: { panel: 'border-amber-200 bg-amber-50', head: 'text-amber-800', chip: 'bg-amber-500', label: 'text-amber-700', rule: 'border-amber-300' },
  teal: { panel: 'border-teal-200 bg-teal-50', head: 'text-teal-800', chip: 'bg-teal-600', label: 'text-teal-700', rule: 'border-teal-200' },
};

/** The dot beside the status on the title band. */
const STATUS_DOT: Record<string, string> = {
  Pending: 'bg-amber-300',
  Received: 'bg-sky-300',
  'Needs Review': 'bg-orange-300',
  Verified: 'bg-emerald-300',
  'Received for Payment': 'bg-cyan-300',
  'Partially Paid': 'bg-lime-300',
  Paid: 'bg-green-300',
  Cancelled: 'bg-rose-400',
};

/** Backgrounds print without the dialog's "Background graphics" tick. Inherited by everything inside. */
const PRINT_COLOURS = { WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } as CSSProperties;

function Panel({
  tone,
  icon: Icon,
  title,
  aside,
  className,
  children,
}: {
  tone: Tone;
  icon: LucideIcon;
  title: string;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const t = TONES[tone];
  return (
    <section className={cn('break-inside-avoid rounded-lg border', t.panel, className)}>
      <header className={cn('flex items-center gap-1.5 px-3 pt-2 text-[10.5px] font-bold uppercase tracking-[0.12em]', t.head)}>
        <span className={cn('grid h-4 w-4 shrink-0 place-items-center rounded text-white', t.chip)}>
          <Icon className="h-2.5 w-2.5" strokeWidth={2.5} />
        </span>
        <span className="min-w-0">{title}</span>
        {aside ? <span className="ml-auto text-[10px] font-semibold normal-case tracking-normal">{aside}</span> : null}
      </header>
      <div className="px-3 pb-2.5 pt-1.5">{children}</div>
    </section>
  );
}

/** A caption above its value. Lives inside a `<dl>`. */
function Fact({
  label,
  tone,
  children,
  mono,
  className,
}: {
  label: string;
  tone: Tone;
  children: ReactNode;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className={cn('text-[9.5px] font-semibold uppercase tracking-wider', TONES[tone].label)}>{label}</dt>
      <dd className={cn('break-words text-[13px] font-semibold leading-snug text-slate-900', mono && 'font-mono tracking-wide')}>{children}</dd>
    </div>
  );
}

/** A blank to write in by hand, where nothing was entered. */
function WriteIn({ label, tone, className }: { label: string; tone: Tone; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className={cn('text-[9.5px] font-semibold uppercase tracking-wider', TONES[tone].label)}>{label}</dt>
      <dd className={cn('h-5 border-b border-dashed', TONES[tone].rule)} />
    </div>
  );
}

export interface ChecklistSheetProps {
  entry: DailyRequisitionEntry;
  projectName?: string;
  /** The expense request it came from: its heads of account, and its bank details when the requisition carries none. */
  expenseRequest?: Pick<ExpenseRequest, 'headOfAccount' | 'subHeadOfAccount' | 'bankDetails'>;
  printedBy: string;
  printedAt: string;
  settings: DRPrintSettings;
  /** Which copy of the requisition this sheet is (0-based), when several print. */
  copyIndex?: number;
  /** Its place in everything printed at once, for the footer's sheet numbers. */
  sheet?: { index: number; total: number };
  /** A user's name, for the trail. */
  nameOf?: (id: string) => string;
}

/** Who received, verified and paid it, and what happened at Verification steps — oldest first. */
function trailRows(entry: DailyRequisitionEntry, nameOf: (id: string) => string): Array<{ step: string; by: string; when: unknown }> {
  const rows: Array<{ step: string; by: string; when: unknown }> = [];
  if (entry.receivedAt) rows.push({ step: 'Received at Finance', by: entry.receivedById ? nameOf(entry.receivedById) : '—', when: entry.receivedAt });
  for (const event of entry.flowTrail ?? []) {
    const what =
      event.action === 'Handed over'
        ? `${event.stepName}: handed to ${(event.toUserNames ?? []).join(', ')}`
        : event.action === 'Taken early'
          ? `Taken early into ${event.stepName}`
          : event.action === 'Sent back'
            ? `${event.stepName}: sent back to ${event.toStep ?? 'the step before'}`
            : event.action === 'Rejected'
              ? `${event.stepName}: rejected`
              : `${event.stepName}: verified`;
    rows.push({ step: what, by: event.userName, when: event.at });
  }
  if (entry.verifiedAt) rows.push({ step: 'GST & TDS verified', by: '—', when: entry.verifiedAt });
  if (entry.paidAt) {
    const vouchers = [...new Set((entry.payments ?? []).map((p) => p.voucherNo).filter(Boolean))];
    rows.push({
      step: entry.manualPaid ? 'Marked paid' : vouchers.length ? `Paid · voucher ${vouchers.join(', ')}` : 'Paid',
      by: entry.paidByName || '—',
      when: entry.paidAt,
    });
  }
  return rows.sort((a, b) => (toDateSafe(a.when)?.getTime() ?? 0) - (toDateSafe(b.when)?.getTime() ?? 0));
}

export function ChecklistSheet({
  entry,
  projectName,
  expenseRequest,
  printedBy,
  printedAt,
  settings,
  copyIndex = 0,
  sheet,
  nameOf = (id) => id,
}: ChecklistSheetProps) {
  const t = useUiText();
  const s = settings.sections;
  const copy = copyLabel(copyIndex, settings.copies);
  const watermark = watermarkFor(settings.watermark, entry.status);
  // A short sheet (A5, or landscape) cannot spare the tall gaps an A4 page leaves for signing.
  const roomy = pageSizeMm(settings).height >= 279;
  const labels = settings.signatureLabels.length
    ? settings.signatureLabels
    : [
        t('preparedBy', DEFAULT_SIGNATURE_LABELS[0]),
        DEFAULT_SIGNATURE_LABELS[1],
        t('checkedBy', DEFAULT_SIGNATURE_LABELS[2]),
        t('approvedBy', DEFAULT_SIGNATURE_LABELS[3]),
        DEFAULT_SIGNATURE_LABELS[4],
        DEFAULT_SIGNATURE_LABELS[5],
      ];
  const trail = s.trail ? trailRows(entry, nameOf) : [];
  const footerBits = [settings.footer.note.trim()].filter(Boolean);
  // What the requisition carried when it was received; for one received before bank details were
  // carried across, what its expense request holds.
  const bank = storedBankOf(entry.bankDetails) ?? storedBankOf(expenseRequest?.bankDetails);
  const ifscLooksWrong = Boolean(bank?.ifscCode) && !isIfsc(bank?.ifscCode);
  const status = entry.status || 'Pending';
  const pairs = [s.amounts, s.bank].filter(Boolean).length;

  return (
    <div
      className="keep-light relative bg-white font-sans text-slate-900 print:text-black"
      style={{ zoom: FONT_SCALE[settings.fontScale], ...PRINT_COLOURS }}
    >
      {watermark && (
        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
          <span className="-rotate-[30deg] select-none whitespace-nowrap text-7xl font-black tracking-[0.1em] text-rose-600/10">{watermark}</span>
        </div>
      )}
      {copy && (
        <div className="absolute right-0 top-0 z-10 rounded-full border border-rose-300 bg-rose-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-700">
          {copy}
        </div>
      )}

      <CompanyLetterhead
        align={settings.letterheadAlign === 'profile' ? undefined : settings.letterheadAlign}
        className={roomy ? 'mb-3' : 'mb-2'}
      />

      <div className={cn('flex items-center justify-between gap-3 rounded-lg bg-gradient-to-r from-indigo-700 via-violet-700 to-fuchsia-600 px-4 py-2 text-white', roomy ? 'mb-3' : 'mb-2')}>
        <div className="flex min-w-0 items-center gap-2">
          <ClipboardList className="h-4 w-4 shrink-0" />
          <p className="min-w-0 text-[13px] font-extrabold uppercase tracking-[0.18em]">{settings.documentTitle}</p>
        </div>
        {s.details && (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-[10.5px] font-semibold ring-1 ring-white/40">
            <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[status] ?? 'bg-white')} />
            {status}
          </span>
        )}
      </div>

      <div className={roomy ? 'space-y-3' : 'space-y-2'}>
        {s.details && (
          <Panel tone="indigo" icon={FileText} title="Requisition">
            <dl className="grid grid-cols-[1fr_1fr_1.2fr_1.8fr] gap-x-4 gap-y-1.5">
              <Fact tone="indigo" label="Reception No">{entry.receptionNo || 'N/A'}</Fact>
              <Fact tone="indigo" label="Reception Date">{formatDate(entry.date)}</Fact>
              <Fact tone="indigo" label="DEP No">{entry.depNo || 'N/A'}</Fact>
              <Fact tone="indigo" label="Project">{projectName || 'N/A'}</Fact>
            </dl>
          </Panel>
        )}

        {pairs > 0 && (
          <div className={cn('grid gap-3', pairs === 2 ? 'grid-cols-2' : 'grid-cols-1')}>
            {s.amounts && (
              <Panel tone="emerald" icon={Wallet} title="Party & amount">
                <dl>
                  <Fact tone="emerald" label="Name of the party">
                    <span className="text-[15px] font-bold">{entry.partyName || 'N/A'}</span>
                  </Fact>
                </dl>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div className="rounded-md border border-emerald-200 bg-white px-2.5 py-1.5">
                    <p className="text-[9.5px] font-semibold uppercase tracking-wider text-emerald-700">Gross amount</p>
                    <p className="text-[14px] font-bold tabular-nums text-slate-900">{money(entry.grossAmount)}</p>
                  </div>
                  <div className="rounded-md bg-emerald-600 px-2.5 py-1.5 text-white">
                    <p className="text-[9.5px] font-semibold uppercase tracking-wider text-emerald-50">Net amount</p>
                    <p className="text-[14px] font-extrabold tabular-nums">{money(entry.netAmount)}</p>
                  </div>
                </div>
                {s.amountInWords && (
                  <p className="mt-2 rounded-md bg-white/70 px-2.5 py-1 text-[11px] leading-snug text-emerald-900">
                    <span className="font-semibold">In words:</span> {amountInWords(Number(entry.netAmount) || 0)}
                  </p>
                )}
              </Panel>
            )}

            {s.bank && (
              <Panel
                tone="sky"
                icon={Landmark}
                title="Bank details"
                aside={bank ? (bank.source === 'employee' ? 'From Employee module' : 'From expense request') : 'Not entered'}
              >
                {bank ? (
                  <>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                      <Fact tone="sky" label="Account holder" className="col-span-2">
                        {bank.accountHolderName || '—'}
                      </Fact>
                      <Fact tone="sky" label="Account number" mono className="col-span-2">
                        <span className="text-[14.5px] font-bold">{bank.accountNumber || '—'}</span>
                      </Fact>
                      <Fact tone="sky" label="IFSC" mono>
                        {bank.ifscCode || '—'}
                        {ifscLooksWrong && <span className="ml-1 font-sans text-[9.5px] font-bold uppercase text-rose-600">check</span>}
                      </Fact>
                      <Fact tone="sky" label="Bank">{bank.bankName || '—'}</Fact>
                      <Fact tone="sky" label="Branch" className="col-span-2">
                        {bank.branchName || '—'}
                      </Fact>
                    </dl>
                    {bank.source === 'employee' && (bank.employeeNo || bank.edited) && (
                      <p className="mt-1.5 text-[10px] text-sky-800">
                        {bank.employeeNo ? `Employee ${bank.employeeNo}` : 'Employee record'}
                        {bank.edited ? ', changed on the expense request' : ''}
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="mb-1 text-[10.5px] text-sky-900">None entered on the expense request — write them in to check before paying.</p>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                      <WriteIn tone="sky" label="Account holder" className="col-span-2" />
                      <WriteIn tone="sky" label="Account number" className="col-span-2" />
                      <WriteIn tone="sky" label="IFSC" />
                      <WriteIn tone="sky" label="Bank & branch" />
                    </dl>
                  </>
                )}
              </Panel>
            )}
          </div>
        )}

        {s.accounts && (
          <Panel tone="violet" icon={BookOpen} title="Head of account">
            <dl className="grid grid-cols-2 gap-x-4">
              <Fact tone="violet" label="Head of A/c">{expenseRequest?.headOfAccount || 'N/A'}</Fact>
              <Fact tone="violet" label="Sub-head of A/c">{expenseRequest?.subHeadOfAccount || 'N/A'}</Fact>
            </dl>
          </Panel>
        )}

        {s.description && (
          <Panel tone="amber" icon={FileText} title="Description">
            <p className={cn('whitespace-pre-wrap break-words rounded-md bg-white/70 px-2.5 py-1.5 text-[12.5px] leading-relaxed', roomy ? 'min-h-[56px]' : 'min-h-[36px]')}>
              {entry.description || '—'}
            </p>
          </Panel>
        )}

        {s.trail && (
          <Panel tone="teal" icon={History} title="Trail">
            {trail.length === 0 ? (
              <p className="text-[11px] text-teal-900">Nothing recorded yet.</p>
            ) : (
              <table className="w-full border-collapse overflow-hidden rounded-md bg-white text-[11px]">
                <thead>
                  <tr className="bg-teal-600 text-left text-[9.5px] uppercase tracking-wider text-white">
                    <th className="px-2 py-1 font-semibold">Step</th>
                    <th className="px-2 py-1 font-semibold">By</th>
                    <th className="px-2 py-1 text-right font-semibold">When</th>
                  </tr>
                </thead>
                <tbody>
                  {trail.map((row, i) => (
                    <tr key={i} className="border-b border-teal-100 last:border-0 even:bg-teal-50/60">
                      <td className="px-2 py-1">{row.step}</td>
                      <td className="px-2 py-1 text-slate-700">{row.by}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums text-slate-600">{formatWhen(row.when)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        )}
      </div>

      {s.signatures && <SignatureBlock className={roomy ? 'mt-12' : 'mt-6'} labels={labels} />}

      {(settings.footer.printedBy || settings.footer.sheetNumbers || footerBits.length > 0) && (
        <div
          className={cn(
            'flex flex-wrap justify-between gap-2 border-t-2 border-indigo-100 pt-1.5 text-[10.5px] text-slate-500',
            roomy ? 'mt-10' : 'mt-5',
          )}
        >
          <div className="space-x-4">
            {settings.footer.printedBy && (
              <>
                <span>
                  <span className="font-semibold text-slate-600">Printed By:</span> {printedBy}
                </span>
                <span>
                  <span className="font-semibold text-slate-600">Timestamp:</span> {printedAt}
                </span>
              </>
            )}
            {footerBits.map((bit) => (
              <span key={bit}>{bit}</span>
            ))}
          </div>
          {settings.footer.sheetNumbers && sheet && (
            <span className="font-semibold text-indigo-700">
              Sheet {sheet.index + 1} of {sheet.total}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** A made-up requisition for the preview and the test print — never saved anywhere. */
export function sampleChecklistEntry(): DailyRequisitionEntry & { id: string } {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const at = (ms: number) => ({ toDate: () => new Date(ms) }) as unknown as DailyRequisitionEntry['createdAt'];
  return {
    id: 'sample',
    receptionNo: 'SAMPLE/0001',
    depNo: 'DEP/SAMPLE/0001',
    date: new Date(now - 3 * day).toISOString(),
    projectId: 'sample',
    departmentId: 'sample',
    description: 'Transport of cable drums to site, with loading and unloading.',
    partyName: 'Sample Transport Co.',
    grossAmount: 27500,
    netAmount: 27500,
    createdAt: at(now - 3 * day),
    status: 'Received',
    receivedAt: at(now - 2 * day),
    receivedById: 'sample-receiver',
    documentStatus: 'Uploaded',
    bankDetails: {
      accountHolderName: 'SAMPLE TRANSPORT CO.',
      accountNumber: '000123456789',
      ifscCode: 'SBIN0001234',
      bankName: 'SAMPLE BANK',
      branchName: 'SAMPLE BRANCH',
      source: 'manual',
    },
    flowTrail: [
      {
        action: 'Verified',
        stepKey: 'sample',
        stepName: 'Verification',
        userId: 'sample',
        userName: 'A. Verifier',
        at: at(now - day),
      },
    ],
  } as DailyRequisitionEntry & { id: string };
}

export const SAMPLE_EXPENSE_HEADS = { headOfAccount: 'Site Expenses', subHeadOfAccount: 'Transport' };
export const SAMPLE_PROJECT_NAME = 'Sample Project';
