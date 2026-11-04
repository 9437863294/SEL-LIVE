'use client';

/**
 * The words every module shares — Save, Cancel, Delete, the delete confirmation, signature
 * captions… (`labels` of the company profile). A blank field falls back to the default.
 *
 * Grouped by where the words appear, each label one compact row: its default wording (and where it
 * shows, when that is not obvious), the field, and a reset once it differs from the default. A
 * search and a "Changed only" switch work across every group; the preview opens beside them.
 */

import { useState, type ComponentType } from 'react';
import { MessageSquare, MousePointerClick, PanelLeft, Printer, RotateCcw, Search, Table2, Type } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { PreviewToggle, usePreviewVisible } from '@/components/appearance/controls';
import { SettingsColumns, SettingsSection } from '@/components/settings/settings-ui';
import { SignatureBlock } from '@/components/shared/company-letterhead';
import { CompanyPartFrame, DialogPreview, PreviewCard, useCompanyProfilePart } from '@/components/appearance/company-profile-part';
import { UI_TEXT_DEFAULTS, UI_TEXT_HINTS, UI_TEXT_KEYS, type CompanyProfile, type UiTextKey } from '@/lib/company-profile';
import { cn } from '@/lib/utils';

const pickLabels = (profile: CompanyProfile) => profile.labels;
const applyLabels = (stored: CompanyProfile, draft: CompanyProfile): CompanyProfile => ({ ...stored, labels: draft.labels });

interface LabelGroupMeta {
  id: string;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  keys: UiTextKey[];
}

const NAMED_GROUPS: LabelGroupMeta[] = [
  {
    id: 'buttons',
    title: 'Buttons',
    description: 'The action buttons in every module.',
    icon: MousePointerClick,
    keys: ['save', 'cancel', 'confirm', 'delete', 'close', 'edit', 'add', 'search', 'filter', 'export', 'print', 'refresh'],
  },
  {
    id: 'messages',
    title: 'Messages',
    description: 'Loading, empty lists, the delete confirmation and access messages.',
    icon: MessageSquare,
    keys: ['loading', 'noRecords', 'noResults', 'confirmDeleteTitle', 'confirmDeleteDescription', 'unsavedChanges', 'required', 'accessDenied', 'noPermissionModule'],
  },
  {
    id: 'tables',
    title: 'Tables and totals',
    description: 'Column headings and the totals under them.',
    icon: Table2,
    keys: ['date', 'amount', 'status', 'remarks', 'actions', 'total', 'grandTotal'],
  },
  {
    id: 'printing',
    title: 'Printing and signatures',
    description: 'Signature captions and the footer of printed documents.',
    icon: Printer,
    keys: ['preparedBy', 'checkedBy', 'approvedBy', 'authorisedSignatory', 'printedOn', 'page', 'of'],
  },
  {
    id: 'navigation',
    title: 'Navigation',
    description: 'The module sidebar and the way home.',
    icon: PanelLeft,
    keys: ['menu', 'collapseMenu', 'expandMenu', 'home'],
  },
];

// A label added to UI_TEXT_KEYS later still gets a place, under the last group.
const LABEL_GROUPS: LabelGroupMeta[] = (() => {
  const named = new Set<UiTextKey>(NAMED_GROUPS.flatMap((group) => group.keys));
  const rest = UI_TEXT_KEYS.filter((key) => !named.has(key));
  const last = NAMED_GROUPS[NAMED_GROUPS.length - 1];
  return [...NAMED_GROUPS.slice(0, -1), { ...last, keys: [...last.keys, ...rest] }];
})();

/** Differs from the default. A blank field is not a change: it falls back to the default. */
const isChanged = (key: UiTextKey, value: string) => value.trim() !== '' && value !== UI_TEXT_DEFAULTS[key];

const matches = (key: UiTextKey, value: string, query: string) =>
  !query || [UI_TEXT_DEFAULTS[key], value, UI_TEXT_HINTS[key] ?? '', key].some((text) => text.toLowerCase().includes(query));

type Labels = CompanyProfile['labels'];

export function CompanyTextLabels() {
  const editor = useCompanyProfilePart({ pick: pickLabels, apply: applyLabels, savedMessage: 'Every module now uses the new wording.' });
  const { readOnly, canEdit, preview, setDraft } = editor;

  return (
    <CompanyPartFrame
      editor={editor}
      title="Text labels"
      description="The words shared by every module. A blank field falls back to the default."
      icon={Type}
      saveLabel={preview.labels.save}
    >
      {(draft) => (
        <TextLabelsEditor
          labels={draft.labels}
          preview={preview}
          readOnly={readOnly}
          canEdit={canEdit}
          onLabels={(change) => setDraft((current) => ({ ...current, labels: change(current.labels) }))}
        />
      )}
    </CompanyPartFrame>
  );
}

/**
 * The groups, the search and the preview: the labels' editor without the loading and saving around
 * it (`CompanyPartFrame`), so it can also be drawn on its own.
 */
export function TextLabelsEditor({
  labels,
  preview,
  readOnly,
  canEdit,
  onLabels,
}: {
  labels: Labels;
  /** The whole draft profile as it would be saved — for the preview. */
  preview: CompanyProfile;
  readOnly: boolean;
  canEdit: boolean;
  onLabels: (change: (current: Labels) => Labels) => void;
}) {
  const [showPreview, setShowPreview] = usePreviewVisible('company-labels');
  const [query, setQuery] = useState('');
  const [changedOnly, setChangedOnly] = useState(false);
  const setLabel = (key: UiTextKey, value: string) => onLabels((current) => ({ ...current, [key]: value }));
  const changedCount = UI_TEXT_KEYS.filter((key) => isChanged(key, labels[key])).length;
  const search = query.trim().toLowerCase();
  const groups = LABEL_GROUPS.map((group) => ({
    ...group,
    changed: group.keys.filter((key) => isChanged(key, labels[key])).length,
    shown: group.keys.filter((key) => (!changedOnly || isChanged(key, labels[key])) && matches(key, labels[key], search)),
  })).filter((group) => group.shown.length > 0);

  return (
    <div className={cn('grid grid-cols-1 gap-4', showPreview && 'xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] xl:items-start')}>
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-56 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a label…" aria-label="Find a label" className="h-9 pl-8" />
          </div>
          <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border bg-background px-3 text-sm">
            <Switch checked={changedOnly} onCheckedChange={setChangedOnly} disabled={!changedOnly && changedCount === 0} />
            Changed only
            <span className="rounded-full bg-muted px-1.5 text-[11px] font-semibold tabular-nums text-muted-foreground">{changedCount}</span>
          </label>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                action={false}
                disabled={changedCount === 0}
                onClick={() => onLabels(() => ({ ...UI_TEXT_DEFAULTS }))}
              >
                <RotateCcw className="mr-1.5 h-4 w-4" />
                Reset all
              </Button>
            )}
            {showPreview ? null : <PreviewToggle visible={false} onToggle={() => setShowPreview(true)} className="h-9" />}
          </div>
        </div>

        {groups.length ? (
          <SettingsColumns single={showPreview}>
            {groups.map((group) => (
              <SettingsSection
                key={group.id}
                title={group.title}
                description={group.description}
                icon={group.icon}
                flush
                action={
                  group.changed ? (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">{group.changed} changed</span>
                  ) : null
                }
              >
                <ul className="divide-y border-t">
                  {group.shown.map((key) => (
                    <LabelRow key={key} labelKey={key} value={labels[key]} readOnly={readOnly} canReset={canEdit} onChange={(value) => setLabel(key, value)} />
                  ))}
                </ul>
              </SettingsSection>
            ))}
          </SettingsColumns>
        ) : (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            {search ? `No ${changedOnly ? 'changed ' : ''}label matches “${query.trim()}”.` : 'Every label uses its default wording.'}
          </p>
        )}
      </div>

      {showPreview ? (
        <PreviewCard title="Labels preview" onHide={() => setShowPreview(false)}>
          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap gap-2">
              {(['save', 'cancel', 'edit', 'add', 'export', 'print', 'refresh'] as const).map((key) => (
                <Button key={key} size="sm" variant={key === 'save' ? 'default' : 'outline'} type="button">
                  {preview.labels[key]}
                </Button>
              ))}
            </div>
            <Input placeholder={`${preview.labels.search}…`} readOnly />
            <p className="rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground">{preview.labels.noRecords}</p>
            <DialogPreview dialogs={preview.design.dialogs} labels={preview.labels} />
            <div className="keep-light rounded-lg border bg-white p-3 text-slate-900">
              <SignatureBlock profile={preview} className="mt-0" />
            </div>
          </div>
        </PreviewCard>
      ) : null}
    </div>
  );
}

/**
 * One label: its default wording (the name it is known by) and where it shows, the field — which
 * shows the default when blank — and a reset once it differs. Stacked name-over-field on a phone.
 */
function LabelRow({
  labelKey,
  value,
  readOnly,
  canReset,
  onChange,
}: {
  labelKey: UiTextKey;
  value: string;
  readOnly: boolean;
  canReset: boolean;
  onChange: (value: string) => void;
}) {
  const id = `label-${labelKey}`;
  const fallback = UI_TEXT_DEFAULTS[labelKey];
  const hint = UI_TEXT_HINTS[labelKey];
  const changed = isChanged(labelKey, value);
  return (
    <li
      className={cn(
        'grid grid-cols-[minmax(0,1fr)_2rem] items-center gap-x-2 gap-y-1.5 px-4 py-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_2rem] sm:gap-x-3',
        changed && 'bg-primary/5',
      )}
    >
      <label htmlFor={id} className="col-span-2 min-w-0 sm:col-span-1" title={`Key: ${labelKey}`}>
        {/* Wrapped, not cut off: the longer defaults are whole sentences. */}
        <span className="flex min-w-0 items-baseline gap-1.5 text-sm font-medium leading-snug">
          {changed ? <span className="h-1.5 w-1.5 shrink-0 -translate-y-0.5 rounded-full bg-primary" aria-hidden="true" /> : null}
          <span className="min-w-0 break-words">{fallback}</span>
          {changed ? <span className="sr-only">(changed)</span> : null}
        </span>
        {hint ? <span className="block text-[11px] leading-snug text-muted-foreground">{hint}</span> : null}
      </label>
      <Input
        id={id}
        className="h-9"
        value={value}
        placeholder={fallback}
        onChange={(event) => onChange(event.target.value)}
        disabled={readOnly}
        maxLength={labelKey === 'confirmDeleteDescription' ? 300 : 120}
      />
      <span className="flex h-9 w-8 items-center justify-center">
        {canReset && changed ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            action={false}
            title="Back to the default"
            aria-label={`Reset “${fallback}” to the default`}
            onClick={() => onChange(fallback)}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </span>
    </li>
  );
}
