'use client';

/**
 * Expenses Settings (`/expenses/settings`): a launchpad onto the module's masters, controls and
 * access pages. A banner carries the title and how many settings check out; each card shows what it holds today — counted from the same documents its page edits —
 * whether its page's own validator finds anything wrong, and when it last changed.
 *
 * Nothing here is invented: a figure the viewer may not read, or that fails to load, is simply
 * left off its card, and a card the viewer may not open says so instead of linking.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, getCountFromServer } from 'firebase/firestore';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Database,
  ExternalLink,
  Eye,
  Hash,
  Lock,
  ReceiptIndianRupee,
  ScrollText,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Tags,
  UserCog,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { format } from 'date-fns';
import { db } from '@/lib/firebase';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { useAuthorization } from '@/hooks/useAuthorization';
import { canOpenAccessManagement, type PermissionChecker } from '@/lib/access-control';
import { useExpensesSettings } from '@/components/expenses/use-expenses-settings';
import { useGstRegistrations } from '@/components/expenses/use-gst-registrations';
import { useExpensesRoles } from '@/components/expenses/use-expenses-roles';
import { validateDataControl, validateFieldControl } from '@/lib/expenses-settings';
import { validateRegistrations } from '@/lib/gst-registrations';
import { EXPENSES_ACTIONS, validateExpensesRoles } from '@/lib/expenses-roles';
import { cn } from '@/lib/utils';

/** One tone per settings card, so the cards are told apart by colour as well as by icon. */
const SETTING_TONES = {
  sky: { tile: 'from-sky-500 to-blue-600', ring: 'hover:border-sky-300' },
  teal: { tile: 'from-teal-500 to-emerald-600', ring: 'hover:border-teal-300' },
  amber: { tile: 'from-amber-500 to-orange-600', ring: 'hover:border-amber-300' },
  indigo: { tile: 'from-indigo-500 to-blue-600', ring: 'hover:border-indigo-300' },
  violet: { tile: 'from-violet-500 to-purple-600', ring: 'hover:border-violet-300' },
  slate: { tile: 'from-slate-500 to-slate-700', ring: 'hover:border-slate-300' },
  emerald: { tile: 'from-emerald-500 to-green-600', ring: 'hover:border-emerald-300' },
} as const;

type Tone = (typeof SETTING_TONES)[keyof typeof SETTING_TONES];

type SettingId = 'serials' | 'accounts' | 'field-control' | 'data-control' | 'gst' | 'access' | 'who-does-what' | 'audit';

interface SettingItem {
  id: SettingId;
  icon: LucideIcon;
  title: string;
  description: string;
  href: string;
  tone: Tone;
  /** Who the card is for, as a predicate over `can`, so a card follows its target page's own rule. */
  isEnabled: (can: PermissionChecker) => boolean;
}

/**
 * The same rule the Field Control and Data Control pages apply (see settings-control-kit): View on
 * the section or on Settings to look, and the rights that administered the old combined page still
 * count until roles grant the new sections.
 */
const canSeeControl = (section: string) => (can: PermissionChecker) =>
  can('View', `Expenses.${section}`) ||
  can('Edit', `Expenses.${section}`) ||
  can('View', 'Expenses.Settings') ||
  can('Manage Accounts', 'Expenses.Settings') ||
  can('Edit Serial Nos', 'Expenses.Settings');

/**
 * GST Registrations has no legacy right behind it beyond the one that administers the other
 * masters, so it follows its own page's rule exactly rather than `canSeeControl`'s wider net —
 * otherwise an Edit Serial Nos holder would be offered a card that denies them.
 */
const canSeeGstRegistrations = (can: PermissionChecker) =>
  can('View', 'Expenses.GST Registrations') ||
  can('Edit', 'Expenses.GST Registrations') ||
  can('View', 'Expenses.Settings') ||
  can('Manage Accounts', 'Expenses.Settings');

/**
 * Who Does What follows its own page's rule exactly: View or Edit on the new Expenses › User Roles
 * section, or the rights that administer the module's other masters. It is not `canSeeControl`'s
 * wider net, for the same reason GST Registrations is not — an Edit Serial Nos holder would be
 * offered a card that then denies them.
 */
const canSeeModuleRoles = (can: PermissionChecker) =>
  can('View', 'Expenses.User Roles') ||
  can('Edit', 'Expenses.User Roles') ||
  can('View', 'Expenses.Settings') ||
  can('Manage Accounts', 'Expenses.Settings');

const SECTIONS: { id: string; title: string; description: string; icon: LucideIcon; tone: Tone; items: SettingItem[] }[] = [
  {
    id: 'masters',
    title: 'Masters',
    description: 'Numbering and the chart of accounts every request is booked against.',
    icon: BookOpen,
    tone: SETTING_TONES.sky,
    items: [
      {
        id: 'serials',
        icon: Hash,
        title: 'Department-wise Serial Number',
        description: 'The serial number series expense requests draw from, in each department.',
        href: '/expenses/settings/department-serial-no',
        tone: SETTING_TONES.sky,
        isEnabled: can => can('Edit Serial Nos', 'Expenses.Settings'),
      },
      {
        id: 'accounts',
        icon: Tags,
        title: 'Head of A/c & Sub-Head of A/c',
        description: 'The chart of accounts that expenses are booked against.',
        href: '/expenses/settings/accounts',
        tone: SETTING_TONES.teal,
        isEnabled: can => can('Manage Accounts', 'Expenses.Settings'),
      },
    ],
  },
  {
    id: 'controls',
    title: 'Controls',
    description: 'What the forms ask for, what the registers show, and the rules the module enforces.',
    icon: SlidersHorizontal,
    tone: SETTING_TONES.amber,
    items: [
      {
        id: 'field-control',
        icon: SlidersHorizontal,
        title: 'Field Control',
        description: 'Request form fields — label, help text, required, shown — and register column order and visibility.',
        href: '/expenses/settings/field-control',
        tone: SETTING_TONES.amber,
        isEnabled: canSeeControl('Field Control'),
      },
      {
        id: 'data-control',
        icon: Database,
        title: 'Data Control',
        description: 'Register defaults, editing after reception, entry rules for new requests, and import behaviour.',
        href: '/expenses/settings/data-control',
        tone: SETTING_TONES.indigo,
        isEnabled: canSeeControl('Data Control'),
      },
      {
        id: 'gst',
        icon: ReceiptIndianRupee,
        title: 'GST Registrations',
        description: 'The company’s own GSTINs per state, how a bill is attributed to one, and TDS grouping.',
        href: '/expenses/settings/gst-registrations',
        tone: SETTING_TONES.emerald,
        isEnabled: canSeeGstRegistrations,
      },
    ],
  },
  {
    id: 'access',
    title: 'Access',
    description: 'Who can do what, and a record of what they did.',
    icon: ShieldCheck,
    tone: SETTING_TONES.violet,
    items: [
      {
        id: 'access',
        icon: Users,
        title: 'User Role Configuration',
        description: 'Global roles and permissions for every module — opens the app’s Access Management.',
        href: '/settings/access-management',
        tone: SETTING_TONES.violet,
        // The app-wide role screen, not a screen of this module's: enabled for exactly the people
        // that page admits (the same rule the main Settings page uses).
        isEnabled: canOpenAccessManagement,
      },
      {
        id: 'who-does-what',
        icon: UserCog,
        title: 'Who Does What',
        description: 'Expenses only — who acts on each action, what they act on, and who covers when they are away.',
        href: '/expenses/settings/user-roles',
        tone: SETTING_TONES.teal,
        isEnabled: canSeeModuleRoles,
      },
      {
        id: 'audit',
        icon: ScrollText,
        title: 'Audit Log',
        description: 'Every change made in Expenses — who, when, and what changed.',
        href: '/expenses/audit-log',
        tone: SETTING_TONES.slate,
        isEnabled: can => can('View', 'Expenses.Audit Log') || can('View', 'Settings.Audit Logs'),
      },
    ],
  },
];

/* ── the banner ───────────────────────────────────────────────────────────────────────────────── */

/**
 * The banner takes the app's accent — the viewer's own Appearance choice (`--sel-tab-gradient`), the
 * same colour as the tab strips and the bottom bar — with a soft light in one corner, and sets its
 * text in the colour that accent was chosen to carry (`--sel-tab-on`), so it reads on every theme.
 */
const BANNER_BACKGROUND =
  'radial-gradient(520px 260px at 92% 0%, rgba(255,255,255,.18), transparent 65%), radial-gradient(560px 300px at 0% 110%, rgba(0,0,0,.14), transparent 70%), var(--sel-tab-gradient)';

/** "4 / 5" in a ring: how many of the settings checked have nothing wrong with them. */
function SetupRing({ ok, total }: { ok: number; total: number }) {
  const circumference = 2 * Math.PI * 15;
  const share = total ? ok / total : 0;
  return (
    <svg viewBox="0 0 36 36" className="h-14 w-14 shrink-0" aria-hidden="true">
      {/* In the banner's text colour, so it reads on whichever accent the viewer chose. */}
      <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <circle
        cx="18"
        cy="18"
        r="15"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${share * circumference} ${circumference}`}
        transform="rotate(-90 18 18)"
      />
      <text x="18" y="21.5" textAnchor="middle" fontSize="9" fontWeight="800" fill="currentColor">
        {ok}/{total}
      </text>
    </svg>
  );
}

/* ── a card ───────────────────────────────────────────────────────────────────────────────────── */

type CardStatus = 'ok' | 'warn' | 'external' | 'readonly' | 'unknown';

interface CardView {
  stats: Array<{ value: string; label: string }>;
  status: CardStatus;
  /** The warning's count or wording, beside the chip. */
  statusText?: string;
  /** When it last changed, e.g. "12 Oct 2026". */
  updated?: string;
}

function StatusChip({ status, text }: { status: CardStatus; text?: string }) {
  if (status === 'unknown') return <span />;
  const looks: Record<Exclude<CardStatus, 'unknown'>, { className: string; icon: LucideIcon; label: string }> = {
    ok: { className: 'bg-emerald-50 text-emerald-700', icon: Check, label: 'Set up' },
    warn: { className: 'bg-amber-50 text-amber-800', icon: AlertTriangle, label: text ?? 'Needs attention' },
    external: { className: 'bg-muted text-muted-foreground', icon: ExternalLink, label: 'Opens Access Management' },
    readonly: { className: 'bg-muted text-muted-foreground', icon: Eye, label: 'Read-only' },
  };
  const look = looks[status];
  const Icon = look.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold', look.className)}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {look.label}
    </span>
  );
}

function SettingCard({ item, view, disabled }: { item: SettingItem; view: CardView; disabled: boolean }) {
  const Icon = item.icon;
  const body = (
    <div
      className={cn(
        'group relative flex h-full flex-col gap-3 overflow-hidden rounded-2xl border bg-card p-4 shadow-sm transition-all duration-200',
        disabled ? 'cursor-not-allowed opacity-60' : cn('hover:-translate-y-0.5 hover:shadow-md', item.tone.ring),
      )}
    >
      {/* A soft glow of the card's colour in its corner. */}
      <span aria-hidden="true" className={cn('pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-gradient-to-br opacity-15 blur-2xl', item.tone.tile)} />
      <div className="relative flex items-start gap-3">
        <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md', item.tone.tile)} aria-hidden="true">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold leading-snug text-foreground">{item.title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
        </div>
      </div>
      {view.stats.length ? (
        <div className="relative flex flex-wrap gap-1.5">
          {view.stats.map(stat => (
            <span key={stat.label} className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
              <b className="font-semibold text-foreground">{stat.value}</b> {stat.label}
            </span>
          ))}
        </div>
      ) : null}
      <div className="relative mt-auto flex items-center justify-between gap-2 border-t border-dashed pt-2.5 text-xs text-muted-foreground">
        {disabled ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
            <Lock className="h-3 w-3" aria-hidden="true" /> No access
          </span>
        ) : (
          <StatusChip status={view.status} text={view.statusText} />
        )}
        <span className="flex min-w-0 items-center gap-2">
          {view.updated ? <span className="truncate">Updated {view.updated}</span> : null}
          {disabled ? null : (
            <ArrowRight className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden="true" />
          )}
        </span>
      </div>
    </div>
  );

  if (disabled) return <div className="h-full" title="You do not have access to this setting">{body}</div>;
  return (
    <Link href={item.href} className="h-full rounded-2xl no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {body}
    </Link>
  );
}

/* ── the page ─────────────────────────────────────────────────────────────────────────────────── */

const dateOf = (iso: string | undefined) => {
  if (!iso) return undefined;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? undefined : date;
};
const shortDate = (date: Date | undefined) => (date ? format(date, 'dd MMM yyyy') : undefined);
const inrWhole = (value: number) => `₹${Math.round(value).toLocaleString('en-IN')}`;

export default function ExpensesSettingsPage() {
  const { can, isLoading } = useAuthorization();
  const { settings, isLoading: settingsLoading } = useExpensesSettings();
  const { doc: gstDoc, stamp: gstStamp, isLoading: gstLoading } = useGstRegistrations();
  const { doc: rolesDoc, stamp: rolesStamp, isLoading: rolesLoading } = useExpensesRoles();

  // The page also opens for anyone who may open one of its cards (the menu's Settings entry does too).
  const canViewPage =
    can('View', 'Expenses.Settings') ||
    can('View', 'Expenses.Field Control') ||
    can('View', 'Expenses.Data Control') ||
    can('View', 'Expenses.GST Registrations') ||
    can('View', 'Expenses.User Roles') ||
    can('View', 'Expenses.Audit Log') ||
    can('View', 'Settings.Audit Logs');

  const enabled = useMemo(() => {
    const map = {} as Record<SettingId, boolean>;
    for (const section of SECTIONS) for (const item of section.items) map[item.id] = item.isEnabled(can);
    return map;
  }, [can]);

  // Counts for the masters, read only for a card the viewer may open. A count that cannot be
  // read stays undefined, and its figure is left off the card.
  const [counts, setCounts] = useState<{ departments?: number; serials?: number; heads?: number; subHeads?: number }>({});
  const wantSerials = !isLoading && canViewPage && enabled.serials;
  const wantAccounts = !isLoading && canViewPage && enabled.accounts;
  useEffect(() => {
    if (!wantSerials && !wantAccounts) return;
    let active = true;
    const count = (name: string) =>
      getCountFromServer(collection(db, name)).then(
        snapshot => snapshot.data().count,
        () => undefined,
      );
    void Promise.all([
      wantSerials ? count('departments') : undefined,
      wantSerials ? count('departmentSerialConfigs') : undefined,
      wantAccounts ? count('accountHeads') : undefined,
      wantAccounts ? count('subAccountHeads') : undefined,
    ]).then(([departments, serials, heads, subHeads]) => {
      if (active) setCounts({ departments, serials, heads, subHeads });
    });
    return () => {
      active = false;
    };
  }, [wantSerials, wantAccounts]);

  // Each card's figures and status, from the documents its page edits and that page's validator.
  const fieldIssues = useMemo(() => validateFieldControl(settings), [settings]);
  const dataIssues = useMemo(() => validateDataControl(settings.data), [settings]);
  const gstErrors = useMemo(() => Object.values(validateRegistrations(gstDoc.registrations)), [gstDoc]);
  const roleIssues = useMemo(() => validateExpensesRoles(rolesDoc), [rolesDoc]);
  const activeGstins = gstDoc.registrations.filter(registration => registration.active);
  const assignedActions = EXPENSES_ACTIONS.filter(def => rolesDoc.actions[def.key]?.mode !== 'roles-only').length;

  const views: Record<SettingId, CardView> = {
    serials: {
      stats: [
        ...(counts.departments !== undefined ? [{ value: counts.departments.toLocaleString('en-IN'), label: 'departments' }] : []),
        ...(counts.serials !== undefined && counts.departments !== undefined
          ? [{ value: Math.min(counts.serials, counts.departments).toLocaleString('en-IN'), label: 'with a series of their own' }]
          : []),
      ],
      status: 'unknown',
    },
    accounts: {
      stats: [
        ...(counts.heads !== undefined ? [{ value: counts.heads.toLocaleString('en-IN'), label: counts.heads === 1 ? 'head' : 'heads' }] : []),
        ...(counts.subHeads !== undefined ? [{ value: counts.subHeads.toLocaleString('en-IN'), label: counts.subHeads === 1 ? 'sub-head' : 'sub-heads' }] : []),
      ],
      status: counts.heads === undefined ? 'unknown' : counts.heads === 0 ? 'warn' : 'ok',
      statusText: counts.heads === 0 ? 'No heads yet' : undefined,
    },
    'field-control': {
      stats: settingsLoading
        ? []
        : [
            { value: `${settings.fields.filter(field => field.visible).length} of ${settings.fields.length}`, label: 'fields shown' },
            { value: String(settings.fields.filter(field => field.visible && field.required).length), label: 'required' },
          ],
      status: settingsLoading ? 'unknown' : fieldIssues.length ? 'warn' : 'ok',
      statusText: fieldIssues.length ? `${fieldIssues.length} to review` : undefined,
      updated: shortDate(dateOf(settings.stamps?.fieldControl?.updatedAt ?? settings.updatedAt)),
    },
    'data-control': {
      stats: settingsLoading
        ? []
        : [
            { value: settings.data.allowEditAfterReception ? 'On' : 'Off', label: 'editing after reception' },
            { value: inrWhole(settings.data.highValueThreshold), label: 'high value' },
            {
              value: settings.data.maxRequestAmount > 0 ? inrWhole(settings.data.maxRequestAmount) : 'No limit',
              label: 'per request',
            },
          ],
      status: settingsLoading ? 'unknown' : dataIssues.length ? 'warn' : 'ok',
      statusText: dataIssues.length ? `${dataIssues.length} to review` : undefined,
      updated: shortDate(dateOf(settings.stamps?.dataControl?.updatedAt ?? settings.updatedAt)),
    },
    gst: {
      stats: gstLoading
        ? []
        : [
            { value: String(activeGstins.length), label: activeGstins.length === 1 ? 'active GSTIN' : 'active GSTINs' },
            { value: String(new Set(activeGstins.map(registration => registration.stateCode)).size), label: 'states' },
          ],
      status: gstLoading ? 'unknown' : gstErrors.length || activeGstins.length === 0 ? 'warn' : 'ok',
      statusText: gstErrors.length ? `${gstErrors.length} to fix` : activeGstins.length === 0 ? 'No GSTIN yet' : undefined,
      updated: shortDate(dateOf(gstStamp.at)),
    },
    access: { stats: [], status: 'external' },
    'who-does-what': {
      stats: rolesLoading ? [] : [{ value: `${assignedActions} of ${EXPENSES_ACTIONS.length}`, label: 'actions assigned' }],
      status: rolesLoading ? 'unknown' : roleIssues.length ? 'warn' : 'ok',
      statusText: roleIssues.length ? `${roleIssues.length} to review` : undefined,
      updated: shortDate(dateOf(rolesStamp.at)),
    },
    audit: { stats: [], status: 'readonly' },
  };

  // What needs attention, in the words of each page's own validator, with where to fix it.
  const attention: Array<{ id: SettingId; message: string }> = [
    ...(enabled['who-does-what'] && !rolesLoading ? roleIssues.map(issue => ({ id: 'who-does-what' as const, message: issue.message })) : []),
    ...(enabled.gst && !gstLoading && activeGstins.length === 0
      ? [{ id: 'gst' as const, message: 'No active GSTIN is set, so no bill can be attributed to a registration.' }]
      : []),
    ...(enabled.gst && !gstLoading ? gstErrors.map(message => ({ id: 'gst' as const, message })) : []),
    ...(enabled.accounts && counts.heads === 0 ? [{ id: 'accounts' as const, message: 'There is no head of account yet, so no request can be booked.' }] : []),
    ...(enabled['field-control'] && !settingsLoading ? fieldIssues.map(issue => ({ id: 'field-control' as const, message: issue.message })) : []),
    ...(enabled['data-control'] && !settingsLoading ? dataIssues.map(issue => ({ id: 'data-control' as const, message: issue.message })) : []),
  ];
  // The ring: every card the viewer may open whose status could be worked out.
  const checked = (Object.keys(views) as SettingId[]).filter(id => enabled[id] && (views[id].status === 'ok' || views[id].status === 'warn'));
  const passing = checked.filter(id => views[id].status === 'ok').length;
  const itemById = (id: SettingId) => SECTIONS.flatMap(section => section.items).find(item => item.id === id)!;

  // The latest change any settings page has recorded.
  const lastChange = [
    { where: 'Field Control', at: dateOf(settings.stamps?.fieldControl?.updatedAt), by: settings.stamps?.fieldControl?.updatedByName },
    { where: 'Data Control', at: dateOf(settings.stamps?.dataControl?.updatedAt), by: settings.stamps?.dataControl?.updatedByName },
    { where: 'GST Registrations', at: dateOf(gstStamp.at), by: gstStamp.by },
    { where: 'Who Does What', at: dateOf(rolesStamp.at), by: rolesStamp.by },
  ]
    .filter((entry): entry is { where: string; at: Date; by: string | undefined } => Boolean(entry.at))
    .sort((a, b) => b.at.getTime() - a.at.getTime())[0];

  if (isLoading) {
    return (
      <div className="w-full space-y-5">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-44 w-full rounded-2xl" />
        {SECTIONS.map(section => (
          <div key={section.id} className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {section.items.map(item => (
              <Skeleton key={item.title} className="h-40 rounded-2xl" />
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (!canViewPage) {
    return (
      <div className="w-full">
        <PageHeader icon={Settings2} title="Expenses Settings" backHref="/expenses" />
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to view these settings.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const firstAttention = attention[0];

  return (
    <div className="w-full space-y-4">
      {/* Where this is. */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        <Link
          href="/expenses"
          aria-label="Back to Expenses"
          className="flex h-8 w-8 items-center justify-center rounded-lg border bg-card text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <span className="text-foreground">Settings</span>
      </nav>

      {/* The banner: what this is and how the settings check out. */}
      <section
        className="relative overflow-hidden rounded-2xl px-5 py-5 text-[color:var(--sel-tab-on)] shadow-[0_18px_40px_-24px_var(--sel-tab-glow)] sm:px-7 sm:py-6"
        style={{ background: BANNER_BACKGROUND }}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.09)_1px,transparent_1px)] [background-size:18px_18px] [mask-image:linear-gradient(90deg,transparent,#000_70%)]"
        />
        <div className="relative grid gap-5 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center">
          <span className="hidden h-16 w-16 items-center justify-center rounded-2xl bg-white/15 shadow-[inset_0_1px_0_rgba(255,255,255,.3)] backdrop-blur sm:flex" aria-hidden="true">
            <Settings2 className="h-8 w-8" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] opacity-75">Expenses · Settings</p>
            <h1 className="mt-0.5 text-2xl font-extrabold tracking-tight sm:text-[28px]">Expenses Settings</h1>
            <p className="mt-0.5 text-sm opacity-85">Masters, controls and access for the Expenses module</p>
          </div>
          {checked.length > 0 ? (
            <div className="flex items-center gap-3 rounded-2xl border border-white/20 bg-white/10 py-2.5 pl-2.5 pr-4 backdrop-blur">
              <SetupRing ok={passing} total={checked.length} />
              <div>
                <p className="text-[15px] font-bold">
                  {passing === checked.length ? 'Everything checks out' : `${passing} of ${checked.length} settings check out`}
                </p>
                <p className="text-xs opacity-85">
                  {attention.length === 0 ? 'Nothing needs attention' : `${attention.length} ${attention.length === 1 ? 'item needs' : 'items need'} attention`}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* What needs attention first, in the words of the page that will fix it. */}
      {firstAttention ? (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 sm:flex-row sm:items-center">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-200/80 text-amber-800" aria-hidden="true">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <p className="min-w-0 flex-1 text-sm">
            <b>{itemById(firstAttention.id).title}:</b> {firstAttention.message}
            {attention.length > 1 ? <span className="text-amber-800/80"> · {attention.length - 1} more to review</span> : null}
          </p>
          <Button asChild variant="outline" size="sm" className="shrink-0 border-amber-300 bg-white text-amber-900 hover:bg-amber-100">
            <Link href={itemById(firstAttention.id).href}>Fix in {itemById(firstAttention.id).title} →</Link>
          </Button>
        </div>
      ) : null}

      {SECTIONS.map(section => {
        const SectionIcon = section.icon;
        return (
          <section key={section.id} aria-labelledby={`settings-${section.id}`} className="space-y-3 pt-2">
            <div className="flex items-center gap-3">
              <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white', section.tone.tile)} aria-hidden="true">
                <SectionIcon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h2 id={`settings-${section.id}`} className="text-base font-bold text-foreground">
                  {section.title}
                </h2>
                <p className="text-xs text-muted-foreground">{section.description}</p>
              </div>
              <span aria-hidden="true" className="hidden h-px flex-1 bg-border sm:block" />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {section.items.map(item => (
                <SettingCard key={item.id} item={item} view={views[item.id]} disabled={!enabled[item.id]} />
              ))}
            </div>
          </section>
        );
      })}

      {lastChange ? (
        <p className="border-t pt-3 text-xs text-muted-foreground">
          Last change: {lastChange.where} · {format(lastChange.at, 'dd MMM yyyy, h:mm a')}
          {lastChange.by ? ` by ${lastChange.by}` : ''}
        </p>
      ) : null}
    </div>
  );
}
