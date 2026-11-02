'use client';

/**
 * Company Profile › Letterhead: how the head and foot of every document look. Standard builds the
 * letterhead from the company details, with a choice of arrangement, colour and line; Designed
 * prints a header and footer laid out in the Word-like editor (letterhead-designer.tsx).
 *
 * The small sketches on each option are drawn in the chosen accent colour, so a choice can be read
 * without the preview open.
 */

import { useState, type CSSProperties, type ReactNode } from 'react';
import { Check, LayoutTemplate, ListChecks, Paintbrush, PanelBottom, PanelTop, RotateCcw, Ruler, Stamp, StickyNote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChoiceGroup } from '@/components/appearance/controls';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { LetterheadHtmlEditor } from '@/components/shared/letterhead-designer';
import { SettingsNotice, SettingsSection, SwitchRow } from '@/components/settings/settings-ui';
import {
  DEFAULT_COMPANY_DESIGN,
  DEFAULT_CUSTOM_LETTERHEAD,
  type CompanyDesign,
  type CustomLetterhead,
  type LetterheadDivider,
  type LetterheadLayout,
  type LetterheadMode,
  type LetterheadTitleSize,
} from '@/lib/company-profile';
import type { ProfileIssue } from '@/lib/company-profile-checks';
import { cn } from '@/lib/utils';
import { INVALID_CONTROL, ProfileColumns, ProfileField, controlProps } from './profile-parts';

type Letterhead = CompanyDesign['letterhead'];

const HEX = /^#[0-9a-f]{6}$/i;

/** Dark enough to print well on white; the first is the standard letterhead's own. */
const ACCENTS = [
  { value: '#1e293b', name: 'Slate' },
  { value: '#1e3a8a', name: 'Navy' },
  { value: '#1d4ed8', name: 'Blue' },
  { value: '#0f766e', name: 'Teal' },
  { value: '#166534', name: 'Green' },
  { value: '#9f1239', name: 'Maroon' },
  { value: '#9a3412', name: 'Rust' },
  { value: '#6b21a8', name: 'Purple' },
  { value: '#000000', name: 'Black' },
];

const WATERMARKS = ['CONFIDENTIAL', 'DRAFT', 'COPY'];

/* ── sketches: spans only, as they sit inside each option's button ─────────────────────────────── */

function Paper({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('keep-light flex h-14 w-full rounded-md border border-slate-200 bg-white p-2', className)}>{children}</span>;
}

function Bar({ width, color, thick }: { width: string; color?: string; thick?: boolean }) {
  return <span className={cn('block shrink-0 rounded-full', thick ? 'h-1.5' : 'h-1', !color && 'bg-slate-200')} style={{ width, backgroundColor: color }} />;
}

function LogoMark({ small }: { small?: boolean }) {
  return <span className={cn('block shrink-0 rounded-sm bg-slate-300', small ? 'h-2.5 w-2.5' : 'h-5 w-5')} />;
}

function ModeSketch({ mode, accent }: { mode: LetterheadMode; accent: string }) {
  if (mode === 'standard') {
    return (
      <Paper className="h-16 flex-col justify-center">
        <span className="flex w-full flex-col items-center gap-1 pb-1.5" style={{ borderBottom: `1px solid ${accent}` }}>
          <Bar width="50%" color={accent} thick />
          <Bar width="72%" />
          <Bar width="40%" />
        </span>
      </Paper>
    );
  }
  return (
    <Paper className="h-16 items-start gap-2">
      <LogoMark />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        {/* A merge field, drawn like the editor's blue chips. */}
        <span className="w-fit rounded bg-sky-100 px-1 text-[8px] font-semibold leading-3 text-sky-800 ring-1 ring-sky-300">Legal name</span>
        <Bar width="78%" />
        <span className="flex gap-1">
          <span className="h-2.5 flex-1 rounded-sm border border-slate-300" />
          <span className="h-2.5 flex-1 rounded-sm border border-slate-300" />
        </span>
      </span>
    </Paper>
  );
}

function LayoutSketch({ layout, accent }: { layout: LetterheadLayout; accent: string }) {
  if (layout === 'center') {
    return (
      <Paper className="flex-col items-center justify-center gap-1">
        <LogoMark small />
        <Bar width="58%" color={accent} thick />
        <Bar width="78%" />
        <Bar width="46%" />
      </Paper>
    );
  }
  if (layout === 'left') {
    return (
      <Paper className="items-center gap-2">
        <LogoMark />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <Bar width="70%" color={accent} thick />
          <Bar width="92%" />
          <Bar width="55%" />
        </span>
      </Paper>
    );
  }
  return (
    <Paper className="items-center justify-between gap-3">
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <Bar width="85%" color={accent} thick />
        <Bar width="55%" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col items-end gap-1">
        <Bar width="90%" />
        <Bar width="72%" />
        <Bar width="60%" />
      </span>
    </Paper>
  );
}

const NAME_PX: Record<LetterheadTitleSize, number> = { sm: 13, md: 17, lg: 21 };

function SizeSketch({ size, accent }: { size: LetterheadTitleSize; accent: string }) {
  return (
    <Paper className="h-10 items-center justify-center p-1">
      <span className="font-extrabold leading-none tracking-wide" style={{ color: accent, fontSize: NAME_PX[size] }}>Aa</span>
    </Paper>
  );
}

function DividerSketch({ divider, accent }: { divider: LetterheadDivider; accent: string }) {
  const line: Record<LetterheadDivider, CSSProperties> = {
    none: {},
    line: { borderBottom: `1px solid ${accent}` },
    double: { borderBottom: `3px double ${accent}` },
    bar: { borderBottom: `4px solid ${accent}` },
  };
  return (
    <Paper className="h-10 flex-col justify-center px-2.5 py-1">
      <span className="flex flex-col items-center gap-1 pb-1" style={line[divider]}>
        <Bar width="50%" color={accent} thick />
        <Bar width="70%" />
      </span>
    </Paper>
  );
}

/* ── fields ─────────────────────────────────────────────────────────────────────────────────────── */

/** Swatches that print well, any colour from the picker, and the code itself. */
function AccentField({ value, issue, readOnly, onChange }: { value: string; issue?: ProfileIssue; readOnly: boolean; onChange: (value: string) => void }) {
  const current = value.trim().toLowerCase();
  const pickerValue = HEX.test(current) ? current : DEFAULT_COMPANY_DESIGN.letterhead.accentColor;
  return (
    <ProfileField field="accentColor" label="Accent colour" issue={issue} hint="The company name and the line under the header.">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Suggested colours">
          {ACCENTS.map((accent) => {
            const selected = current === accent.value;
            return (
              <button
                key={accent.value}
                type="button"
                aria-pressed={selected}
                aria-label={`${accent.name}, ${accent.value}`}
                title={accent.name}
                disabled={readOnly}
                onClick={() => onChange(accent.value)}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full border-2 border-background shadow-sm ring-1 ring-border transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 motion-safe:hover:scale-110',
                  selected && 'ring-2 ring-primary',
                )}
                style={{ backgroundColor: accent.value }}
              >
                {selected && <Check className="h-4 w-4 text-white" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
        <span className="mx-0.5 h-6 w-px bg-border" aria-hidden="true" />
        <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full border-2 border-background shadow-sm ring-1 ring-border" title="Any colour">
          <span className="absolute inset-0" style={{ background: 'conic-gradient(#ef4444, #eab308, #22c55e, #06b6d4, #3b82f6, #a855f7, #ef4444)' }} aria-hidden="true" />
          <input
            type="color"
            aria-label="Pick any colour"
            value={pickerValue}
            disabled={readOnly}
            onChange={(event) => onChange(event.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          />
        </span>
        <Input
          {...controlProps('accentColor', issue, true)}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={readOnly}
          maxLength={7}
          spellCheck={false}
          className={cn('h-8 w-28 font-mono text-xs', issue?.severity === 'error' && INVALID_CONTROL)}
        />
      </div>
    </ProfileField>
  );
}

function MillimetreField({
  field,
  label,
  hint,
  value,
  min,
  max,
  issue,
  readOnly,
  onChange,
}: {
  field: 'headerHeightMm' | 'footerHeightMm' | 'marginMm';
  label: string;
  hint: string;
  value: number | null;
  min: number;
  max: number;
  issue?: ProfileIssue;
  readOnly: boolean;
  onChange: (value: number | null) => void;
}) {
  return (
    <ProfileField field={field} label={label} hint={hint} issue={issue}>
      <div className="relative">
        <Input
          {...controlProps(field, issue, true)}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={0.5}
          value={value ?? ''}
          placeholder="Auto"
          disabled={readOnly}
          onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}
          className="pr-10 tabular-nums"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground" aria-hidden="true">mm</span>
      </div>
    </ProfileField>
  );
}

/** The watermark's text, with the usual words one tap away. */
function WatermarkField({ value, readOnly, onChange }: { value: string | null; readOnly: boolean; onChange: (value: string) => void }) {
  return (
    <ProfileField field="watermark" label="Watermark" hint="Faint text across printed pages; blank for none.">
      <Input {...controlProps('watermark', undefined, true)} value={value ?? ''} onChange={(event) => onChange(event.target.value)} disabled={readOnly} maxLength={40} placeholder="None" />
      {!readOnly && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {WATERMARKS.map((word) => (
            <button
              key={word}
              type="button"
              aria-pressed={value === word}
              onClick={() => onChange(value === word ? '' : word)}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                value === word ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:border-primary/40 hover:text-foreground',
              )}
            >
              {word}
            </button>
          ))}
        </div>
      )}
    </ProfileField>
  );
}

/* ── the tab ────────────────────────────────────────────────────────────────────────────────────── */

export function LetterheadTab({
  letterhead: lh,
  issues,
  readOnly,
  single,
  onChange,
}: {
  letterhead: Letterhead;
  issues: Record<string, ProfileIssue>;
  readOnly: boolean;
  /** One column: the preview is beside the form. */
  single: boolean;
  onChange: (change: (current: Letterhead) => Letterhead) => void;
}) {
  const [confirmReset, setConfirmReset] = useState(false);
  const update = (patch: Partial<Letterhead>) => onChange((current) => ({ ...current, ...patch }));
  const updateCustom = (patch: Partial<CustomLetterhead>) => onChange((current) => ({ ...current, custom: { ...current.custom, ...patch } }));
  const accent = HEX.test(lh.accentColor.trim()) ? lh.accentColor.trim() : DEFAULT_COMPANY_DESIGN.letterhead.accentColor;
  const designed = lh.mode === 'custom';

  return (
    <div className="space-y-4">
      <SettingsSection
        title="Letterhead style"
        icon={Stamp}
        description="Every document's header and footer follow this."
        action={
          designed && !readOnly ? (
            <Button variant="outline" size="sm" onClick={() => setConfirmReset(true)}>
              <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Start again from standard
            </Button>
          ) : undefined
        }
      >
        <ChoiceGroup
          label="How it is made"
          value={lh.mode}
          onChange={(mode) => update({ mode })}
          disabled={readOnly}
          columns={2}
          options={[
            { value: 'standard', label: 'Standard', description: 'Built from the company details, with your layout, colour and line.', preview: <ModeSketch mode="standard" accent={accent} /> },
            { value: 'custom', label: 'Designed', description: 'Your own header and footer, laid out like a Word document.', preview: <ModeSketch mode="custom" accent={accent} /> },
          ]}
        />
      </SettingsSection>

      {designed ? (
        <>
          <SettingsSection title="Header" icon={PanelTop} description="The top of the page. Insert fields for the details that change per document.">
            <LetterheadHtmlEditor label="Letterhead header" value={lh.custom.headerHtml} onChange={(headerHtml) => updateCustom({ headerHtml })} disabled={readOnly} minHeightClass="min-h-[160px]" />
          </SettingsSection>
          <SettingsSection title="Footer" icon={PanelBottom} description="The foot of the page.">
            <LetterheadHtmlEditor label="Letterhead footer" value={lh.custom.footerHtml} onChange={(footerHtml) => updateCustom({ footerHtml })} disabled={readOnly} minHeightClass="min-h-[80px]" />
          </SettingsSection>
          <SettingsSection title="Page" icon={Ruler} description="Where the header and footer repeat, and how much room they take.">
            <ChoiceGroup
              label="Header prints on"
              value={lh.custom.headerOn}
              onChange={(headerOn) => updateCustom({ headerOn })}
              disabled={readOnly}
              columns={2}
              options={[
                { value: 'first', label: 'The first page', description: 'Later pages start at the top.' },
                { value: 'every', label: 'Every page', description: 'On documents printed with the repeating letterhead.' },
              ]}
            />
            <ChoiceGroup
              label="Footer prints on"
              value={lh.custom.footerOn}
              onChange={(footerOn) => updateCustom({ footerOn })}
              disabled={readOnly}
              columns={3}
              options={[
                { value: 'every', label: 'Every page' },
                { value: 'last', label: 'The last page', description: 'After the content.' },
                { value: 'first', label: 'The first page', description: 'After the content when it runs longer.' },
              ]}
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <MillimetreField field="headerHeightMm" label="Header height" hint="Blank: as tall as its content." value={lh.custom.headerHeightMm} min={5} max={120} issue={issues.headerHeightMm} readOnly={readOnly} onChange={(headerHeightMm) => updateCustom({ headerHeightMm })} />
              <MillimetreField field="footerHeightMm" label="Footer height" hint="Set it to pin the footer to each sheet's foot." value={lh.custom.footerHeightMm} min={5} max={80} issue={issues.footerHeightMm} readOnly={readOnly} onChange={(footerHeightMm) => updateCustom({ footerHeightMm })} />
              <MillimetreField field="marginMm" label="Page margins" hint="Blank keeps each document's own." value={lh.custom.marginMm} min={0} max={40} issue={issues.marginMm} readOnly={readOnly} onChange={(marginMm) => updateCustom({ marginMm })} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ProfileField field="footerNote" label="Footer note" hint="What the Footer note field prints.">
                <Input {...controlProps('footerNote', undefined, true)} value={lh.footerNote ?? ''} onChange={(event) => update({ footerNote: event.target.value })} disabled={readOnly} maxLength={200} />
              </ProfileField>
              <WatermarkField value={lh.watermark} readOnly={readOnly} onChange={(watermark) => update({ watermark })} />
            </div>
            <SettingsNotice>
              Repeating on every page and the page margins apply to documents printed with the repeating letterhead; the others print the header once, at the top.
              The Page number fields print in the page margin on Chrome and Edge 131 and later; older browsers, such as Chrome 109, leave them out.
            </SettingsNotice>
          </SettingsSection>
        </>
      ) : (
        <ProfileColumns single={single}>
          <>
            <SettingsSection title="Layout" icon={LayoutTemplate} description="Where the logo, the name and the details sit.">
              <ChoiceGroup
                label="Arrangement"
                value={lh.layout}
                onChange={(layout) => update({ layout })}
                disabled={readOnly}
                columns={4}
                options={[
                  { value: 'center', label: 'Centred', description: 'Logo over the name', preview: <LayoutSketch layout="center" accent={accent} /> },
                  { value: 'left', label: 'Left', description: 'Logo beside the name', preview: <LayoutSketch layout="left" accent={accent} /> },
                  { value: 'split', label: 'Split', description: 'Details on the right', preview: <LayoutSketch layout="split" accent={accent} /> },
                ]}
              />
              <ChoiceGroup
                label="Name size"
                value={lh.titleSize}
                onChange={(titleSize) => update({ titleSize })}
                disabled={readOnly}
                columns={4}
                options={[
                  { value: 'sm', label: 'Small', preview: <SizeSketch size="sm" accent={accent} /> },
                  { value: 'md', label: 'Medium', preview: <SizeSketch size="md" accent={accent} /> },
                  { value: 'lg', label: 'Large', preview: <SizeSketch size="lg" accent={accent} /> },
                ]}
              />
            </SettingsSection>
            <SettingsSection title="Colour and line" icon={Paintbrush}>
              <AccentField value={lh.accentColor} issue={issues.accentColor} readOnly={readOnly} onChange={(accentColor) => update({ accentColor })} />
              <ChoiceGroup
                label="Line under the header"
                value={lh.divider}
                onChange={(divider) => update({ divider })}
                disabled={readOnly}
                columns={4}
                options={[
                  { value: 'none', label: 'None', preview: <DividerSketch divider="none" accent={accent} /> },
                  { value: 'line', label: 'Thin', preview: <DividerSketch divider="line" accent={accent} /> },
                  { value: 'double', label: 'Double', preview: <DividerSketch divider="double" accent={accent} /> },
                  { value: 'bar', label: 'Thick', preview: <DividerSketch divider="bar" accent={accent} /> },
                ]}
              />
            </SettingsSection>
          </>
          <>
            <SettingsSection title="What it shows" icon={ListChecks} description="A line prints only when its details are filled in." contentClassName={cn('grid grid-cols-1 gap-2 md:grid-cols-2', !single && 'xl:grid-cols-1')}>
              <SwitchRow label="Logo" description="From Details, or the Branding logo." checked={lh.showLogo} onCheckedChange={(showLogo) => update({ showLogo })} disabled={readOnly} />
              <SwitchRow label="Address" description="The registered office, on one line." checked={lh.showAddress} onCheckedChange={(showAddress) => update({ showAddress })} disabled={readOnly} />
              <SwitchRow label="GSTIN" description="The primary registration." checked={lh.showGstin} onCheckedChange={(showGstin) => update({ showGstin })} disabled={readOnly} />
              <SwitchRow label="CIN and PAN" description="Beside the GSTIN." checked={lh.showCin} onCheckedChange={(showCin) => update({ showCin })} disabled={readOnly} />
              <SwitchRow label="Phone, email and website" description="One contact line." checked={lh.showContacts} onCheckedChange={(showContacts) => update({ showContacts })} disabled={readOnly} />
            </SettingsSection>
            <SettingsSection title="Notes and watermark" icon={StickyNote} contentClassName="grid grid-cols-1 gap-3">
              <ProfileField field="headerNote" label="Note above the name" hint="e.g. An ISO 9001:2015 company.">
                <Input {...controlProps('headerNote', undefined, true)} value={lh.headerNote ?? ''} onChange={(event) => update({ headerNote: event.target.value })} disabled={readOnly} maxLength={200} />
              </ProfileField>
              <ProfileField field="footerNote" label="Footer note" hint="Under the footer line, e.g. the jurisdiction.">
                <Input {...controlProps('footerNote', undefined, true)} value={lh.footerNote ?? ''} onChange={(event) => update({ footerNote: event.target.value })} disabled={readOnly} maxLength={200} />
              </ProfileField>
              <WatermarkField value={lh.watermark} readOnly={readOnly} onChange={(watermark) => update({ watermark })} />
            </SettingsSection>
          </>
        </ProfileColumns>
      )}

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Start again from the standard design?"
        description="The header and footer go back to the standard letterhead's layout. Nothing is stored until you save; Discard returns to the saved version."
        confirmLabel="Start again"
        destructive
        onConfirm={() => updateCustom({ headerHtml: DEFAULT_CUSTOM_LETTERHEAD.headerHtml, footerHtml: DEFAULT_CUSTOM_LETTERHEAD.footerHtml })}
      />
    </div>
  );
}
