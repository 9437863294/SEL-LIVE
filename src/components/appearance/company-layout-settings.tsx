'use client';

/**
 * The company's layout for everyone: the module sidebar, data tables and dialogs
 * (`design.sidebar`, `design.tables`, `design.dialogs` of the company profile). Users' own
 * Appearance choices sit on top where they exist (table density, dialog width).
 */

import { LayoutGrid, LayoutPanelLeft } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChoiceField,
  CompanyPartFrame,
  DialogPreview,
  PreviewCard,
  ToggleField,
  useCompanyProfilePart,
} from '@/components/appearance/company-profile-part';
import type { CompanyDesign, CompanyProfile } from '@/lib/company-profile';
import { cn } from '@/lib/utils';

const pickLayout = (profile: CompanyProfile) => ({ sidebar: profile.design.sidebar, tables: profile.design.tables, dialogs: profile.design.dialogs });
const applyLayout = (stored: CompanyProfile, draft: CompanyProfile): CompanyProfile => ({
  ...stored,
  design: { ...stored.design, sidebar: draft.design.sidebar, tables: draft.design.tables, dialogs: draft.design.dialogs },
});

function SidebarPreview({ sidebar }: { sidebar: CompanyDesign['sidebar'] }) {
  const width = { narrow: 'w-44', standard: 'w-56', wide: 'w-64' }[sidebar.width];
  const shell = {
    solid: 'bg-slate-900 text-slate-100 border-slate-900',
    soft: 'bg-background border-border/60 shadow-sm',
    minimal: 'bg-transparent border-transparent',
  }[sidebar.style];
  const groups = [
    { label: 'Overview', items: ['Dashboard', 'Reports'] },
    { label: 'Records', items: ['Vouchers', 'Approvals', 'Settings'] },
  ];
  return (
    <div className={cn('max-w-full overflow-hidden rounded-xl border p-2 text-sm', width, shell)}>
      {groups.map((group) => (
        <div key={group.label} className="mb-2">
          {sidebar.showGroupLabels && <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider opacity-60">{group.label}</p>}
          {group.items.map((item) => {
            const active = item === 'Vouchers';
            const indicator = !active
              ? ''
              : sidebar.activeIndicator === 'background'
                ? 'bg-primary text-primary-foreground'
                : sidebar.activeIndicator === 'pill'
                  ? 'rounded-full bg-primary/15 text-primary font-semibold'
                  : 'border-l-4 border-primary font-semibold';
            return (
              <div key={item} className={cn('flex items-center gap-2 rounded-lg px-2 py-1.5', indicator)}>
                {sidebar.showIcons && <LayoutGrid className="h-4 w-4 shrink-0" aria-hidden="true" />}
                <span className="truncate">{item}</span>
              </div>
            );
          })}
        </div>
      ))}
      {sidebar.collapsible && <p className="px-2 pt-1 text-[10px] opacity-60">« Collapse</p>}
    </div>
  );
}

function TablePreview({ tables, accent }: { tables: CompanyDesign['tables']; accent: string }) {
  const cell = { auto: 'px-3 py-2', compact: 'px-2 py-1', standard: 'px-3 py-2', comfortable: 'px-4 py-3' }[tables.density];
  const head = { muted: 'bg-muted text-muted-foreground', accent: 'text-white', plain: 'bg-transparent' }[tables.headerStyle];
  const rows = [['PV-0142', '12 Oct 2026', '48,500.00'], ['PV-0143', '13 Oct 2026', '1,20,000.00'], ['PV-0144', '14 Oct 2026', '9,750.00']];
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className={cn('w-full min-w-[22rem] text-sm', tables.bordered && 'border')}>
        <thead className={head} style={tables.headerStyle === 'accent' ? { backgroundColor: accent } : undefined}>
          <tr>{['Voucher', 'Date', 'Amount'].map((title) => <th key={title} className={cn(cell, 'text-left font-semibold', tables.bordered && 'border')}>{title}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row[0]} className={cn('border-t', tables.striped && index % 2 === 1 && 'bg-muted/50')}>
              {row.map((value, column) => <td key={column} className={cn(cell, column === 2 && 'text-right tabular-nums', tables.bordered && 'border')}>{value}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {tables.stickyHeader && <p className="mt-1 text-[11px] text-muted-foreground">Headers stay in view while a long table scrolls.</p>}
    </div>
  );
}

export function CompanyLayoutSettings() {
  const editor = useCompanyProfilePart({ pick: pickLayout, apply: applyLayout, savedMessage: 'Sidebars, tables and dialogs now use the new layout.' });
  const { readOnly, preview, setDraft } = editor;
  const updateDesign = <K extends 'sidebar' | 'tables' | 'dialogs'>(section: K, patch: Partial<CompanyDesign[K]>) =>
    setDraft((current) => ({ ...current, design: { ...current.design, [section]: { ...current.design[section], ...patch } } }));

  return (
    <CompanyPartFrame
      editor={editor}
      title="Layout: sidebar, tables and dialogs"
      description="The company's layout for every module. A user's own Appearance choices for table density and dialog width apply on top."
      icon={LayoutPanelLeft}
      saveLabel={preview.labels.save}
    >
      {(draft) => (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
          <div className="min-w-0 space-y-4">
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Module sidebar</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ChoiceField label="Style" value={draft.design.sidebar.style} disabled={readOnly} onChange={(style) => updateDesign('sidebar', { style })}
                  options={[{ value: 'soft', label: 'Soft panel' }, { value: 'solid', label: 'Solid dark' }, { value: 'minimal', label: 'Minimal' }]} />
                <ChoiceField label="Width" value={draft.design.sidebar.width} disabled={readOnly} onChange={(width) => updateDesign('sidebar', { width })}
                  options={[{ value: 'narrow', label: 'Narrow' }, { value: 'standard', label: 'Standard' }, { value: 'wide', label: 'Wide' }]} />
                <ChoiceField label="Active item" value={draft.design.sidebar.activeIndicator} disabled={readOnly} onChange={(activeIndicator) => updateDesign('sidebar', { activeIndicator })}
                  options={[{ value: 'background', label: 'Filled background' }, { value: 'pill', label: 'Tinted pill' }, { value: 'bar', label: 'Side bar' }]} />
                <ToggleField label="Show icons" checked={draft.design.sidebar.showIcons} disabled={readOnly} onChange={(showIcons) => updateDesign('sidebar', { showIcons })} />
                <ToggleField label="Show group headings" checked={draft.design.sidebar.showGroupLabels} disabled={readOnly} onChange={(showGroupLabels) => updateDesign('sidebar', { showGroupLabels })} />
                <ToggleField label="Collapsible to an icon rail" checked={draft.design.sidebar.collapsible} disabled={readOnly} onChange={(collapsible) => updateDesign('sidebar', { collapsible })} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Tables</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ChoiceField label="Row density" value={draft.design.tables.density} disabled={readOnly} onChange={(density) => updateDesign('tables', { density })}
                  options={[{ value: 'auto', label: 'Automatic (each user’s Appearance setting)' }, { value: 'compact', label: 'Compact' }, { value: 'standard', label: 'Standard' }, { value: 'comfortable', label: 'Comfortable' }]} />
                <ChoiceField label="Header row" value={draft.design.tables.headerStyle} disabled={readOnly} onChange={(headerStyle) => updateDesign('tables', { headerStyle })}
                  options={[{ value: 'muted', label: 'Muted' }, { value: 'accent', label: 'Accent colour' }, { value: 'plain', label: 'Plain' }]} />
                <ToggleField label="Striped rows" checked={draft.design.tables.striped} disabled={readOnly} onChange={(striped) => updateDesign('tables', { striped })} />
                <ToggleField label="Cell borders" checked={draft.design.tables.bordered} disabled={readOnly} onChange={(bordered) => updateDesign('tables', { bordered })} />
                <ToggleField label="Sticky header row" checked={draft.design.tables.stickyHeader} disabled={readOnly} onChange={(stickyHeader) => updateDesign('tables', { stickyHeader })} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Dialogs</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ChoiceField label="Width of dialogs that set none" value={draft.design.dialogs.defaultSize} disabled={readOnly} onChange={(defaultSize) => updateDesign('dialogs', { defaultSize })}
                  options={[{ value: 'auto', label: 'Automatic (each dialog’s own size)' }, { value: 'sm', label: 'Small — 24rem' }, { value: 'md', label: 'Medium — 32rem' }, { value: 'lg', label: 'Large — 42rem' }, { value: 'xl', label: 'Extra large — 64rem' }]} />
                <ChoiceField label="Footer buttons" value={draft.design.dialogs.footerAlign} disabled={readOnly} onChange={(footerAlign) => updateDesign('dialogs', { footerAlign })}
                  options={[{ value: 'end', label: 'Right-aligned' }, { value: 'between', label: 'Spread apart' }, { value: 'stretch', label: 'Full width' }]} />
              </CardContent>
            </Card>
          </div>
          <PreviewCard title="Layout preview">
            <div className="min-w-0 space-y-5">
              <SidebarPreview sidebar={preview.design.sidebar} />
              <TablePreview tables={preview.design.tables} accent={preview.design.letterhead.accentColor} />
              <DialogPreview dialogs={preview.design.dialogs} labels={preview.labels} />
            </div>
          </PreviewCard>
        </div>
      )}
    </CompanyPartFrame>
  );
}
