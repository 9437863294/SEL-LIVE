'use client';

/**
 * Daily Requisition › Settings › Printing Setup: how the payment checklist prints.
 *
 * Settings on the left — page, margins, letterhead and title, what to print, footer and watermark —
 * and on the right a live preview: the checklist print page's own sheet
 * (src/components/daily-requisition/checklist-sheet.tsx) on a sample requisition, at the chosen
 * paper size, so what you see is what prints. "Print test page" prints that sample with the
 * settings as they stand, saved or not. Stored in `settings/printing`
 * (src/lib/daily-requisition-print.ts), which the print page reads.
 */

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import {
  AlignCenter,
  AlignLeft,
  ArrowLeft,
  Check,
  FileText,
  Frame,
  Heading,
  ListChecks,
  Loader2,
  PanelBottom,
  Printer,
  RotateCcw,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { PageHeader } from '@/components/shared/page-header';
import { dailyPageContainerClass, dailySurfaceCardClass } from '@/components/daily-requisition/module-shell';
import {
  ChecklistSheet,
  SAMPLE_EXPENSE_HEADS,
  SAMPLE_PROJECT_NAME,
  sampleChecklistEntry,
} from '@/components/daily-requisition/checklist-sheet';
import { Segmented } from '@/components/daily-requisition/workflow-editor-parts';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useCompanyProfile } from '@/hooks/use-company-profile';
import { useToast } from '@/hooks/use-toast';
import { diffFields } from '@/lib/activity-logger';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import {
  DEFAULT_DOCUMENT_TITLE,
  DEFAULT_SIGNATURE_LABELS,
  defaultPrintSettings,
  flattenPrintSettings,
  fromMm,
  marginsMm,
  PAPER_SIZES,
  PRINT_DRAFT_STORAGE_KEY,
  PRINT_SETTINGS_DOC,
  PRINTER_SAFE_MM,
  pageSizeMm,
  printableArea,
  resolvePrintSettings,
  type DRPrintSettings,
  type MarginUnit,
  type PaperSize,
  type PrintSections,
} from '@/lib/daily-requisition-print';
import { db } from '@/lib/firebase';
import { cn } from '@/lib/utils';

const PX_PER_MM = 96 / 25.4;

/** Margin presets, in millimetres. */
const MARGIN_PRESETS: Array<{ key: string; label: string; mm: { top: number; right: number; bottom: number; left: number } }> = [
  { key: 'narrow', label: 'Narrow', mm: { top: 10, right: 10, bottom: 10, left: 10 } },
  { key: 'normal', label: 'Normal', mm: { top: 14, right: 14, bottom: 14, left: 14 } },
  { key: 'wide', label: 'Wide', mm: { top: 25, right: 25, bottom: 25, left: 25 } },
  { key: 'punch', label: 'Punch-hole (left 25 mm)', mm: { top: 14, right: 14, bottom: 14, left: 25 } },
];

const SECTION_TOGGLES: Array<{ key: keyof PrintSections; title: string; hint: string }> = [
  { key: 'details', title: 'Reception & project', hint: 'Reception No and date, DEP No, project' },
  { key: 'amounts', title: 'Party & amounts', hint: 'Party name, gross and net amount' },
  { key: 'accounts', title: 'Head of account', hint: 'Head and sub-head of A/c' },
  { key: 'description', title: 'Description', hint: 'What the requisition is for' },
  { key: 'amountInWords', title: 'Amount in words', hint: 'Net amount, Indian numbering' },
  { key: 'trail', title: 'Trail', hint: 'Received, verified, handed over, paid — who and when' },
  { key: 'signatures', title: 'Signature blocks', hint: 'Lines to sign under' },
];

function SettingsCard({ icon: Icon, from, to, title, description, aside, children }: { icon: LucideIcon; from: string; to: string; title: string; description: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-3.5 rounded-[20px] border bg-card">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3.5 sm:px-[18px]">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] text-white" style={{ background: `linear-gradient(145deg, ${from}, ${to})` }}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <b className="block text-[14.5px] leading-tight">{title}</b>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        {aside ? <div className="ml-auto">{aside}</div> : null}
      </header>
      <div className="px-4 py-4 sm:px-[18px]">{children}</div>
    </section>
  );
}

function Lbl({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[11.5px] font-bold text-slate-600">
      {children}
    </label>
  );
}

function ToggleTile({ title, hint, checked, onChange, disabled }: { title: string; hint: string; checked: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 transition hover:border-slate-300',
        checked && 'border-violet-200 bg-violet-50/40',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <span className="min-w-0">
        <b className="block text-[12.5px] leading-tight">{title}</b>
        <small className="text-[11px] text-muted-foreground">{hint}</small>
      </span>
      <Switch className="ml-auto" checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </label>
  );
}

const inputClass =
  'w-full rounded-[11px] border bg-card px-2.5 py-2 text-sm outline-none focus:border-violet-400 focus:ring-[3px] focus:ring-violet-500/10 disabled:opacity-60';

export default function PrintingSetupPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { profile } = useCompanyProfile();
  // The Settings page's "Printing Setup" card is gated on this, and so is the menu entry.
  const canViewPage = can('View', 'Daily Requisition.Settings');
  // Any of the module's settings-edit rights unlocks saving; everyone else sees the setup read-only.
  const canEdit =
    can('Edit Serial Nos', 'Daily Requisition.Settings') ||
    can('Edit Workflow', 'Daily Requisition.Settings') ||
    can('Edit User Rights', 'Daily Requisition.Settings') ||
    can('Edit', 'Daily Requisition.Data Control');
  const { log } = useActivityLogger(ACTIVITY_MODULES.DAILY_REQUISITION);

  const [settings, setSettings] = useState<DRPrintSettings>(defaultPrintSettings);
  // What is stored (null when the document does not exist yet): the audit log's "before" and what Discard returns to.
  const [saved, setSaved] = useState<DRPrintSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [linked, setLinked] = useState(true);
  const [zoom, setZoom] = useState<'0.8' | '1' | '1.25'>('1');
  const [stageWidth, setStageWidth] = useState(460);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isAuthLoading || !canViewPage) return;
    let active = true;
    getDoc(doc(db, PRINT_SETTINGS_DOC.collection, PRINT_SETTINGS_DOC.doc))
      .then((snap) => {
        if (!active) return;
        const stored = snap.exists() ? resolvePrintSettings(snap.data()) : null;
        setSaved(stored);
        setSettings(stored ?? defaultPrintSettings());
        if (stored) {
          const m = marginsMm(stored);
          setLinked(m.top === m.bottom && m.top === m.left && m.top === m.right);
        }
      })
      .catch(() => active && toast({ title: 'Error', description: 'Failed to load printing settings.', variant: 'destructive' }))
      .finally(() => active && setIsLoading(false));
    return () => {
      active = false;
    };
  }, [isAuthLoading, canViewPage, toast]);

  // The preview fits the column it is in.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setStageWidth(Math.max(240, entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [isLoading]);

  const baseline = saved ?? defaultPrintSettings();
  const isDirty = JSON.stringify(settings) !== JSON.stringify(baseline);
  const disabled = !canEdit;
  const set = (patch: Partial<DRPrintSettings>) => setSettings((prev) => ({ ...prev, ...patch }));
  const setSection = (key: keyof PrintSections, on: boolean) => setSettings((prev) => ({ ...prev, sections: { ...prev.sections, [key]: on } }));

  const m = marginsMm(settings);
  const page = pageSizeMm(settings);
  const area = printableArea(settings);
  const activePreset = MARGIN_PRESETS.find((p) => (['top', 'right', 'bottom', 'left'] as const).every((side) => Math.abs(p.mm[side] - m[side]) < 0.05))?.key;

  const setMarginsMm = (next: { top: number; right: number; bottom: number; left: number }) =>
    set({
      margins: {
        top: fromMm(next.top, settings.marginUnit),
        right: fromMm(next.right, settings.marginUnit),
        bottom: fromMm(next.bottom, settings.marginUnit),
        left: fromMm(next.left, settings.marginUnit),
      },
    });
  const setSide = (side: 'top' | 'right' | 'bottom' | 'left', value: string) =>
    setSettings((prev) =>
      linked
        ? { ...prev, margins: { top: value, right: value, bottom: value, left: value } }
        : { ...prev, margins: { ...prev.margins, [side]: value } },
    );
  // Changing the unit converts what is there, so the margins themselves do not move.
  const setUnit = (unit: MarginUnit) =>
    setSettings((prev) => {
      const now = marginsMm(prev);
      return {
        ...prev,
        marginUnit: unit,
        margins: { top: fromMm(now.top, unit), right: fromMm(now.right, unit), bottom: fromMm(now.bottom, unit), left: fromMm(now.left, unit) },
      };
    });

  const handleSave = async () => {
    if (!canEdit || !user) return;
    setIsSaving(true);
    try {
      await setDoc(doc(db, PRINT_SETTINGS_DOC.collection, PRINT_SETTINGS_DOC.doc), settings);
      const changes = diffFields(flattenPrintSettings(saved) ?? {}, flattenPrintSettings(settings) ?? {});
      void log(
        'Update Daily Requisition Printing Setup',
        { settingsDoc: 'settings/printing', created: saved === null, changedCount: Object.keys(changes).length, changes },
        { recordRef: 'Printing Setup' },
      );
      setSaved(settings);
      toast({ title: 'Print settings saved', description: 'Checklists print this way from now on.' });
    } catch {
      toast({ title: 'Error', description: 'Failed to save settings.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  /** The sample, printed by the checklist print page with the settings as they stand now. */
  const printTestPage = () => {
    try {
      window.localStorage.setItem(PRINT_DRAFT_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Storage refused: the test page prints with the saved settings instead.
    }
    window.open('/daily-requisition/entry-sheet/print?sample=1', '_blank');
  };

  /* ---- preview geometry ---- */
  const sample = useMemo(() => sampleChecklistEntry(), []);
  const pageW = page.width * PX_PER_MM;
  const pageH = page.height * PX_PER_MM;
  const fit = Math.min((stageWidth - 44) / pageW, 640 / pageH);
  const scale = fit * Number(zoom);

  /* ---------------- render ---------------- */
  if (isAuthLoading || (isLoading && canViewPage)) {
    return (
      <div className={cn(dailyPageContainerClass, 'mx-auto max-w-[1500px]')}>
        <Skeleton className="mb-6 h-12 w-80" />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_520px]">
          <div className="space-y-3.5">
            <Skeleton className="h-44 rounded-[20px]" />
            <Skeleton className="h-64 rounded-[20px]" />
          </div>
          <Skeleton className="h-[680px] rounded-[20px]" />
        </div>
      </div>
    );
  }

  if (!canViewPage) {
    return (
      <div className={cn(dailyPageContainerClass, 'mx-auto max-w-5xl')}>
        <PageHeader eyebrow="Daily Requisition" title="Printing Setup" description="How the payment checklist prints." backHref="/daily-requisition/settings" />
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

  return (
    <div className={cn(dailyPageContainerClass, 'mx-auto max-w-[1500px] pb-28')}>
      {/* Where this is */}
      <nav className="mb-3.5 flex items-center gap-2 text-[12.5px] font-semibold text-muted-foreground" aria-label="Breadcrumb">
        <Link href="/daily-requisition/settings" className="mr-1 grid h-[30px] w-[30px] place-items-center rounded-[9px] border bg-card text-foreground/70 hover:text-foreground" aria-label="Back to settings">
          <ArrowLeft className="h-[15px] w-[15px]" />
        </Link>
        <Link href="/daily-requisition" className="text-foreground/70 hover:underline">
          Daily Requisition
        </Link>
        <span aria-hidden>›</span>
        <Link href="/daily-requisition/settings" className="text-foreground/70 hover:underline">
          Settings
        </Link>
        <span aria-hidden>›</span>
        <span className="text-foreground">Printing Setup</span>
      </nav>

      <div className="mb-4 flex flex-wrap items-center gap-3.5">
        <span
          className="grid h-[50px] w-[50px] shrink-0 place-items-center rounded-[15px] text-white shadow-[0_6px_14px_-5px_rgba(234,88,12,0.6),inset_0_1px_0_#ffffff45]"
          style={{ background: 'linear-gradient(145deg, #fdba74, #ea580c)' }}
        >
          <Printer className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <h1 className="text-[22px] font-extrabold">Printing Setup</h1>
          <p className="text-[12.5px] text-muted-foreground">Page, margins, letterhead, content and footer for the printed payment checklist, with a live preview</p>
        </div>
        <span className="flex-1" />
        <span className="text-[11.5px] font-bold text-slate-600">Applies to</span>
        <span className="rounded-xl bg-slate-900 px-3 py-1.5 text-[12.5px] font-semibold text-white">Payment checklist</span>
        {!canEdit && <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11.5px] font-bold text-muted-foreground">Read-only</span>}
        {!saved && <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11.5px] font-bold text-amber-800">Using the defaults</span>}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_520px]">
        <div>
          {/* Page */}
          <SettingsCard icon={FileText} from="#93c5fd" to="#1d4ed8" title="Page" description="Paper size, orientation, copies and type size">
            <Lbl>Paper size</Lbl>
            <div className="flex flex-wrap gap-2.5">
              {(Object.keys(PAPER_SIZES) as PaperSize[]).map((key) => {
                const paper = PAPER_SIZES[key];
                const on = settings.paperSize === key;
                const [w, h] = settings.orientation === 'portrait' ? [paper.width / 14, paper.height / 14] : [paper.height / 14, paper.width / 14];
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={disabled}
                    onClick={() => set({ paperSize: key })}
                    className={cn(
                      'flex min-w-[120px] items-center gap-2.5 rounded-[14px] border px-3 py-2.5 text-left transition hover:border-violet-300 disabled:cursor-not-allowed',
                      on && 'border-violet-600 bg-violet-50 ring-[3px] ring-violet-600/10',
                    )}
                  >
                    <span className={cn('shrink-0 rounded-[3px] border-[1.5px] bg-white', on ? 'border-violet-600' : 'border-slate-300')} style={{ width: w, height: h }} />
                    <span>
                      <b className="block text-[13px]">{paper.label}</b>
                      <small className="text-[11px] text-muted-foreground">{paper.note}</small>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3.5 grid gap-3 md:grid-cols-3">
              <div>
                <Lbl>Orientation</Lbl>
                <Segmented
                  value={settings.orientation}
                  disabled={disabled}
                  onChange={(orientation) => set({ orientation })}
                  options={[
                    { value: 'portrait', label: 'Portrait' },
                    { value: 'landscape', label: 'Landscape' },
                  ]}
                />
              </div>
              <div>
                <Lbl>Copies per print</Lbl>
                <Segmented
                  value={String(settings.copies) as '1' | '2' | '3'}
                  disabled={disabled}
                  onChange={(v) => set({ copies: Number(v) as 1 | 2 | 3 })}
                  options={[
                    { value: '1', label: '1' },
                    { value: '2', label: '2 (office + site)' },
                    { value: '3', label: '3' },
                  ]}
                />
              </div>
              <div>
                <Lbl>Type size</Lbl>
                <Segmented
                  value={settings.fontScale}
                  disabled={disabled}
                  onChange={(fontScale) => set({ fontScale })}
                  options={[
                    { value: 'small', label: 'Small' },
                    { value: 'normal', label: 'Normal' },
                    { value: 'large', label: 'Large' },
                  ]}
                />
              </div>
            </div>
          </SettingsCard>

          {/* Margins */}
          <SettingsCard
            icon={Frame}
            from="#c4b5fd"
            to="#6d28d9"
            title="Margins"
            description="Space around the printed content"
            aside={
              <Segmented
                value={settings.marginUnit}
                disabled={disabled}
                onChange={setUnit}
                options={[
                  { value: 'mm', label: 'mm' },
                  { value: 'cm', label: 'cm' },
                  { value: 'in', label: 'in' },
                ]}
              />
            }
          >
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11.5px] font-bold text-slate-600">Presets:</span>
              {MARGIN_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setMarginsMm(preset.mm);
                    if (preset.key === 'punch') setLinked(false);
                  }}
                  className={cn(
                    'rounded-full border bg-card px-3 py-1 text-xs font-bold text-muted-foreground',
                    activePreset === preset.key && 'border-violet-400 bg-violet-50 text-violet-700',
                  )}
                >
                  {preset.label}
                </button>
              ))}
              <label className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                <input type="checkbox" checked={linked} disabled={disabled} onChange={(e) => setLinked(e.target.checked)} className="accent-violet-600" />
                Keep all sides equal
              </label>
            </div>
            <div className="grid max-w-[460px] grid-cols-[90px_minmax(0,1fr)_90px] grid-rows-[auto_1fr_auto] items-center justify-items-center gap-2">
              {(['top', 'left', 'right', 'bottom'] as const).map((side) => (
                <div
                  key={side}
                  className={cn(
                    'flex items-center gap-1',
                    side === 'top' && 'col-start-2 row-start-1',
                    side === 'bottom' && 'col-start-2 row-start-3',
                    side === 'left' && 'col-start-1 row-start-2',
                    side === 'right' && 'col-start-3 row-start-2',
                  )}
                >
                  <input
                    type="number"
                    min={0}
                    step={settings.marginUnit === 'mm' ? 1 : 0.1}
                    aria-label={`${side} margin`}
                    value={settings.margins[side]}
                    disabled={disabled}
                    onChange={(e) => setSide(side, e.target.value)}
                    className="w-[62px] rounded-[11px] border bg-card px-1.5 py-1.5 text-center text-sm font-bold outline-none focus:border-violet-400"
                  />
                  <small className="text-[11px] font-bold text-muted-foreground">{settings.marginUnit}</small>
                </div>
              ))}
              <div className="relative col-start-2 row-start-2 w-full rounded-md border-[1.5px] border-slate-300 bg-white" style={{ aspectRatio: `${page.width} / ${page.height}`, maxHeight: 190 }}>
                <div
                  className="absolute rounded-[3px] border-[1.5px] border-dashed border-violet-400 transition-all"
                  style={{
                    left: `${(m.left / page.width) * 100}%`,
                    right: `${(m.right / page.width) * 100}%`,
                    top: `${(m.top / page.height) * 100}%`,
                    bottom: `${(m.bottom / page.height) * 100}%`,
                    background: 'repeating-linear-gradient(135deg, #ede9fe 0 6px, #f5f3ff 6px 12px)',
                  }}
                />
              </div>
            </div>
            <p className="mt-2 text-[11.5px] text-muted-foreground">
              Printable area {(area.width / 10).toFixed(1)} × {(area.height / 10).toFixed(1)} cm ({Math.round(area.share * 100)}% of the page).
              {Math.min(m.top, m.right, m.bottom, m.left) < PRINTER_SAFE_MM && (
                <span className="font-semibold text-amber-700"> Most office printers cannot print closer than {PRINTER_SAFE_MM} mm to the edge.</span>
              )}
            </p>
          </SettingsCard>

          {/* Letterhead & title */}
          <SettingsCard icon={Heading} from="#fb7185" to="#be123c" title="Header" description="The letterhead and the document's title">
            <div className="grid gap-3.5 md:grid-cols-2">
              <div>
                <Lbl>Letterhead</Lbl>
                <div className="flex items-center gap-3 rounded-xl border-[1.5px] border-dashed border-slate-300 px-3 py-2">
                  <span className="grid h-[34px] w-[52px] shrink-0 place-items-center overflow-hidden rounded-md border bg-white">
                    {profile.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={profile.logoUrl} alt={profile.shortName} className="max-h-full max-w-full object-contain" />
                    ) : (
                      <b className="text-[13px] font-black italic text-rose-700">{profile.shortName || 'Logo'}</b>
                    )}
                  </span>
                  <div className="min-w-0">
                    <b className="block truncate text-[12.5px]">{profile.legalName}</b>
                    <small className="block text-[11.5px] text-muted-foreground">Name, address and logo from Company Profile</small>
                  </div>
                  <Link href="/settings/company-profile" className="ml-auto shrink-0 rounded-lg border px-2.5 py-1 text-xs font-semibold hover:bg-muted">
                    Change
                  </Link>
                </div>
              </div>
              <div>
                <Lbl>Alignment</Lbl>
                <Segmented
                  value={settings.letterheadAlign}
                  disabled={disabled}
                  onChange={(letterheadAlign) => set({ letterheadAlign })}
                  options={[
                    { value: 'profile', label: 'As Company Profile' },
                    { value: 'left', label: 'Logo left', icon: AlignLeft },
                    { value: 'center', label: 'Centred', icon: AlignCenter },
                  ]}
                />
              </div>
            </div>
            <div className="mt-3">
              <Lbl htmlFor="doc-title">Document title</Lbl>
              <input
                id="doc-title"
                className={inputClass}
                value={settings.documentTitle}
                disabled={disabled}
                maxLength={80}
                placeholder={DEFAULT_DOCUMENT_TITLE}
                onChange={(e) => set({ documentTitle: e.target.value })}
              />
            </div>
          </SettingsCard>

          {/* What to print */}
          <SettingsCard icon={ListChecks} from="#86efac" to="#15803d" title="What to print" description="Turn sections of the checklist on or off">
            <div className="grid gap-2 md:grid-cols-2">
              {SECTION_TOGGLES.map((toggle) => (
                <ToggleTile
                  key={toggle.key}
                  title={toggle.title}
                  hint={toggle.hint}
                  checked={settings.sections[toggle.key]}
                  disabled={disabled}
                  onChange={(on) => setSection(toggle.key, on)}
                />
              ))}
            </div>
            {settings.sections.signatures && (
              <div className="mt-3">
                <Lbl htmlFor="sig-labels">Signature captions — separated by commas, up to 8</Lbl>
                <input
                  id="sig-labels"
                  className={inputClass}
                  disabled={disabled}
                  placeholder={DEFAULT_SIGNATURE_LABELS.join(', ')}
                  value={settings.signatureLabels.join(', ')}
                  onChange={(e) =>
                    set({
                      signatureLabels: e.target.value
                        .split(',')
                        .map((label) => label.trimStart())
                        .filter((label, i, all) => label !== '' || i === all.length - 1)
                        .slice(0, 8),
                    })
                  }
                  onBlur={() => set({ signatureLabels: settings.signatureLabels.map((l) => l.trim()).filter(Boolean) })}
                />
                <p className="mt-1 text-[11.5px] text-muted-foreground">Leave empty for the usual six.</p>
              </div>
            )}
          </SettingsCard>

          {/* Footer & watermark */}
          <SettingsCard icon={PanelBottom} from="#fcd34d" to="#d97706" title="Footer & watermark" description="Print stamp, sheet numbers, a note, and a watermark">
            <div className="grid gap-2 md:grid-cols-2">
              <ToggleTile
                title="Printed by & time"
                hint="Who printed it, and when"
                checked={settings.footer.printedBy}
                disabled={disabled}
                onChange={(on) => set({ footer: { ...settings.footer, printedBy: on } })}
              />
              <ToggleTile
                title="Sheet numbers"
                hint={'"Sheet 1 of 4" across a batch'}
                checked={settings.footer.sheetNumbers}
                disabled={disabled}
                onChange={(on) => set({ footer: { ...settings.footer, sheetNumbers: on } })}
              />
            </div>
            <div className="mt-3 grid gap-3.5 md:grid-cols-2">
              <div>
                <Lbl htmlFor="foot-note">Footer note</Lbl>
                <input
                  id="foot-note"
                  className={inputClass}
                  disabled={disabled}
                  maxLength={140}
                  placeholder="e.g. This is a system-generated document."
                  value={settings.footer.note}
                  onChange={(e) => set({ footer: { ...settings.footer, note: e.target.value } })}
                />
              </div>
              <div>
                <Lbl>Watermark</Lbl>
                <Segmented
                  value={settings.watermark}
                  disabled={disabled}
                  onChange={(watermark) => set({ watermark })}
                  options={[
                    { value: 'none', label: 'None' },
                    { value: 'status', label: 'By status' },
                    { value: 'copy', label: 'Always "COPY"' },
                  ]}
                />
                <p className="mt-1 text-[11.5px] text-muted-foreground">By status: DRAFT until GST &amp; TDS verified, PAID once paid, CANCELLED if cancelled.</p>
              </div>
            </div>
          </SettingsCard>
        </div>

        {/* Live preview */}
        <aside className="xl:sticky xl:top-4">
          <div className="mb-2.5 flex items-center gap-2">
            <b className="text-sm">Live preview</b>
            <span className="text-xs text-muted-foreground">
              · {PAPER_SIZES[settings.paperSize].label} {settings.orientation} · {settings.copies} {settings.copies === 1 ? 'copy' : 'copies'}
            </span>
            <span className="flex-1" />
            <Segmented
              value={zoom}
              onChange={setZoom}
              options={[
                { value: '0.8', label: '80%' },
                { value: '1', label: 'Fit' },
                { value: '1.25', label: '125%' },
              ]}
            />
          </div>
          <div
            ref={stageRef}
            className="grid min-h-[680px] place-items-center overflow-auto rounded-[20px] border p-[22px]"
            style={{ background: 'repeating-conic-gradient(#eef0f4 0 25%, #f6f7f9 0 50%) 0 0 / 18px 18px' }}
          >
            <div
              className="relative overflow-hidden bg-white shadow-[0_30px_60px_-30px_rgba(15,23,42,0.53),0_0_0_1px_rgba(15,23,42,0.06)] transition-[width,height] duration-200"
              style={{ width: pageW * scale, height: pageH * scale }}
            >
              <div
                className="keep-light absolute left-0 top-0 origin-top-left text-black"
                style={{
                  width: pageW,
                  height: pageH,
                  padding: `${m.top * PX_PER_MM}px ${m.right * PX_PER_MM}px ${m.bottom * PX_PER_MM}px ${m.left * PX_PER_MM}px`,
                  transform: `scale(${scale})`,
                }}
              >
                {/* The margins, as a guide */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute border border-dashed border-violet-400/40"
                  style={{ left: m.left * PX_PER_MM, right: m.right * PX_PER_MM, top: m.top * PX_PER_MM, bottom: m.bottom * PX_PER_MM }}
                />
                <ChecklistSheet
                  entry={sample}
                  projectName={SAMPLE_PROJECT_NAME}
                  expenseRequest={SAMPLE_EXPENSE_HEADS}
                  printedBy={user?.name || 'You'}
                  printedAt="05 Nov 2026 11:42"
                  settings={settings}
                  sheet={{ index: 0, total: settings.copies }}
                  nameOf={() => 'A. Receiver'}
                />
              </div>
              <span className="absolute left-1/2 -translate-x-1/2 rounded bg-white px-1 text-[9px] font-extrabold text-violet-700" style={{ top: Math.max(2, (m.top * PX_PER_MM * scale) / 2 - 7) }}>
                {settings.margins.top} {settings.marginUnit}
              </span>
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button variant="outline" className="flex-1" onClick={printTestPage}>
              <Printer className="mr-1.5 h-4 w-4" /> Print test page
            </Button>
            <Button variant="outline" className="flex-1" disabled={disabled} onClick={() => setSettings({ ...defaultPrintSettings(), headerText: settings.headerText })}>
              <RotateCcw className="mr-1.5 h-4 w-4" /> Reset to default
            </Button>
          </div>
          <p className="mt-2 text-[11.5px] text-muted-foreground">
            The preview uses a sample requisition. The test page prints it with the settings above, saved or not; use your browser&apos;s
            print dialog to save it as a PDF.
          </p>
        </aside>
      </div>

      {/* Unsaved changes */}
      <div
        className={cn(
          'fixed bottom-4 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-2xl bg-slate-900 py-2 pl-4 pr-2 text-sm text-white shadow-[0_20px_50px_-10px_rgba(15,23,42,0.53)] transition-all duration-200',
          isDirty && canEdit ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-[150%] opacity-0',
        )}
        role="status"
      >
        <span>Unsaved print settings</span>
        <Button
          variant="outline"
          size="sm"
          className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
          onClick={() => setSettings(baseline)}
          disabled={isSaving}
        >
          Discard
        </Button>
        <Button size="sm" className="bg-white text-slate-900 hover:bg-white/90" onClick={handleSave} disabled={isSaving}>
          {isSaving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
          Save settings
        </Button>
      </div>
    </div>
  );
}
