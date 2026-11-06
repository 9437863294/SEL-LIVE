'use client';

/**
 * Daily Requisition › Settings: every setting the module has, as cards that show where each stands.
 *
 * A hero with how far setup has got and a search box ("/" to focus), what needs attention, then the
 * cards in three groups — Workflow (the steps, live, with who acts at each), Actions (the Reception
 * No series and print setup) and Controls (Field Control, Data Control, the Audit Log). Every figure
 * is read from the module's own documents; a card the viewer may not open is shown dimmed.
 */

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { collection, doc, getCountFromServer, getDoc, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { format } from 'date-fns';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Banknote,
  Check,
  ClipboardCheck,
  Database,
  FileText,
  GitBranch,
  Hash,
  History,
  Lock,
  Printer,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { dailyPageContainerClass, dailySurfaceCardClass } from '@/components/daily-requisition/module-shell';
import { useDailyRequisitionWorkflowSteps } from '@/components/daily-requisition/nav';
import { useDailyRequisitionSettings } from '@/components/daily-requisition/use-daily-requisition-settings';
import { Avatar, personParts } from '@/components/daily-requisition/workflow-editor-parts';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { assignedPeople, PAYMENT_PAGE_NAME, placeSteps, verificationPlacementProblem } from '@/lib/daily-requisition-flow';
import { DR_FIELD_REGISTRY } from '@/lib/daily-requisition-settings';
import { requireDocumentSeries } from '@/lib/document-numbers';
import { counterStart, formatReceptionNo, serialDigits } from '@/lib/daily-requisition-import';
import { db } from '@/lib/firebase';
import type { AssignedTo, SerialNumberConfig, WorkflowStep } from '@/lib/types';
import { cn } from '@/lib/utils';

const BASE = '/daily-requisition';
const SERIES = requireDocumentSeries('daily-requisition');

interface PrintingSettings {
  paperSize?: string;
  orientation?: 'portrait' | 'landscape';
  margins?: { top?: string; bottom?: string; left?: string; right?: string };
  marginUnit?: string;
  headerText?: string;
}

interface RecentChange {
  id: string;
  userName: string;
  userId: string;
  action: string;
  at: Date | null;
}

const asDate = (value: unknown): Date | null => {
  const v = value as { toDate?: () => Date; seconds?: number } | null | undefined;
  if (v && typeof v.toDate === 'function') return v.toDate();
  if (v && typeof v.seconds === 'number') return new Date(v.seconds * 1000);
  return null;
};

const shortDate = (date: Date | null) => (date ? format(date, 'd MMM') : '');

/** The people a step names, by person or across its project/department rows. */
function peopleOf(step: WorkflowStep): string[] {
  if (step.assignmentType === 'User-based') return ((step.assignedTo as string[]) ?? []).filter(Boolean);
  return [...new Set(Object.values((step.assignedTo ?? {}) as Record<string, AssignedTo>).flatMap((row) => assignedPeople(row)))];
}

/** Rows (person-based: the step) that rely on one person alone. */
function hasNoBackup(step: WorkflowStep): boolean {
  if (step.assignmentType === 'User-based') return peopleOf(step).length === 1;
  return Object.values((step.assignedTo ?? {}) as Record<string, AssignedTo>).some((row) => assignedPeople(row).length === 1);
}

function hasNobody(step: WorkflowStep): boolean {
  return peopleOf(step).length === 0;
}

type CardStatus = 'ok' | 'warn' | 'readonly' | 'unset' | 'locked';

function StatusChip({ status }: { status: CardStatus }) {
  const looks: Record<CardStatus, { label: string; className: string; icon?: LucideIcon }> = {
    ok: { label: 'Configured', className: 'bg-green-100 text-green-800', icon: Check },
    warn: { label: 'Needs attention', className: 'bg-amber-100 text-amber-800', icon: AlertTriangle },
    readonly: { label: 'Read-only', className: 'bg-muted text-muted-foreground' },
    unset: { label: 'Not set up yet', className: 'bg-muted text-muted-foreground' },
    locked: { label: 'No access', className: 'bg-muted text-muted-foreground', icon: Lock },
  };
  const look = looks[status];
  const Icon = look.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-bold', look.className)}>
      {Icon ? <Icon className="h-3 w-3" strokeWidth={2.6} /> : null}
      {look.label}
    </span>
  );
}

function AppTile({ icon: Icon, from, to, size = 46 }: { icon: LucideIcon; from: string; to: string; size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center text-white"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        background: `linear-gradient(145deg, ${from}, ${to})`,
        boxShadow: `0 6px 14px -5px color-mix(in srgb, ${to} 60%, transparent), inset 0 1px 0 #ffffff45`,
      }}
    >
      <Icon style={{ width: size * 0.46, height: size * 0.46 }} />
    </span>
  );
}

interface SettingCardProps {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
  from: string;
  to: string;
  status: CardStatus;
  footer?: ReactNode;
  stats?: Array<[string, string]>;
  wide?: boolean;
  disabled?: boolean;
  children?: ReactNode;
}

function SettingCard({ href, title, description, icon, from, to, status, footer, stats, wide, disabled, children }: SettingCardProps) {
  const body = (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-[130px] w-[130px] rounded-full"
        style={{ background: `radial-gradient(circle, color-mix(in srgb, ${from} 20%, transparent), transparent 70%)` }}
      />
      <div className="relative flex items-start gap-3.5">
        <AppTile icon={icon} from={from} to={to} />
        <div className="min-w-0 flex-1">
          <b className="block text-[15px] font-bold leading-snug">{title}</b>
          <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{description}</p>
        </div>
      </div>
      {children ? <div className="relative">{children}</div> : null}
      {stats?.length ? (
        <div className="relative flex flex-wrap gap-1.5">
          {stats.map(([value, label]) => (
            <span key={label} className="rounded-lg bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
              <b className="text-foreground">{value}</b> {label}
            </span>
          ))}
        </div>
      ) : null}
      <div className="relative mt-auto flex items-center justify-between gap-2 border-t border-dashed pt-2.5 text-xs text-muted-foreground">
        <StatusChip status={disabled ? 'locked' : status} />
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{footer}</span>
          {!disabled && <ArrowRight className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5" style={{ color: 'var(--card-accent)' }} />}
        </span>
      </div>
    </>
  );
  const className = cn(
    'group relative flex flex-col gap-3 overflow-hidden rounded-[18px] border bg-card p-[18px] text-left transition duration-200',
    wide && 'md:col-span-2 xl:col-span-3',
    disabled ? 'cursor-not-allowed opacity-60' : 'hover:-translate-y-[3px] hover:shadow-[0_18px_32px_-16px_var(--card-shadow)]',
  );
  const style = { '--card-accent': to, '--card-shadow': `color-mix(in srgb, ${to} 55%, transparent)` } as CSSProperties;
  return disabled ? (
    <div className={className} style={style} aria-disabled title="You do not have access to this setting">
      {body}
    </div>
  ) : (
    <Link href={href} className={className} style={style}>
      {body}
    </Link>
  );
}

function SectionHead({ icon: Icon, from, to, title, description }: { icon: LucideIcon; from: string; to: string; title: string; description: string }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <span className="grid h-[30px] w-[30px] place-items-center rounded-[9px] text-white" style={{ background: `linear-gradient(145deg, ${from}, ${to})` }}>
        <Icon className="h-[15px] w-[15px]" />
      </span>
      <div>
        <h2 className="text-base font-extrabold">{title}</h2>
        <p className="text-[12.5px] text-muted-foreground">{description}</p>
      </div>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/** How far setup has got, as a ring. */
function HealthRing({ done, total }: { done: number; total: number }) {
  const circumference = 2 * Math.PI * 15;
  const share = total ? done / total : 0;
  return (
    <svg width="58" height="58" viewBox="0 0 36 36" aria-hidden>
      <circle cx="18" cy="18" r="15" fill="none" stroke="#ffffff33" strokeWidth="4" />
      <circle
        cx="18"
        cy="18"
        r="15"
        fill="none"
        stroke="#fff"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${share * circumference} ${circumference}`}
        transform="rotate(-90 18 18)"
      />
      <text x="18" y="21.5" textAnchor="middle" fontSize="9" fontWeight="800" fill="#fff">
        {done}/{total}
      </text>
    </svg>
  );
}

export default function DailyRequisitionSettingsPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { users } = useAuth();
  const { steps, isLoading: stepsLoading } = useDailyRequisitionWorkflowSteps();
  const { settings, meta, exists: controlsSaved, isLoading: controlsLoading } = useDailyRequisitionSettings();

  const canViewSettings = can('View', 'Daily Requisition.Settings');
  const canWorkflow = can('View Workflow', 'Daily Requisition.Settings');
  const canFieldControl = can('View', 'Daily Requisition.Field Control') || canViewSettings;
  const canDataControl = can('View', 'Daily Requisition.Data Control') || canViewSettings;
  const canAudit = can('View', 'Daily Requisition.Audit Log') || can('View', 'Settings.Audit Logs');
  const canViewPage = canViewSettings || canWorkflow || canFieldControl || canDataControl || canAudit;

  const [serial, setSerial] = useState<SerialNumberConfig | null | undefined>(undefined);
  const [printing, setPrinting] = useState<PrintingSettings | null | undefined>(undefined);
  const [usage, setUsage] = useState<number | null>(null);
  const [recent, setRecent] = useState<RecentChange[] | null>(null);
  const [term, setTerm] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // The documents behind the Actions cards, and how many requisitions the workflow runs. Each read
  // stands alone: one that is refused leaves its card saying so rather than blanking the page.
  useEffect(() => {
    if (isAuthLoading || !canViewPage) return;
    let active = true;
    getDoc(doc(db, 'serialNumberConfigs', SERIES.id))
      .then((snap) => active && setSerial(snap.exists() ? (snap.data() as SerialNumberConfig) : null))
      .catch(() => active && setSerial(null));
    getDoc(doc(db, 'settings', 'printing'))
      .then((snap) => active && setPrinting(snap.exists() ? (snap.data() as PrintingSettings) : null))
      .catch(() => active && setPrinting(null));
    getCountFromServer(collection(db, 'dailyRequisitions'))
      .then((snap) => active && setUsage(snap.data().count))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [isAuthLoading, canViewPage]);

  // The latest changes, for the Audit Log card and the footer — only for those who may read the log.
  useEffect(() => {
    if (isAuthLoading || !canAudit) return;
    let active = true;
    getDocs(query(collection(db, 'userLogs'), where('module', '==', ACTIVITY_MODULES.DAILY_REQUISITION), orderBy('timestamp', 'desc'), limit(3)))
      .then((snap) => {
        if (!active) return;
        setRecent(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              userName: String(data.userName || data.userEmail || 'Someone'),
              userId: String(data.userId || d.id),
              action: String(data.action || 'Change'),
              at: asDate(data.timestamp),
            };
          }),
        );
      })
      .catch((error) => {
        console.error('Could not read the latest changes:', error);
        if (active) setRecent([]);
      });
    return () => {
      active = false;
    };
  }, [isAuthLoading, canAudit]);

  // "/" focuses the search, as on the stage pages — never while typing somewhere else.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== '/' || target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ---- the workflow, read ---- */
  const placed = useMemo(() => placeSteps(steps), [steps]);
  const workflow = useMemo(() => {
    const invalid = steps.filter((step, index) => hasNobody(step) || verificationPlacementProblem(steps, index));
    const noBackup = steps.filter((step) => !hasNobody(step) && hasNoBackup(step));
    const actions = new Set(
      steps.filter((s) => s.kind !== 'verification').flatMap((s) => (s.actions ?? []).map((a) => (typeof a === 'string' ? a : a.name))),
    );
    return {
      invalid,
      noBackup,
      actions: actions.size,
      totalTat: steps.reduce((sum, s) => sum + (Number(s.tat) || 0), 0),
      verificationSteps: steps.filter((s) => s.kind === 'verification').length,
    };
  }, [steps]);

  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const nameOf = (id: string) => personParts(userById.get(id), id).name;

  /* ---- setup health ---- */
  const setup = [
    { done: steps.length > 0, label: 'Workflow saved' },
    { done: steps.length > 0 && workflow.invalid.length === 0, label: 'Every step has someone to act' },
    { done: steps.length > 0 && workflow.noBackup.length === 0, label: 'Every step has a backup person' },
    { done: Boolean(serial), label: 'Reception No series saved' },
    { done: Boolean(printing), label: 'Printing set up' },
    { done: controlsSaved, label: 'Field and Data Control reviewed' },
  ];
  const setupDone = setup.filter((item) => item.done).length;

  /* ---- what needs attention ---- */
  // Only what this person can go and fix: each item links to a page they may open.
  const attention: Array<{ key: string; text: ReactNode; href: string; cta: string }> = [
    ...(canWorkflow ? workflow.invalid : []).map((step) => ({
      key: `invalid-${step.key ?? step.id}`,
      text: (
        <>
          <b>&ldquo;{step.name}&rdquo; can&apos;t run as set.</b>{' '}
          {hasNobody(step) ? 'Nobody is set to act on it.' : 'It sits where it can never hold a requisition.'}
        </>
      ),
      href: `${BASE}/settings/workflow-configuration`,
      cta: 'Fix in Workflow',
    })),
    ...(canWorkflow ? workflow.noBackup : []).map((step) => ({
      key: `backup-${step.key ?? step.id}`,
      text: (
        <>
          <b>&ldquo;{step.name}&rdquo; has no backup person.</b> When {step.assignmentType === 'User-based' ? 'they are' : 'one of its people is'} away,
          requisitions wait there.
        </>
      ),
      href: `${BASE}/settings/workflow-configuration`,
      cta: 'Fix in Workflow',
    })),
    ...(serial === null && canViewSettings
      ? [
          {
            key: 'serial',
            text: (
              <>
                <b>The Reception No series has never been saved.</b> New requisitions are numbered from the shipped defaults.
              </>
            ),
            href: `${BASE}/settings/serial-numbers`,
            cta: 'Set up numbering',
          },
        ]
      : []),
  ];

  /* ---- cards ---- */
  // As the allocators will issue it: digits, an automatic year and a yearly restart included.
  const nextNo = serial ? formatReceptionNo(serial, counterStart(serial)) : null;
  const fieldValues = Object.values(settings.fields);
  const visibleFields = DR_FIELD_REGISTRY.filter((def) => settings.fields[def.key]?.visible !== false).length;
  const requiredFields = DR_FIELD_REGISTRY.filter((def) => settings.fields[def.key]?.visible !== false && settings.fields[def.key]?.required).length;
  const visibleColumns = settings.columns.filter((c) => c.visible).length;
  const data = settings.data;
  const rulesOn = [
    data.dateControl.enabled,
    !data.allowEditAfterReceived,
    !data.allowDeleteAfterReceived,
    data.requireExpenseRequest,
    !data.netMayExceedGross,
    data.highValueThreshold > 0,
    data.importDuplicateDetection,
  ].filter(Boolean).length;
  const updatedText = (value: unknown, by?: string) => {
    const date = asDate(value);
    return date ? `Updated ${shortDate(date)}${by ? ` by ${by}` : ''}` : 'Using the shipped defaults';
  };

  interface CardDef extends SettingCardProps {
    section: 'Workflow' | 'Actions' | 'Controls';
    keywords: string;
  }

  const cards: CardDef[] = [
    {
      section: 'Workflow',
      keywords: 'steps tat turnaround people assign verification hand over take early buttons actions approval',
      wide: true,
      href: `${BASE}/settings/workflow-configuration`,
      title: 'Workflow Configuration',
      description: 'The steps, who acts at each, their buttons and turnaround time.',
      icon: GitBranch,
      from: '#f0abfc',
      to: '#a21caf',
      disabled: !canWorkflow,
      status: steps.length === 0 ? 'unset' : workflow.invalid.length || workflow.noBackup.length ? 'warn' : 'ok',
      stats: [
        [String(steps.length), steps.length === 1 ? 'step' : 'steps'],
        [`${workflow.totalTat} h`, 'total TAT'],
        [String(workflow.actions), 'actions in use'],
        ...(workflow.verificationSteps ? ([[String(workflow.verificationSteps), workflow.verificationSteps === 1 ? 'verification step' : 'verification steps']] as Array<[string, string]>) : []),
      ],
      footer: usage !== null ? `Live · used by ${usage.toLocaleString('en-IN')} requisitions` : undefined,
      children: (
        <div className="flex flex-wrap items-stretch gap-y-2">
          <div className="flex min-w-[130px] flex-col justify-center rounded-[14px] border border-dashed px-3 py-2 text-muted-foreground">
            <span className="flex items-center gap-1.5 text-[13px] font-bold text-foreground/80">
              <FileText className="h-3.5 w-3.5" /> Entry Sheet
            </span>
            <small className="text-[11.5px]">Requisition recorded</small>
          </div>
          {placed.map(({ step }, index) => {
            const people = peopleOf(step);
            const isMappedStep = step.assignmentType !== 'User-based';
            return (
              <div key={step.key ?? step.id} className="flex items-stretch">
                <span className="hidden w-[26px] place-items-center text-violet-300 sm:grid" aria-hidden>
                  <ArrowRight className="h-4 w-4" />
                </span>
                <div className="relative min-w-[150px] flex-1 rounded-[14px] border border-violet-100 bg-gradient-to-br from-violet-50 to-pink-50 px-3 py-2.5 max-sm:ml-2">
                  <span className="absolute right-2.5 top-2.5 rounded-full border border-violet-100 bg-card px-2 text-[11px] font-extrabold text-violet-700">
                    {Number(step.tat) || 0} h
                  </span>
                  <span className="mr-1.5 inline-grid h-[22px] w-[22px] place-items-center rounded-full bg-gradient-to-br from-violet-600 to-pink-600 text-[11px] font-extrabold text-white">
                    {index + 1}
                  </span>
                  <b className="pr-10 text-[13px]">{step.name}</b>
                  {step.kind === 'verification' && <ShieldCheck className="ml-1 inline h-3.5 w-3.5 text-sky-600" aria-label="Approval step" />}
                  <div className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold">
                    {people.length === 0 ? (
                      <span className="text-amber-700">No one set</span>
                    ) : isMappedStep ? (
                      <span className="text-muted-foreground">{step.assignmentType === 'Project-based' ? 'By project' : 'By department'} · {people.length} people</span>
                    ) : (
                      <>
                        <Avatar id={people[0]} name={nameOf(people[0])} size="sm" />
                        <span className="truncate">
                          {nameOf(people[0])}
                          {people.length > 1 ? <span className="text-muted-foreground"> +{people.length - 1}</span> : null}
                        </span>
                      </>
                    )}
                  </div>
                  {people.length > 0 && hasNoBackup(step) && <small className="mt-1 block text-[11.5px] font-bold text-amber-700">⚠ No backup set</small>}
                </div>
              </div>
            );
          })}
          {/* Payment: the fixed page after the last step, not a step. */}
          <div className="flex items-stretch">
            <span className="hidden w-[26px] place-items-center text-violet-300 sm:grid" aria-hidden>
              <ArrowRight className="h-4 w-4" />
            </span>
            <div className="flex min-w-[130px] flex-col justify-center rounded-[14px] border border-dashed px-3 py-2 text-muted-foreground max-sm:ml-2">
              <span className="flex items-center gap-1.5 text-[13px] font-bold text-foreground/80">
                <Banknote className="h-3.5 w-3.5" /> {PAYMENT_PAGE_NAME}
              </span>
              <small className="text-[11.5px]">Fixed page, after the last step</small>
            </div>
          </div>
        </div>
      ),
    },
    {
      section: 'Actions',
      keywords: 'serial number reception no series prefix suffix running',
      href: `${BASE}/settings/serial-numbers`,
      title: 'Serial Numbers',
      description: 'How Reception Nos are made and the next running number.',
      icon: Hash,
      from: '#7dd3fc',
      to: '#0284c7',
      disabled: !canViewSettings,
      status: serial === undefined ? 'readonly' : serial ? 'ok' : 'unset',
      footer: serial ? 'Saved series' : serial === null ? 'Shipped defaults' : undefined,
      children: (
        <div className="flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2.5 text-slate-200">
          {serial === undefined ? (
            <Skeleton className="h-5 w-40 bg-slate-700" />
          ) : (
            <span className="truncate font-mono text-[15px] tracking-wide">
              {(() => {
                const config = serial ?? SERIES.suggested;
                const number = nextNo ?? formatReceptionNo(config, counterStart(config));
                const running = String(counterStart(config)).padStart(serialDigits(config), '0');
                const at = number.lastIndexOf(running);
                return at >= 0 ? (
                  <>
                    {number.slice(0, at)}
                    <em className="not-italic text-teal-300">{running}</em>
                    {number.slice(at + running.length)}
                  </>
                ) : (
                  number
                );
              })()}
            </span>
          )}
          <small className="ml-auto shrink-0 text-[11px] font-bold text-slate-400">NEXT NO.</small>
        </div>
      ),
    },
    {
      section: 'Actions',
      keywords: 'printing print paper size a4 margins header orientation',
      href: `${BASE}/settings/printing`,
      title: 'Printing Setup',
      description: 'Page size, margins and header for printed requisitions.',
      icon: Printer,
      from: '#fdba74',
      to: '#ea580c',
      disabled: !canViewSettings,
      status: printing === undefined ? 'readonly' : printing ? 'ok' : 'unset',
      footer: printing ? 'Saved setup' : printing === null ? 'Shipped defaults' : undefined,
      children: (
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              'flex shrink-0 flex-col gap-[3px] rounded-[5px] border bg-white p-[5px] shadow-[0_6px_14px_-8px_rgba(15,23,42,0.33)]',
              printing?.orientation === 'landscape' ? 'h-[44px] w-[58px]' : 'h-[58px] w-[44px]',
            )}
            aria-hidden
          >
            <i className="mb-0.5 block h-1.5 rounded-sm bg-gradient-to-r from-rose-600 to-rose-400" />
            {[100, 100, 70, 100, 50].map((w, i) => (
              <i key={i} className="block h-[3px] rounded-sm bg-slate-200" style={{ width: `${w}%` }} />
            ))}
          </span>
          <div className="min-w-0 text-xs leading-relaxed text-muted-foreground">
            <b className="text-foreground">
              {(printing?.paperSize || 'a4').toUpperCase()} {printing?.orientation || 'portrait'}
            </b>{' '}
            · margins {printing?.margins?.top || '20'} {printing?.marginUnit || 'mm'}
            <br />
            <span className="block truncate">Header: {printing?.headerText?.trim() || 'company name'}</span>
          </div>
        </div>
      ),
    },
    {
      section: 'Controls',
      keywords: 'field control fields labels required hidden register columns form',
      href: `${BASE}/settings/field-control`,
      title: 'Field Control',
      description: 'Label, require or hide entry form fields, and choose the register columns.',
      icon: SlidersHorizontal,
      from: '#6ee7b7',
      to: '#047857',
      disabled: !canFieldControl,
      status: controlsLoading ? 'readonly' : controlsSaved ? 'ok' : 'unset',
      stats: [
        [String(visibleFields), `of ${fieldValues.length} fields shown`],
        [String(requiredFields), 'required'],
        [String(visibleColumns), 'register columns'],
      ],
      footer: updatedText(meta.fieldControl.updatedAt, meta.fieldControl.updatedByName),
    },
    {
      section: 'Controls',
      keywords: 'data control date window back-dating backdate edit delete import duplicate expense request high value',
      href: `${BASE}/settings/data-control`,
      title: 'Data Control',
      description: 'Reception date window, edit and delete rules, entry checks and import defaults.',
      icon: Database,
      from: '#93c5fd',
      to: '#1d4ed8',
      disabled: !canDataControl,
      status: controlsLoading ? 'readonly' : controlsSaved ? 'ok' : 'unset',
      stats: [
        [data.dateControl.enabled ? (data.dateControl.backdateDays === 0 ? 'Today only' : `${data.dateControl.backdateDays} days`) : 'Any date', 'back-dating'],
        [data.allowEditAfterReceived ? 'Editable' : 'Locked', 'after receiving'],
        [`${rulesOn} of 7`, 'rules on'],
      ],
      footer: updatedText(meta.dataControl.updatedAt, meta.dataControl.updatedByName),
    },
    {
      section: 'Controls',
      keywords: 'audit log history changes who when',
      href: `${BASE}/audit-log`,
      title: 'Audit Log',
      description: 'Every change made in the module: who, when and exactly what changed.',
      icon: History,
      from: '#cbd5e1',
      to: '#475569',
      disabled: !canAudit,
      status: 'readonly',
      footer: recent?.[0]?.at ? `Last entry ${format(recent[0].at, 'd MMM, h:mm a')}` : undefined,
      children: canAudit ? (
        <div className="flex flex-col gap-1.5">
          {recent === null ? (
            <>
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-4/5" />
            </>
          ) : recent.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing recorded yet.</p>
          ) : (
            recent.slice(0, 2).map((change) => (
              <div key={change.id} className="flex items-center gap-2 text-xs">
                <Avatar id={change.userId} name={change.userName} size="sm" />
                <span className="min-w-0 truncate">{change.action}</span>
                <small className="ml-auto shrink-0 text-muted-foreground">{shortDate(change.at)}</small>
              </div>
            ))
          )}
        </div>
      ) : undefined,
    },
  ];

  const q = term.trim().toLowerCase();
  const matches = (card: CardDef) => !q || `${card.title} ${card.description} ${card.keywords}`.toLowerCase().includes(q);
  const sections: Array<{ name: CardDef['section']; description: string; icon: LucideIcon; from: string; to: string }> = [
    { name: 'Workflow', description: 'The approval steps and process flow', icon: GitBranch, from: '#f0abfc', to: '#a21caf' },
    { name: 'Actions', description: 'Serial numbering and print output', icon: Hash, from: '#7dd3fc', to: '#0284c7' },
    { name: 'Controls', description: "Form fields, data rules and the module's audit trail", icon: SlidersHorizontal, from: '#6ee7b7', to: '#047857' },
  ];

  /* ---------------- render ---------------- */
  if (isAuthLoading) {
    return (
      <div className={dailyPageContainerClass}>
        <Skeleton className="mb-4 h-5 w-60" />
        <Skeleton className="mb-6 h-48 w-full rounded-[22px]" />
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-56 rounded-[18px] md:col-span-2 xl:col-span-3" />
          <Skeleton className="h-44 rounded-[18px]" />
          <Skeleton className="h-44 rounded-[18px]" />
        </div>
      </div>
    );
  }

  if (!canViewPage) {
    return (
      <div className={dailyPageContainerClass}>
        <PageHeader backHref={BASE} eyebrow="Daily Requisition" title="Settings" description="Configure workflow and controls for the daily requisition module." />
        <Card className={dailySurfaceCardClass}>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view this page.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const latest = recent?.[0];

  return (
    <div className={cn(dailyPageContainerClass, 'mx-auto max-w-[1400px] pb-14')}>
      <style>{`
        @keyframes dr-settings-drift { to { background-position: 100% 50%; } }
        .dr-settings-hero { background-size: 140% 140%; animation: dr-settings-drift 18s ease-in-out infinite alternate; }
        @media (prefers-reduced-motion: reduce) { .dr-settings-hero { animation: none; } }
      `}</style>

      {/* Where this is */}
      <nav className="mb-3.5 flex items-center gap-2 text-[12.5px] font-semibold text-muted-foreground" aria-label="Breadcrumb">
        <Link href={BASE} className="mr-1 grid h-[30px] w-[30px] place-items-center rounded-[9px] border bg-card text-foreground/70 hover:text-foreground" aria-label="Back to Daily Requisition">
          <ArrowLeft className="h-[15px] w-[15px]" />
        </Link>
        <Link href={BASE} className="text-foreground/70 hover:underline">
          Daily Requisition
        </Link>
        <span aria-hidden>›</span>
        <span className="text-foreground">Settings</span>
      </nav>

      {/* Hero: what this is, how far setup has got, and search */}
      <section
        className="dr-settings-hero relative grid grid-cols-[auto_1fr] items-center gap-x-5 gap-y-4 overflow-hidden rounded-[22px] p-5 text-white sm:p-7 lg:grid-cols-[auto_1fr_auto]"
        style={{
          backgroundImage:
            'radial-gradient(520px 260px at 92% 0%, #f59e0bbf, transparent 65%), radial-gradient(560px 300px at 70% 110%, #db2777cc, transparent 65%), radial-gradient(620px 320px at 40% -20%, #7c3aedd9, transparent 65%), radial-gradient(600px 340px at 0% 100%, #0f766ef2, transparent 70%), linear-gradient(115deg, #0f766e, #2563eb 35%, #7c3aed 65%, #db2777)',
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: 'radial-gradient(#ffffff14 1px, transparent 1px)',
            backgroundSize: '18px 18px',
            maskImage: 'linear-gradient(90deg, transparent, #000 70%)',
            WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 70%)',
          }}
        />
        <span className="relative grid h-16 w-16 place-items-center rounded-[19px] bg-white/15 shadow-[inset_0_1px_0_#ffffff40]">
          <ClipboardCheck className="h-8 w-8" />
        </span>
        <div className="relative min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-white/75">Daily Requisition · Settings</div>
          <h1 className="my-0.5 text-[22px] font-extrabold tracking-tight sm:text-[28px]">Daily Requisition Settings</h1>
          <p className="text-white/85">Workflow steps, numbering, printing, and the field and data controls for the module</p>
        </div>
        <div className="relative col-span-2 flex items-center gap-3.5 rounded-[18px] border border-white/15 bg-white/10 py-3 pl-3 pr-4 backdrop-blur lg:col-span-1">
          {stepsLoading || serial === undefined || printing === undefined || controlsLoading ? (
            <Skeleton className="h-[58px] w-[58px] rounded-full bg-white/20" />
          ) : (
            <HealthRing done={setupDone} total={setup.length} />
          )}
          <div title={setup.map((item) => `${item.done ? '✓' : '•'} ${item.label}`).join('\n')}>
            <b className="block text-[15px]">Setup {Math.round((setupDone / setup.length) * 100)}% complete</b>
            <small className="text-xs text-white/85">
              {attention.length === 0 ? 'Nothing needs attention' : `${attention.length} ${attention.length === 1 ? 'item needs' : 'items need'} attention`}
            </small>
          </div>
        </div>
        <label className="relative col-span-full flex max-w-[520px] items-center gap-2.5 rounded-[14px] bg-white px-3.5 py-2.5 text-slate-400 shadow-[0_10px_30px_rgba(0,0,0,0.2)]">
          <Search className="h-[18px] w-[18px] shrink-0" />
          <input
            ref={searchRef}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search settings, e.g. TAT, reception no, margins, required fields…"
            aria-label="Search settings"
            aria-keyshortcuts="/"
            className="min-w-0 flex-1 bg-transparent text-slate-900 outline-none placeholder:text-slate-400"
          />
          <kbd className="rounded-md border px-1.5 text-[11px] font-semibold text-slate-500">/</kbd>
        </label>
      </section>

      {/* What needs attention */}
      {attention.length > 0 && !q && (
        <div className="mt-4 space-y-2">
          {attention.slice(0, 3).map((item) => (
            <div key={item.key} className="flex flex-wrap items-center gap-3 rounded-[14px] border border-amber-200 bg-amber-50 px-4 py-2.5 text-amber-950">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-amber-200 text-amber-800">
                <AlertTriangle className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0 flex-1 text-[13px]">{item.text}</div>
              <Link
                href={item.href}
                className="ml-auto inline-flex items-center gap-1.5 rounded-[10px] border border-amber-300 bg-card px-3.5 py-1.5 text-[13px] font-semibold text-amber-900 hover:bg-amber-100"
              >
                {item.cta} <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          ))}
          {attention.length > 3 && <p className="px-1 text-xs text-muted-foreground">and {attention.length - 3} more in Workflow Configuration.</p>}
        </div>
      )}

      {/* The cards */}
      {sections.map((section) => {
        const list = cards.filter((card) => card.section === section.name && matches(card));
        if (!list.length) return null;
        return (
          <section key={section.name} className="mt-6">
            <SectionHead icon={section.icon} from={section.from} to={section.to} title={section.name} description={section.description} />
            <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
              {list.map(({ section: _section, keywords: _keywords, ...card }) => (
                <SettingCard key={card.title} {...card} />
              ))}
            </div>
          </section>
        );
      })}
      {q && !cards.some(matches) && <p className="mt-6 text-sm text-muted-foreground">No settings match &ldquo;{term}&rdquo;.</p>}

      <footer className="mt-8 flex flex-wrap justify-between gap-2 border-t pt-3.5 text-xs text-muted-foreground">
        <span>Every change made here is recorded in the Audit Log.</span>
        {latest ? (
          <span>
            Last changed by {latest.userName}
            {latest.at ? ` · ${format(latest.at, 'd MMM, h:mm a')}` : ''}
          </span>
        ) : null}
      </footer>
    </div>
  );
}
