'use client';

/**
 * Expenses › Settings › GST Registrations — the company's own GSTINs and how a bill is tied to one.
 *
 * The company works in seven states under seven registrations, and one payment window covers all of
 * them. Every bill therefore has to be attributable to the registration whose return it belongs in,
 * and nothing here is hardcoded: the admin lists the registrations, orders and switches the sources
 * a bill is matched by, and maps projects and departments onto them. The worked example under the
 * chain runs the real `resolveAttribution`, so a rule change is visible before it is saved.
 *
 * Writes the whole of `expensesSettings/gst-registrations` (merge: false) — the document is this
 * page's alone, so a full replace is what makes a removed registration actually disappear. The
 * before/after in the activity log is measured against the document as it stood a moment before
 * the write, flattened into lines a person can read.
 */

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, doc as docRef, getDoc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Building2,
  Check,
  FlaskConical,
  Landmark,
  Loader2,
  Plus,
  ReceiptIndianRupee,
  Save,
  Search,
  Trash2,
  Workflow,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useExpensesActor } from '@/components/expenses/use-expenses-actor';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { diffFields } from '@/lib/activity-logger';
import { normaliseTaxId } from '@/lib/statutory';
import {
  ATTRIBUTION_LABELS,
  ATTRIBUTION_SOURCES,
  DEFAULT_ATTRIBUTION,
  EMPTY_REGISTRATION,
  duplicateStates,
  isValidTan,
  registrationFromGstin,
  registrationLabel,
  resolveAttribution,
  resolveRegistrationsDoc,
  validateRegistrations,
  type AttributionSource,
  type GstAttributionConfig,
  type GstRegistration,
  type GstRegistrationsDoc,
  type TdsGrouping,
} from '@/lib/gst-registrations';
import { useGstRegistrations, GST_REGISTRATIONS_PATH } from '@/components/expenses/use-gst-registrations';
import {
  CONTROL_LABEL,
  ControlAccessDenied,
  ControlCard,
  IssueList,
  ReadOnlyNotice,
  stampLine,
} from '@/components/expenses/settings-control-kit';
import type { ExpenseSettingsIssue } from '@/lib/expenses-settings';
import { PageHeader } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

/** Radix Select cannot hold an empty item value, so "nothing chosen" travels as this. */
const NONE = '__none__';

const newRegistrationId = () => `reg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

interface NamedRecord {
  id: string;
  name: string;
  /** A site code or a department head — shown muted beside the name. */
  note?: string;
}

/* ── access ──────────────────────────────────────────────────────────────── */

/**
 * View with View or Edit on Expenses › GST Registrations, or View on Expenses › Settings. Edit with
 * Edit on the section, or with Manage Accounts on Settings — the right that administers the other
 * Expenses masters, so the page is not read-only for everyone until roles grant the new section.
 */
function useGstRegistrationsAccess() {
  const { can, isLoading } = useAuthorization();
  const { mayWith, isLoading: isActorLoading } = useExpensesActor();
  const resource = 'Expenses.GST Registrations';
  // The module's own assignment (Settings › Who Does What) decides on top of the permission: it may
  // widen editing to the people named, or restrict it to them. At its default it changes nothing.
  const decision = mayWith('gst-registrations', can('Edit', resource) || can('Manage Accounts', 'Expenses.Settings'));
  const canEdit = decision.allowed;
  const canView = canEdit || can('View', resource) || can('View', 'Expenses.Settings');
  // Only worth saying when the assignment is what refused; a permission refusal reads as before.
  const editRefusal = canEdit || decision.mode === 'roles-only' ? null : decision.reason;
  return { canView, canEdit, editRefusal, isLoading: isLoading || isActorLoading };
}

/* ── the flattened shape the activity log diffs ──────────────────────────── */

/**
 * The document as readable lines — "Odisha — Bhubaneswar · GSTIN", "Attribution · order",
 * "Project Site A · registration" — so the audit entry says what changed rather than showing two
 * blobs of JSON.
 */
function flattenRegistrationsDoc(doc: GstRegistrationsDoc, projects: NamedRecord[], departments: NamedRecord[]) {
  const flat: Record<string, string | number> = {};
  const labelOf = (id: string) => {
    const found = doc.registrations.find(registration => registration.id === id);
    return found ? registrationLabel(found) : id ? `(unknown: ${id})` : 'none';
  };

  flat['Registrations · count'] = doc.registrations.length;
  for (const registration of doc.registrations) {
    const name = registrationLabel(registration) || registration.id;
    flat[`${name} · GSTIN`] = registration.gstin || '—';
    flat[`${name} · Name`] = registration.label || '—';
    flat[`${name} · State`] = registration.stateName || '—';
    flat[`${name} · TAN`] = registration.tan || '—';
    flat[`${name} · Active`] = registration.active ? 'Yes' : 'No';
  }

  flat['Attribution · order'] = doc.attribution.order.map(source => ATTRIBUTION_LABELS[source].title).join(' → ');
  for (const source of ATTRIBUTION_SOURCES) {
    flat[`Attribution · ${ATTRIBUTION_LABELS[source].title}`] = doc.attribution.enabled[source] ? 'On' : 'Off';
  }
  flat['Attribution · default registration'] = labelOf(doc.attribution.defaultRegistrationId);
  flat['TDS · grouping'] =
    doc.attribution.tdsGrouping === 'registration' ? 'A separate TAN per registration' : 'One TAN for the whole company';

  const named = (records: NamedRecord[], id: string) => records.find(record => record.id === id)?.name || id;
  for (const [projectId, registrationId] of Object.entries(doc.maps.byProject)) {
    if (!registrationId) continue;
    flat[`Project ${named(projects, projectId)} · registration`] = labelOf(registrationId);
  }
  for (const [departmentId, registrationId] of Object.entries(doc.maps.byDepartment)) {
    if (!registrationId) continue;
    flat[`Department ${named(departments, departmentId)} · registration`] = labelOf(registrationId);
  }
  return flat;
}

/** diffFields only walks the keys of `after`, so anything dropped is spelt out as removed. */
function withRemovals(before: Record<string, string | number>, after: Record<string, string | number>) {
  const padded: Record<string, string | number> = { ...after };
  for (const key of Object.keys(before)) if (!(key in padded)) padded[key] = '(removed)';
  return padded;
}

/* ── the chain, step by step, for the worked example ─────────────────────── */

type StepState = 'off' | 'matched' | 'empty' | 'not-reached';

/**
 * Why `resolveAttribution` landed where it did. It walks the same chain for the same reason the
 * resolver does; the resolver's own answer is still what the preview reports, so the two can never
 * disagree on the outcome.
 */
function traceAttribution(
  input: { gstRegistrationId?: string; projectId?: string; departmentId?: string },
  config: GstAttributionConfig,
  maps: GstRegistrationsDoc['maps'],
  registrations: readonly GstRegistration[],
) {
  const known = new Set(registrations.map(registration => registration.id));
  const steps: { source: AttributionSource; state: StepState; registrationId: string }[] = [];
  let decided = false;
  for (const source of config.order) {
    let candidate = '';
    if (source === 'entry') candidate = input.gstRegistrationId ?? '';
    else if (source === 'project') candidate = input.projectId ? maps.byProject[input.projectId] ?? '' : '';
    else if (source === 'department') candidate = input.departmentId ? maps.byDepartment[input.departmentId] ?? '' : '';
    else candidate = config.defaultRegistrationId;
    const usable = Boolean(candidate && known.has(candidate));

    if (!config.enabled[source]) steps.push({ source, state: 'off', registrationId: '' });
    else if (decided) steps.push({ source, state: 'not-reached', registrationId: '' });
    else if (!usable) steps.push({ source, state: 'empty', registrationId: '' });
    else {
      steps.push({ source, state: 'matched', registrationId: candidate });
      decided = true;
    }
  }
  return steps;
}

const STEP_TONE: Record<StepState, string> = {
  matched: 'border-emerald-200 bg-emerald-50/70 text-emerald-800',
  empty: 'border-slate-200 bg-white text-slate-500',
  off: 'border-slate-200 bg-slate-50 text-slate-400',
  'not-reached': 'border-slate-200 bg-white text-slate-400',
};

const STEP_NOTE: Record<StepState, string> = {
  matched: 'decides',
  empty: 'nothing to go on',
  off: 'switched off',
  'not-reached': 'not reached',
};

/* ── a mapping table (projects, departments) ─────────────────────────────── */

/** How many of a set of records have a registration mapped. */
function mappedCount(records: NamedRecord[], map: Record<string, string>) {
  return records.filter(record => map[record.id]).length;
}

/**
 * The mapping rows for one side (projects or departments): a search, a bulk setter and a row per
 * record. Content only — the tab around it supplies the card, the heading and the count.
 */
function MappingPanel({
  noun,
  records,
  map,
  registrations,
  canEdit,
  isLoading,
  onChange,
  onBulk,
}: {
  /** "projects" / "departments", for the copy. */
  noun: string;
  records: NamedRecord[];
  map: Record<string, string>;
  registrations: GstRegistration[];
  canEdit: boolean;
  isLoading: boolean;
  onChange: (recordId: string, registrationId: string) => void;
  onBulk: (recordIds: string[], registrationId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const selectable = registrations.filter(registration => registration.active);

  const needle = search.trim().toLowerCase();
  const shown = needle
    ? records.filter(record => `${record.name} ${record.note ?? ''}`.toLowerCase().includes(needle))
    : records;
  const unmappedShown = shown.filter(record => !map[record.id]).map(record => record.id);

  return (
    <>
      <div className="flex flex-col gap-2 border-b bg-slate-50/50 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:w-[17rem]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 pl-8 text-sm"
            placeholder={`Search ${noun}`}
            aria-label={`Search ${noun}`}
            value={search}
            onChange={event => setSearch(event.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {unmappedShown.length === 0 ? `Nothing unmapped${needle ? ' here' : ''}` : `Set the ${unmappedShown.length} unmapped to`}
          </span>
          <Select
            value={NONE}
            disabled={!canEdit || unmappedShown.length === 0 || selectable.length === 0}
            onValueChange={value => {
              if (value === NONE) return;
              onBulk(unmappedShown, value);
            }}
          >
            <SelectTrigger className="h-9 w-full text-sm sm:w-[15rem]">
              <SelectValue placeholder="Choose a registration" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Choose a registration…</SelectItem>
              {selectable.map(registration => (
                <SelectItem key={registration.id} value={registration.id}>
                  {registrationLabel(registration)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : shown.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">
          {records.length === 0 ? `No ${noun} found.` : `No ${noun} match “${search}”.`}
        </p>
      ) : (
        <div className="max-h-[24rem] overflow-y-auto">
          <div className="divide-y">
            {shown.map(record => {
              const current = map[record.id] ?? '';
              const stale = Boolean(current) && !registrations.some(registration => registration.id === current);
              return (
                <div
                  key={record.id}
                  className="grid grid-cols-1 items-center gap-2 px-4 py-2 sm:grid-cols-[minmax(0,1fr)_16rem]"
                >
                  <div className="min-w-0">
                    <span className="block truncate text-sm text-slate-800">{record.name}</span>
                    {record.note && <span className="block truncate text-[11px] text-muted-foreground">{record.note}</span>}
                  </div>
                  <Select
                    value={current && !stale ? current : NONE}
                    disabled={!canEdit}
                    onValueChange={value => onChange(record.id, value === NONE ? '' : value)}
                  >
                    <SelectTrigger
                      className={cn('h-8 text-sm', stale && 'border-destructive/40', !current && 'text-muted-foreground')}
                      aria-label={`Registration for ${record.name}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>— not mapped —</SelectItem>
                      {selectable.map(registration => (
                        <SelectItem key={registration.id} value={registration.id}>
                          {registrationLabel(registration)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

/** One figure in the header strip. */
function SummaryStat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'warning' }) {
  return (
    <div className="min-w-0 px-4 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={cn('truncate text-sm font-semibold text-slate-900', tone === 'warning' && 'text-amber-700')} title={value}>
        {value}
      </p>
      {hint && <p className="truncate text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/* ── the page ────────────────────────────────────────────────────────────── */

export default function GstRegistrationsSettingsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { log } = useActivityLogger(ACTIVITY_MODULES.EXPENSES);
  const { canView, canEdit, editRefusal, isLoading: isAuthLoading } = useGstRegistrationsAccess();
  const { doc: remote, isLoading: isDocLoading, stamp } = useGstRegistrations();

  /* The draft follows the live document until something is edited, then holds until saved. */
  const [draft, setDraft] = useState<GstRegistrationsDoc | null>(null);
  const [awaitingFrom, setAwaitingFrom] = useState<string | null>(null);
  const remoteKey = useMemo(() => JSON.stringify(remote), [remote]);
  const draftKey = draft === null ? remoteKey : JSON.stringify(draft);
  if (awaitingFrom !== null && (draftKey === remoteKey || remoteKey !== awaitingFrom)) {
    // Render-phase adjustment: the save has landed (or a newer snapshot has), so hand back to live.
    setAwaitingFrom(null);
    setDraft(null);
  }
  const value = draft ?? remote;
  const isDirty = awaitingFrom === null && draftKey !== remoteKey;
  const update = (change: (current: GstRegistrationsDoc) => GstRegistrationsDoc) =>
    setDraft(current => change(current ?? remote));

  const [projects, setProjects] = useState<NamedRecord[]>([]);
  const [departments, setDepartments] = useState<NamedRecord[]>([]);
  const [isListLoading, setIsListLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [tab, setTab] = useState('registrations');
  const [mappingSide, setMappingSide] = useState<'byProject' | 'byDepartment'>('byProject');
  const [sample, setSample] = useState<{ gstRegistrationId: string; projectId: string; departmentId: string }>({
    gstRegistrationId: '',
    projectId: '',
    departmentId: '',
  });

  useEffect(() => {
    if (isAuthLoading || !canView) {
      if (!isAuthLoading) setIsListLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [projectsSnap, departmentsSnap] = await Promise.all([
          getDocs(collection(db, 'projects')),
          getDocs(collection(db, 'departments')),
        ]);
        if (cancelled) return;
        setProjects(
          projectsSnap.docs
            .map(entry => {
              const data = entry.data() as { projectName?: string; siteCode?: string; projectSite?: string };
              return {
                id: entry.id,
                name: data.projectName || entry.id,
                note: [data.siteCode, data.projectSite].filter(Boolean).join(' · ') || undefined,
              };
            })
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
        setDepartments(
          departmentsSnap.docs
            .map(entry => {
              const data = entry.data() as { name?: string; head?: string };
              return { id: entry.id, name: data.name || entry.id, note: data.head || undefined };
            })
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      } catch (error) {
        console.error('Could not load projects and departments:', error);
        toast({ title: 'Could not load projects', description: 'The mapping tables may be incomplete.', variant: 'destructive' });
      } finally {
        if (!cancelled) setIsListLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthLoading, canView]);

  const registrations = value.registrations;
  const errors = useMemo(() => validateRegistrations(registrations), [registrations]);
  const rowErrors = useMemo(
    () => Object.fromEntries(Object.entries(errors).filter(([id]) => id !== '')),
    [errors],
  );
  const blocked = Object.keys(errors).length > 0;
  const sharedStates = useMemo(() => duplicateStates(registrations), [registrations]);
  const activeRegistrations = registrations.filter(registration => registration.active);
  const missingTan = registrations.filter(registration => registration.active && !isValidTan(registration.tan));
  const defaultRegistration = registrations.find(registration => registration.id === value.attribution.defaultRegistrationId) ?? null;
  const statesCovered = [...new Set(registrations.filter(r => r.active && r.stateName).map(r => r.stateName))].sort();
  const mappedProjects = mappedCount(projects, value.maps.byProject);
  const mappedDepartments = mappedCount(departments, value.maps.byDepartment);

  const issues = useMemo<ExpenseSettingsIssue[]>(() => {
    const list: ExpenseSettingsIssue[] = [];
    if (errors['']) list.push({ severity: 'error', message: errors[''] });
    if (registrations.length === 0) {
      list.push({ severity: 'warning', message: 'No registrations yet — add one per state the company is registered in.' });
    } else if (!value.attribution.defaultRegistrationId) {
      list.push({
        severity: 'warning',
        message: 'No default registration, so a bill that matches nothing else is left out of every return.',
      });
    } else if (!activeRegistrations.some(registration => registration.id === value.attribution.defaultRegistrationId)) {
      list.push({ severity: 'warning', message: 'The default registration is not active. Pick an active one.' });
    }
    if (!ATTRIBUTION_SOURCES.some(source => value.attribution.enabled[source])) {
      list.push({ severity: 'warning', message: 'Every source is switched off, so no bill can be attributed at all.' });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errors, registrations, value.attribution, activeRegistrations.length]);

  /* ── editing ── */

  const setRegistration = (id: string, change: Partial<GstRegistration>) =>
    update(current => ({
      ...current,
      registrations: current.registrations.map(registration =>
        registration.id === id ? { ...registration, ...change } : registration,
      ),
    }));

  const setGstin = (id: string, raw: string) => {
    const typed = normaliseTaxId(raw).slice(0, 15);
    update(current => ({
      ...current,
      registrations: current.registrations.map(registration => {
        if (registration.id !== id) return registration;
        // A valid number fills in the state and, while the name is still untouched, the name too.
        const derived = registrationFromGstin(typed, registration.label);
        return { ...registration, ...derived, gstin: typed, stateCode: derived.stateCode ?? '', stateName: derived.stateName ?? '' };
      }),
    }));
  };

  const addRegistration = () =>
    update(current => {
      const created: GstRegistration = { ...EMPTY_REGISTRATION, id: newRegistrationId() };
      return {
        ...current,
        registrations: [...current.registrations, created],
        attribution: {
          ...current.attribution,
          // The first registration is the default, so a fresh set-up is never left unattributed.
          defaultRegistrationId: current.registrations.length === 0 ? created.id : current.attribution.defaultRegistrationId,
        },
      };
    });

  const removeRegistration = (id: string) =>
    update(current => {
      const kept = current.registrations.filter(registration => registration.id !== id);
      const prune = (map: Record<string, string>) =>
        Object.fromEntries(Object.entries(map).filter(([, registrationId]) => registrationId !== id));
      return {
        registrations: kept,
        attribution: {
          ...current.attribution,
          defaultRegistrationId:
            current.attribution.defaultRegistrationId === id
              ? kept.find(registration => registration.active)?.id ?? ''
              : current.attribution.defaultRegistrationId,
        },
        maps: { byProject: prune(current.maps.byProject), byDepartment: prune(current.maps.byDepartment) },
      };
    });

  const setAttribution = (change: Partial<GstAttributionConfig>) =>
    update(current => ({ ...current, attribution: { ...current.attribution, ...change } }));

  const moveSource = (index: number, direction: 'up' | 'down') => {
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= value.attribution.order.length) return;
    const order = [...value.attribution.order];
    [order[index], order[target]] = [order[target], order[index]];
    setAttribution({ order });
  };

  const setMapEntry = (side: 'byProject' | 'byDepartment', recordId: string, registrationId: string) =>
    update(current => {
      const next = { ...current.maps[side] };
      if (registrationId) next[recordId] = registrationId;
      else delete next[recordId];
      return { ...current, maps: { ...current.maps, [side]: next } };
    });

  const setMapBulk = (side: 'byProject' | 'byDepartment', recordIds: string[], registrationId: string) =>
    update(current => {
      const next = { ...current.maps[side] };
      for (const recordId of recordIds) next[recordId] = registrationId;
      return { ...current, maps: { ...current.maps, [side]: next } };
    });

  /* ── save ── */

  const buildPayload = () => {
    const known = new Set(registrations.map(registration => registration.id));
    const prune = (map: Record<string, string>) =>
      Object.fromEntries(Object.entries(map).filter(([, registrationId]) => registrationId && known.has(registrationId)));
    return {
      registrations: registrations.map(registration => ({
        id: registration.id,
        gstin: normaliseTaxId(registration.gstin),
        stateCode: registration.stateCode || '',
        stateName: registration.stateName || '',
        label: registration.label?.trim() || '',
        tan: normaliseTaxId(registration.tan) || '',
        active: registration.active !== false,
      })),
      attribution: {
        order: [...value.attribution.order],
        enabled: { ...DEFAULT_ATTRIBUTION.enabled, ...value.attribution.enabled },
        defaultRegistrationId: known.has(value.attribution.defaultRegistrationId) ? value.attribution.defaultRegistrationId : '',
        tdsGrouping: value.attribution.tdsGrouping,
      },
      maps: { byProject: prune(value.maps.byProject), byDepartment: prune(value.maps.byDepartment) },
    };
  };

  const handleSave = async () => {
    if (!user || !canEdit || blocked || isSaving) return;
    setIsSaving(true);
    try {
      const payload = buildPayload();
      const reference = docRef(db, GST_REGISTRATIONS_PATH.collection, GST_REGISTRATIONS_PATH.doc);
      const snapshot = await getDoc(reference);
      const before = resolveRegistrationsDoc(snapshot.exists() ? snapshot.data() : undefined);
      await setDoc(
        reference,
        {
          ...payload,
          updatedAt: serverTimestamp(),
          updatedById: user.id,
          updatedByName: user.name || user.email || user.id,
        },
        { merge: false },
      );
      const flatBefore = flattenRegistrationsDoc(before, projects, departments);
      const flatAfter = flattenRegistrationsDoc(resolveRegistrationsDoc(payload), projects, departments);
      const changes = diffFields(flatBefore, withRemovals(flatBefore, flatAfter));
      await log(
        'Update GST Registrations',
        { changes, changedCount: Object.keys(changes).length, registrations: payload.registrations.length },
        { recordId: 'gst-registrations', recordRef: 'GST Registrations' },
      );
      setDraft(resolveRegistrationsDoc(payload));
      setAwaitingFrom(remoteKey);
      toast({ title: 'GST registrations saved', description: 'Every bill is attributed by these rules from now on.' });
    } catch (error) {
      console.error('Could not save the GST registrations:', error);
      toast({ title: 'Save failed', description: 'The configuration was not written.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const discard = () => {
    setAwaitingFrom(null);
    setDraft(null);
  };

  /* ── the worked example ── */

  const sampleInput = {
    gstRegistrationId: sample.gstRegistrationId || undefined,
    projectId: sample.projectId || undefined,
    departmentId: sample.departmentId || undefined,
  };
  const preview = resolveAttribution(sampleInput, value.attribution, value.maps, registrations);
  const previewSteps = traceAttribution(sampleInput, value.attribution, value.maps, registrations);
  const previewRegistration = registrations.find(registration => registration.id === preview.registrationId) ?? null;

  /* ── render ── */

  if (isAuthLoading || isDocLoading) {
    return (
      <div className="w-full space-y-4">
        <Skeleton className="h-14 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="w-full space-y-4">
        <PageHeader
          icon={ReceiptIndianRupee}
          title="GST Registrations"
          backHref="/expenses/settings"
          backLabel="Back to settings"
        />
        <ControlAccessDenied />
      </div>
    );
  }

  return (
    <div className="w-full space-y-4">
      <PageHeader
        icon={ReceiptIndianRupee}
        title="GST Registrations"
        description={stampLine(stamp, 'The company’s own GSTINs and how a bill is tied to one of them')}
        backHref="/expenses/settings"
        backLabel="Back to settings"
      />

      {/* Where the set-up stands, before any of the detail. */}
      <div className="grid grid-cols-2 divide-x divide-y rounded-xl border bg-white shadow-sm sm:grid-cols-4 sm:divide-y-0">
        <SummaryStat
          label="Registrations"
          value={registrations.length === 0 ? 'None yet' : String(registrations.length)}
          hint={
            registrations.length === 0
              ? 'Add one per state'
              : `${activeRegistrations.length} active${registrations.length !== activeRegistrations.length ? `, ${registrations.length - activeRegistrations.length} inactive` : ''}`
          }
          tone={registrations.length === 0 ? 'warning' : undefined}
        />
        <SummaryStat
          label="States"
          value={statesCovered.length === 0 ? '—' : String(statesCovered.length)}
          hint={statesCovered.length > 0 ? statesCovered.join(', ') : 'From each GSTIN'}
        />
        <SummaryStat
          label="Default registration"
          value={defaultRegistration ? registrationLabel(defaultRegistration) : 'Not set'}
          hint={defaultRegistration ? 'Used when nothing else decides' : 'Bills matching nothing are left out'}
          tone={defaultRegistration ? undefined : 'warning'}
        />
        <SummaryStat
          label="Mapped"
          value={`${mappedProjects}/${projects.length} projects`}
          hint={`${mappedDepartments} of ${departments.length} departments`}
        />
      </div>

      {!canEdit && <ReadOnlyNotice section="GST Registrations" refusal={editRefusal} />}
      <IssueList issues={issues} />

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="h-auto w-full flex-wrap justify-start sm:w-auto">
          <TabsTrigger value="registrations" className="gap-1.5">
            <Landmark className="h-3.5 w-3.5" /> Registrations
            {registrations.length > 0 && <span className="ml-0.5 tabular-nums text-muted-foreground">{registrations.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="attribution" className="gap-1.5">
            <Workflow className="h-3.5 w-3.5" /> Attribution
          </TabsTrigger>
          <TabsTrigger value="mapping" className="gap-1.5">
            <Building2 className="h-3.5 w-3.5" /> Mapping
            <span className="ml-0.5 tabular-nums text-muted-foreground">{mappedProjects + mappedDepartments}</span>
          </TabsTrigger>
          <TabsTrigger value="tds" className="gap-1.5">
            <ReceiptIndianRupee className="h-3.5 w-3.5" /> TDS
          </TabsTrigger>
        </TabsList>

        {/* ── the registrations, as one table rather than a form per row ── */}
        <TabsContent value="registrations" className="mt-3">
          <ControlCard
            icon={Landmark}
            title="Your GST registrations"
            description="One per state the company files a return in. Type the GSTIN and the state fills itself in."
            contentClassName="p-0"
            actions={
              <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" disabled={!canEdit} onClick={addRegistration}>
                <Plus className="h-3.5 w-3.5" /> Add registration
              </Button>
            }
          >
            {registrations.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
                <Landmark className="h-7 w-7 text-slate-300" />
                <p className="text-sm font-medium text-slate-800">No registrations yet</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Add one for each state the company is registered in. Until then every bill uses the single-state default.
                </p>
                <Button type="button" size="sm" className="mt-1 gap-1.5" disabled={!canEdit} onClick={addRegistration}>
                  <Plus className="h-3.5 w-3.5" /> Add the first registration
                </Button>
              </div>
            ) : (
              <RadioGroup
                asChild
                value={value.attribution.defaultRegistrationId || NONE}
                disabled={!canEdit}
                onValueChange={id => setAttribution({ defaultRegistrationId: id === NONE ? '' : id })}
              >
                <div className="min-w-0 overflow-x-auto">
                  <table className="w-full min-w-[56rem] border-collapse text-sm">
                    <thead>
                      <tr className="border-b bg-slate-50/70 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        <th scope="col" className="py-2 pl-4 pr-3 font-semibold">GSTIN</th>
                        <th scope="col" className="px-3 py-2 font-semibold">State</th>
                        <th scope="col" className="px-3 py-2 font-semibold">Name</th>
                        <th scope="col" className="px-3 py-2 font-semibold">TAN</th>
                        <th scope="col" className="px-3 py-2 text-center font-semibold">Default</th>
                        <th scope="col" className="px-3 py-2 text-center font-semibold">Active</th>
                        <th scope="col" className="py-2 pl-3 pr-4">
                          <span className="sr-only">Remove</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {registrations.map(registration => {
                        const error = rowErrors[registration.id];
                        return (
                          <Fragment key={registration.id}>
                            <tr className={cn('align-middle', !registration.active && 'bg-slate-50/40')}>
                              <td className="py-2 pl-4 pr-3">
                                <Input
                                  className={cn(
                                    'h-8 w-[11.5rem] font-mono text-sm uppercase tracking-tight',
                                    error && 'border-destructive/60',
                                  )}
                                  maxLength={15}
                                  autoComplete="off"
                                  spellCheck={false}
                                  placeholder="21ABCDE1234F1Z5"
                                  aria-label="GSTIN"
                                  aria-invalid={Boolean(error)}
                                  disabled={!canEdit}
                                  value={registration.gstin}
                                  onChange={event => setGstin(registration.id, event.target.value)}
                                />
                              </td>
                              <td className="px-3 py-2">
                                {registration.stateName ? (
                                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-700">
                                    <span className="font-mono text-[11px] text-slate-400">{registration.stateCode}</span>
                                    {registration.stateName}
                                  </span>
                                ) : (
                                  <span className="text-[11px] text-muted-foreground">from the GSTIN</span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                <Input
                                  className="h-8 w-full min-w-[10rem] text-sm"
                                  placeholder={registration.stateName || 'Odisha — Bhubaneswar'}
                                  aria-label="Name"
                                  disabled={!canEdit}
                                  value={registration.label}
                                  onChange={event => setRegistration(registration.id, { label: event.target.value })}
                                />
                              </td>
                              <td className="px-3 py-2">
                                <Input
                                  className="h-8 w-[8.5rem] font-mono text-sm uppercase tracking-tight"
                                  maxLength={10}
                                  autoComplete="off"
                                  spellCheck={false}
                                  placeholder="optional"
                                  aria-label="TAN"
                                  disabled={!canEdit}
                                  value={registration.tan ?? ''}
                                  onChange={event => setRegistration(registration.id, { tan: normaliseTaxId(event.target.value).slice(0, 10) })}
                                />
                              </td>
                              <td className="px-3 py-2 text-center">
                                <RadioGroupItem
                                  value={registration.id}
                                  disabled={!canEdit || !registration.active}
                                  aria-label={`Make ${registrationLabel(registration)} the default`}
                                  title={registration.active ? 'Use when nothing else decides' : 'Only an active registration can be the default'}
                                />
                              </td>
                              <td className="px-3 py-2 text-center">
                                <Switch
                                  checked={registration.active}
                                  disabled={!canEdit}
                                  aria-label={`${registrationLabel(registration)} active`}
                                  onCheckedChange={checked => {
                                    setRegistration(registration.id, { active: checked });
                                    // The default has to be an active registration, so it steps aside.
                                    if (!checked && value.attribution.defaultRegistrationId === registration.id) {
                                      setAttribution({
                                        defaultRegistrationId:
                                          registrations.find(other => other.id !== registration.id && other.active)?.id ?? '',
                                      });
                                    }
                                  }}
                                />
                              </td>
                              <td className="py-2 pl-3 pr-4 text-right">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                  disabled={!canEdit}
                                  aria-label={`Remove ${registrationLabel(registration)}`}
                                  title="Remove this registration"
                                  onClick={() => removeRegistration(registration.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </td>
                            </tr>
                            {error && (
                              <tr>
                                <td colSpan={7} className="border-b bg-destructive/5 py-1.5 pl-4 pr-4">
                                  <p className="flex items-start gap-1.5 text-[11px] font-medium text-destructive">
                                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {error}
                                  </p>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </RadioGroup>
            )}
            {sharedStates.length > 0 && (
              <div className="flex items-start gap-2 border-t border-amber-500/30 bg-amber-500/5 px-4 py-2.5 text-[11px] text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Two registrations in {sharedStates.join(', ')}. That is allowed for separate business verticals, but far more
                  often a typo — worth a second look.
                </span>
              </div>
            )}
          </ControlCard>
        </TabsContent>

        {/* ── the chain, with the sandbox beside it rather than below ── */}
        <TabsContent value="attribution" className="mt-3">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ControlCard
              icon={Workflow}
              title="How a bill finds its registration"
              description="Tried from the top down. The first source with an answer decides; anything switched off is never tried."
              contentClassName="p-0"
            >
              <div className="divide-y">
                {value.attribution.order.map((source, index) => {
                  const meta = ATTRIBUTION_LABELS[source];
                  const on = value.attribution.enabled[source];
                  return (
                    <div key={source} className={cn('flex items-center gap-3 px-4 py-2.5', !on && 'bg-slate-50/50')}>
                      <span
                        className={cn(
                          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums',
                          on ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-500',
                        )}
                      >
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className={cn('text-sm font-medium text-slate-800', !on && 'text-muted-foreground')}>{meta.title}</p>
                        <p className="text-[11px] leading-snug text-muted-foreground">{meta.hint}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={!canEdit || index === 0}
                          aria-label={`Move ${meta.title} up`}
                          onClick={() => moveSource(index, 'up')}
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={!canEdit || index === value.attribution.order.length - 1}
                          aria-label={`Move ${meta.title} down`}
                          onClick={() => moveSource(index, 'down')}
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                        <Switch
                          className="ml-1.5"
                          checked={on}
                          disabled={!canEdit}
                          aria-label={`${meta.title} on`}
                          onCheckedChange={checked =>
                            setAttribution({ enabled: { ...value.attribution.enabled, [source]: checked } })
                          }
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </ControlCard>

            <ControlCard
              icon={FlaskConical}
              title="Try it on a bill"
              description="Set a bill up here and watch the rules above decide. Nothing is saved by trying."
              contentClassName="space-y-3 p-4"
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="min-w-0 space-y-1">
                  <label className={CONTROL_LABEL}>Project</label>
                  <Select
                    value={sample.projectId || NONE}
                    onValueChange={id => setSample(current => ({ ...current, projectId: id === NONE ? '' : id }))}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="No project" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No project</SelectItem>
                      {projects.map(project => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-0 space-y-1">
                  <label className={CONTROL_LABEL}>Department</label>
                  <Select
                    value={sample.departmentId || NONE}
                    onValueChange={id => setSample(current => ({ ...current, departmentId: id === NONE ? '' : id }))}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="No department" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No department</SelectItem>
                      {departments.map(department => (
                        <SelectItem key={department.id} value={department.id}>
                          {department.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-0 space-y-1">
                  <label className={CONTROL_LABEL}>Chosen on the bill</label>
                  <Select
                    value={sample.gstRegistrationId || NONE}
                    onValueChange={id => setSample(current => ({ ...current, gstRegistrationId: id === NONE ? '' : id }))}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Nothing chosen" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Nothing chosen</SelectItem>
                      {activeRegistrations.map(registration => (
                        <SelectItem key={registration.id} value={registration.id}>
                          {registrationLabel(registration)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div
                className={cn(
                  'rounded-xl border px-3 py-2.5',
                  preview.registrationId ? 'border-emerald-200 bg-emerald-50/70' : 'border-destructive/30 bg-destructive/5',
                )}
              >
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">This bill goes to</span>
                <p className={cn('mt-0.5 text-base font-semibold', preview.registrationId ? 'text-emerald-900' : 'text-destructive')}>
                  {preview.registrationId ? registrationLabel(previewRegistration) : 'No registration'}
                </p>
                <p className="mt-0.5 text-xs text-slate-600">
                  {preview.reason}
                  {preview.source !== 'none' && ` · ${ATTRIBUTION_LABELS[preview.source].title}`}
                </p>
                {previewRegistration?.stateName && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Filed in {previewRegistration.stateName} — a supplier there charges CGST + SGST, one elsewhere charges IGST.
                  </p>
                )}
              </div>

              <div className="space-y-1">
                {previewSteps.map((step, index) => (
                  <div
                    key={step.source}
                    className={cn('flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs', STEP_TONE[step.state])}
                  >
                    <span className="w-3 shrink-0 text-center text-[10px] tabular-nums opacity-60">{index + 1}</span>
                    {step.state === 'matched' ? (
                      <Check className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-50" />
                    )}
                    <span className="min-w-0 flex-1 truncate font-medium">{ATTRIBUTION_LABELS[step.source].title}</span>
                    <span className="shrink-0 text-[11px]">
                      {step.state === 'matched'
                        ? registrationLabel(registrations.find(registration => registration.id === step.registrationId))
                        : STEP_NOTE[step.state]}
                    </span>
                  </div>
                ))}
              </div>
            </ControlCard>
          </div>
        </TabsContent>

        {/* ── one mapping card, two sides ── */}
        <TabsContent value="mapping" className="mt-3">
          <ControlCard
            icon={Building2}
            title={mappingSide === 'byProject' ? 'Projects' : 'Departments'}
            description={
              mappingSide === 'byProject'
                ? "The registration a project's bills belong to — the state the site is in."
                : "For a company run as one branch per state: the registration a department's bills belong to."
            }
            contentClassName="p-0"
            actions={
              <div className="flex items-center gap-3">
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {mappingSide === 'byProject'
                    ? `${mappedProjects} of ${projects.length} mapped`
                    : `${mappedDepartments} of ${departments.length} mapped`}
                </span>
                <div role="tablist" aria-label="What to map" className="inline-flex rounded-lg border bg-white p-0.5 text-xs">
                  {(
                    [
                      ['byProject', 'Projects'],
                      ['byDepartment', 'Departments'],
                    ] as const
                  ).map(([side, label]) => (
                    <button
                      key={side}
                      type="button"
                      role="tab"
                      aria-selected={mappingSide === side}
                      onClick={() => setMappingSide(side)}
                      className={cn(
                        'rounded-md px-2.5 py-1 font-medium transition-colors',
                        mappingSide === side ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            }
          >
            {mappingSide === 'byProject' ? (
              <MappingPanel
                noun="projects"
                records={projects}
                map={value.maps.byProject}
                registrations={registrations}
                canEdit={canEdit}
                isLoading={isListLoading}
                onChange={(id, registrationId) => setMapEntry('byProject', id, registrationId)}
                onBulk={(ids, registrationId) => setMapBulk('byProject', ids, registrationId)}
              />
            ) : (
              <MappingPanel
                noun="departments"
                records={departments}
                map={value.maps.byDepartment}
                registrations={registrations}
                canEdit={canEdit}
                isLoading={isListLoading}
                onChange={(id, registrationId) => setMapEntry('byDepartment', id, registrationId)}
                onBulk={(ids, registrationId) => setMapBulk('byDepartment', ids, registrationId)}
              />
            )}
          </ControlCard>
        </TabsContent>

        {/* ── TDS ── */}
        <TabsContent value="tds" className="mt-3">
          <ControlCard
            icon={ReceiptIndianRupee}
            title="TDS"
            description="Whether TDS is totalled for the company as a whole or per registration."
            className="max-w-3xl"
          >
            <RadioGroup
              className="gap-0 divide-y"
              value={value.attribution.tdsGrouping}
              disabled={!canEdit}
              onValueChange={grouping => setAttribution({ tdsGrouping: grouping as TdsGrouping })}
            >
              {(
                [
                  {
                    id: 'company' as TdsGrouping,
                    title: 'One TAN for the whole company',
                    hint: 'Every deduction is filed under the company’s single TAN, whichever state the bill belongs to.',
                  },
                  {
                    id: 'registration' as TdsGrouping,
                    title: 'A separate TAN per registration',
                    hint: 'Each state files its own TDS return, under the TAN recorded on its registration.',
                  },
                ] as const
              ).map(choice => (
                <label
                  key={choice.id}
                  htmlFor={`tds-${choice.id}`}
                  className="flex cursor-pointer items-start gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <RadioGroupItem value={choice.id} id={`tds-${choice.id}`} className="mt-0.5" disabled={!canEdit} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">{choice.title}</p>
                    <p className="text-[11px] text-muted-foreground">{choice.hint}</p>
                  </div>
                </label>
              ))}
            </RadioGroup>
            {value.attribution.tdsGrouping === 'registration' && (
              <div
                className={cn(
                  'mt-3 flex items-start gap-2 rounded-xl border p-3 text-[11px]',
                  missingTan.length > 0
                    ? 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400'
                    : 'border-emerald-200 bg-emerald-50/60 text-emerald-800',
                )}
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {missingTan.length > 0 ? (
                    <>
                      Per-registration grouping needs a TAN on every registration.{' '}
                      {missingTan.map(registration => registrationLabel(registration)).join(', ')}{' '}
                      {missingTan.length === 1 ? 'has none' : 'have none'} — their TDS will be reported without one.
                    </>
                  ) : (
                    'Every active registration has a TAN, so each state can file its own return.'
                  )}
                </span>
              </div>
            )}
          </ControlCard>
        </TabsContent>
      </Tabs>

      {/* ── save ── */}
      {canEdit && (
        <div className="sticky bottom-0 z-10 rounded-t-xl border border-b-0 bg-background/95 px-4 py-3 shadow-[0_-8px_24px_-20px_rgba(15,23,42,0.5)] backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <span
                className={cn(
                  'h-2 w-2 shrink-0 rounded-full',
                  isDirty ? (blocked ? 'bg-destructive' : 'bg-amber-500') : 'bg-emerald-500',
                )}
              />
              {blocked ? 'Fix the errors above before saving.' : isDirty ? 'Unsaved changes.' : 'All changes saved.'}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {isDirty ? (
                <Button type="button" variant="outline" size="sm" disabled={isSaving} onClick={discard}>
                  Discard
                </Button>
              ) : (
                <Button asChild variant="outline" size="sm">
                  <Link href="/expenses/settings">Back to settings</Link>
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                className="min-w-[110px] gap-2"
                disabled={!isDirty || blocked || isSaving}
                onClick={handleSave}
              >
                {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {isSaving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
