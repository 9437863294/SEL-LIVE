'use client';

/**
 * Settings › Serial Nos. — the series list and the form for one series. They only draw and collect
 * values; the page loads and saves. Drafts are text, so a field can be cleared while typing.
 */

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { DOCUMENT_SERIES, nextDocumentNumber, type DocumentSeries } from '@/lib/document-numbers';
import type { SerialNumberConfig } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface SeriesDraft {
  prefix: string;
  format: string;
  suffix: string;
  startingIndex: string;
}

export const toDraft = (config: SerialNumberConfig): SeriesDraft => ({
  prefix: config.prefix ?? '',
  format: config.format ?? '',
  suffix: config.suffix ?? '',
  startingIndex: String(config.startingIndex ?? 1),
});

/** The config a draft saves as, or `null` while its running number is not a whole number from 1. */
export function fromDraft(draft: SeriesDraft): SerialNumberConfig | null {
  const index = Number(draft.startingIndex);
  if (draft.startingIndex.trim() === '' || !Number.isInteger(index) || index < 1) return null;
  return { prefix: draft.prefix, format: draft.format, suffix: draft.suffix, startingIndex: index };
}

export const sameDraft = (a: SeriesDraft, b: SeriesDraft) =>
  a.prefix === b.prefix && a.format === b.format && a.suffix === b.suffix && a.startingIndex === b.startingIndex;

/** Every series with the number it hands out next — as edited, so the list follows the form. */
export function SeriesList({
  stored,
  drafts,
  selectedId,
  onSelect,
}: {
  /** Each series' saved config (`null`: never saved); `null` while loading. */
  stored: Record<string, SerialNumberConfig | null> | null;
  drafts: Record<string, SeriesDraft>;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  if (!stored) {
    return (
      <div className="space-y-2 p-3">
        {DOCUMENT_SERIES.map((entry) => <Skeleton key={entry.id} className="h-14 rounded-lg" />)}
      </div>
    );
  }
  return (
    <ul className="space-y-1 p-2" aria-label="Document series">
      {DOCUMENT_SERIES.map((entry) => {
        const draft = drafts[entry.id];
        const saved = stored[entry.id] ?? null;
        const config = draft ? fromDraft(draft) : null;
        const changed = Boolean(draft && saved && !sameDraft(draft, toDraft(saved)));
        const active = entry.id === selectedId;
        return (
          <li key={entry.id}>
            <button
              type="button"
              onClick={() => onSelect(entry.id)}
              aria-current={active ? 'true' : undefined}
              className={cn(
                'flex w-full min-w-0 flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active ? 'border-primary/40 bg-primary/5' : 'border-transparent hover:bg-muted/60',
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className={cn('min-w-0 flex-1 truncate text-sm font-semibold', active && 'text-primary')}>{entry.name}</span>
                {!saved && <Badge variant="warning" className="shrink-0">Not set up</Badge>}
                {changed && <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" title="Unsaved changes" aria-label="Unsaved changes" />}
              </span>
              <code className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                {saved ? nextDocumentNumber(entry, config ?? saved) ?? 'Invalid date format' : 'No numbers until saved'}
              </code>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The next number the draft produces, over the four parts that make it. */
export function SeriesForm({
  series,
  draft,
  disabled,
  onChange,
}: {
  series: DocumentSeries;
  draft: SeriesDraft;
  disabled: boolean;
  onChange: (patch: Partial<SeriesDraft>) => void;
}) {
  const config = fromDraft(draft);
  const next = config ? nextDocumentNumber(series, config) : null;
  const after = config ? nextDocumentNumber(series, { ...config, startingIndex: config.startingIndex + 1 }) : null;
  const indexValid = config !== null;
  return (
    <>
      {/* What the settings produce, above them: the reason to change any of them. */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Next number</p>
        <p className="mt-0.5 break-all font-mono text-lg font-semibold text-foreground sm:text-xl" aria-live="polite">
          {next ?? (indexValid ? 'The date pattern is not valid' : '—')}
        </p>
        {after && <p className="mt-0.5 break-all font-mono text-xs text-muted-foreground">then {after}</p>}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="serial-prefix" label="Prefix" hint="Text before everything else.">
          <Input id="serial-prefix" value={draft.prefix} onChange={(event) => onChange({ prefix: event.target.value })} disabled={disabled} className="font-mono" />
        </Field>
        <Field
          id="serial-format"
          label={series.datedFormat ? 'Date pattern' : 'Middle part'}
          hint={series.datedFormat ? 'Written as today’s date: yyyy year, MM month, dd day.' : 'Usually the financial year, e.g. 2025-26\\.'}
        >
          <Input id="serial-format" value={draft.format} onChange={(event) => onChange({ format: event.target.value })} disabled={disabled} className="font-mono" />
        </Field>
        <Field
          id="serial-suffix"
          label="Suffix"
          hint={series.usesSuffix ? 'Text after the running number, e.g. /A.' : `${series.name} numbers have no suffix, so this is not used.`}
        >
          <Input
            id="serial-suffix"
            value={draft.suffix}
            onChange={(event) => onChange({ suffix: event.target.value })}
            disabled={disabled || !series.usesSuffix}
            placeholder={series.usesSuffix ? 'e.g. /A' : undefined}
            className="font-mono"
          />
        </Field>
        <Field
          id="serial-index"
          label="Next running number"
          hint={indexValid ? 'Goes up by one with every document. Shown with four digits.' : 'Enter a whole number, 1 or more.'}
          invalid={!indexValid}
        >
          <Input
            id="serial-index"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={draft.startingIndex}
            onChange={(event) => onChange({ startingIndex: event.target.value })}
            disabled={disabled}
            aria-invalid={!indexValid}
            className="font-mono tabular-nums"
          />
        </Field>
      </div>
    </>
  );
}

function Field({ id, label, hint, invalid, children }: { id: string; label: string; hint: string; invalid?: boolean; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      <p className={cn('text-xs', invalid ? 'font-medium text-danger' : 'text-muted-foreground')}>{hint}</p>
    </div>
  );
}
