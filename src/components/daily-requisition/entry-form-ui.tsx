'use client';

/**
 * Add New Entry's parts (entry-form.module.css): the Single / Multiple switch, the reception number
 * pill, numbered sections, a label with its required star, AUTO mark and (i) note, the searchable DEP picker,
 * the file drop zone, and the keyboard hint. Presentational only — the page owns the form.
 */

import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ChevronsUpDown, Hash, Paperclip, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { InfoTip } from '@/components/shared/info-tip';
import { cn } from '@/lib/utils';
import styles from './entry-form.module.css';

export { styles as ef };

export type AddMode = 'single' | 'multiple';

/** One entry by hand, or several expense requests at once — with how many are waiting. */
export function ModeSwitch({ value, onChange, pending }: { value: AddMode; onChange: (mode: AddMode) => void; pending: number }) {
  return (
    <div className={styles.seg} role="tablist" aria-label="How many entries">
      <button type="button" role="tab" aria-selected={value === 'single'} onClick={() => onChange('single')}>
        Single entry
      </button>
      <button type="button" role="tab" aria-selected={value === 'multiple'} onClick={() => onChange('multiple')}>
        Multiple from expense requests
        {pending ? <span className={styles.segCount}>{pending.toLocaleString('en-IN')}</span> : null}
      </button>
    </div>
  );
}

export function ReceptionPill({ value }: { value: string }) {
  return (
    <div className={styles.recno} title="Given when the entry is saved">
      <Hash aria-hidden="true" />
      Reception No
      <b>{value || '—'}</b>
    </div>
  );
}

/** A numbered group of fields; `tip` is what the group is for, behind an (i) after the title. */
export function Section({ n, title, note, tip, children }: { n: number; title: string; note?: string; tip?: ReactNode; children: ReactNode }) {
  return (
    <fieldset className={styles.section}>
      <legend className={styles.legend}>
        <span className={styles.legendNo} aria-hidden="true">
          {n}
        </span>
        {title}
        {note ? <span className={styles.legendNote}>— {note}</span> : null}
        {tip ? <InfoTip label={`About “${title}”`}>{tip}</InfoTip> : null}
      </legend>
      {children}
    </fieldset>
  );
}

/** A label's words, its required star, and AUTO while the value is the one the expense request filled in. */
export function LabelText({ children, required, auto }: { children: ReactNode; required?: boolean; auto?: boolean }) {
  return (
    <>
      {children}
      {required ? (
        <i className={styles.req} aria-hidden="true">
          *
        </i>
      ) : null}
      {auto ? (
        <span className={styles.auto} title="Filled in from the expense request">
          AUTO
        </span>
      ) : null}
    </>
  );
}

/**
 * A field's label and, when it has one, its (i) note: what the field is for, opened on click or tap
 * rather than sitting open under it. Beside the label, not inside it — a <label> may hold no other
 * control. Errors and live feedback (the gross–net difference) still show under the field.
 */
export function LabelRow({ children, tip, about }: { children: ReactNode; tip?: ReactNode; about: string }) {
  return (
    <div className={styles.labelRow}>
      {children}
      {tip ? <InfoTip label={`About “${about}”`}>{tip}</InfoTip> : null}
    </div>
  );
}

export function KeyHint() {
  return (
    <span className={styles.footNote}>
      <kbd className={styles.kbd}>Ctrl</kbd>+<kbd className={styles.kbd}>Enter</kbd> to save · <kbd className={styles.kbd}>Esc</kbd> to close
    </span>
  );
}

/* ── The DEP picker ───────────────────────────────────────────────────────────────────────────── */

export interface DepOption {
  id: string;
  requestNo: string;
  party: string;
  project: string;
  department: string;
  description: string;
  /** What it will pay — its net payable. */
  amount: number;
}

/**
 * An expense request, found by its number, party, project, department or description. The rest of
 * the props (`id`, `aria-invalid`, `aria-describedby` from FormControl) land on the box itself.
 */
export function DepPicker({
  options,
  value,
  onChange,
  placeholder,
  formatAmount,
  ...boxProps
}: {
  options: DepOption[];
  value: string;
  onChange: (requestNo: string) => void;
  placeholder: string;
  formatAmount: (amount: number) => string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'value'>) {
  const [open, setOpen] = useState(false);
  const chosen = options.find((option) => option.requestNo === value);
  return (
    <div className="relative">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            {...boxProps}
            type="button"
            className={styles.ctl}
            data-placeholder={value ? undefined : ''}
            // Room for the clear button laid over the box.
            style={{ paddingRight: value ? 58 : 36 }}
          >
            {value ? (
              <>
                <span className={styles.pickNo}>{value}</span>
                {chosen?.party ? <span className={styles.pickMeta}>{chosen.party}</span> : null}
              </>
            ) : (
              <span>{placeholder}</span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[340px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search DEP no, party, project…" />
            <CommandList className="max-h-72">
              <CommandEmpty>{options.length ? 'No expense request matches.' : 'Every expense request has been received.'}</CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.id}
                    value={option.requestNo}
                    keywords={[option.party, option.project, option.department, option.description].filter(Boolean)}
                    onSelect={() => {
                      onChange(option.requestNo);
                      setOpen(false);
                    }}
                    className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 rounded-lg px-2.5 py-2"
                  >
                    <span className="whitespace-nowrap font-mono text-xs font-semibold text-primary">{option.requestNo}</span>
                    <span className="truncate text-[13px] font-semibold">{option.party || '—'}</span>
                    <span className="text-right text-[13px] font-bold tabular-nums">{formatAmount(option.amount)}</span>
                    <span className="col-span-2 col-start-2 truncate text-[11.5px] text-muted-foreground">
                      {[option.project, option.department, option.description].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {/* Over the box, letting clicks through to it — all but the clear button's. */}
      <span className={styles.pickEnd} style={{ position: 'absolute', top: 0, right: 10, bottom: 0, pointerEvents: 'none' }}>
        {value ? (
          <button
            type="button"
            className={cn(styles.pickClear, 'pointer-events-auto border-0 bg-transparent')}
            onClick={() => onChange('')}
            aria-label="Clear the expense request"
          >
            <X aria-hidden="true" />
          </button>
        ) : null}
        <ChevronsUpDown className="pointer-events-none h-4 w-4 opacity-60" aria-hidden="true" />
      </span>
    </div>
  );
}

/* ── Files ────────────────────────────────────────────────────────────────────────────────────── */

const EXT_COLOUR: Array<[RegExp, string]> = [
  [/^pdf$/, '#c62828'],
  [/^(jpe?g|png|gif|webp|heic|bmp)$/, '#2563eb'],
  [/^(xlsx?|csv|ods)$/, '#047857'],
  [/^(docx?|odt|rtf)$/, '#1d4ed8'],
];

const extOf = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '');

const sizeOf = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** Click or drop files onto it; what is chosen shows underneath, each removable. */
export function FileDrop({
  id,
  files,
  onAdd,
  onRemove,
  invalid,
  hint,
}: {
  id: string;
  files: File[];
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
  invalid?: boolean;
  hint: ReactNode;
}) {
  const [over, setOver] = useState(false);
  return (
    <>
      <label
        htmlFor={id}
        className={cn(styles.drop, over && styles.dropOver, invalid && styles.dropBad)}
        onDragEnter={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setOver(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          if (event.dataTransfer.files?.length) onAdd(Array.from(event.dataTransfer.files));
        }}
      >
        <span className={cn(styles.btn, styles.btnSm)}>
          <Paperclip aria-hidden="true" />
          Choose files
        </span>
        <span className={styles.dropText}>{hint}</span>
        <input
          id={id}
          type="file"
          multiple
          className="sr-only"
          aria-invalid={invalid || undefined}
          onChange={(event) => {
            if (event.target.files?.length) onAdd(Array.from(event.target.files));
            // The same file can be chosen again after it was removed.
            event.target.value = '';
          }}
        />
      </label>
      {files.length ? (
        <div className={styles.files}>
          {files.map((file, index) => {
            const ext = extOf(file.name);
            return (
              <span key={`${file.name}-${file.size}-${index}`} className={styles.file}>
                {ext ? (
                  <span className={styles.fileExt} style={{ background: EXT_COLOUR.find(([pattern]) => pattern.test(ext))?.[1] ?? '#64748b' }}>
                    {ext.toUpperCase()}
                  </span>
                ) : null}
                <span className={styles.fileName} title={file.name}>
                  {file.name}
                </span>
                <small>{sizeOf(file.size)}</small>
                <button type="button" onClick={() => onRemove(index)} aria-label={`Remove ${file.name}`}>
                  <X aria-hidden="true" />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
