'use client';

/**
 * The pieces an expense request is drawn with (expense-form.module.css), shared by the request
 * fields, the GST & TDS section and the pages that host them.
 *
 * Every field carries an accent — a light and a strong colour — that tints its label tile, its
 * control's edge and focus ring, and anything it notices underneath. `FieldItem` and `FieldLabel`
 * are the react-hook-form field parts (FormItem / FormLabel) in that look; `FieldNote` is the line
 * under a field, which turns into the field's error once it has one; `ShownField` is a value the
 * form works out or holds fixed, shown where an input would be.
 */

import type { ChangeEvent, CSSProperties, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { FormDescription, FormItem, FormLabel, FormMessage, useFormField } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import styles from './expense-form.module.css';

export { styles as xr };

/** Light and strong shade of each accent. */
export const ACCENTS = {
  violet: ['#a78bfa', '#7c3aed'],
  teal: ['#5eead4', '#0d9488'],
  blue: ['#93c5fd', '#2563eb'],
  amber: ['#fcd34d', '#d97706'],
  emerald: ['#6ee7b7', '#059669'],
  pink: ['#f9a8d4', '#db2777'],
  green: ['#34d399', '#047857'],
  indigo: ['#a5b4fc', '#4f46e5'],
  slate: ['#cbd5e1', '#64748b'],
  cyan: ['#67e8f9', '#0e7490'],
  rose: ['#fda4af', '#e11d48'],
} as const;

export type Accent = keyof typeof ACCENTS;

/** The custom properties an accent is read from (`--a`, `--b`). */
export const accentStyle = (accent: Accent, extra?: Record<string, string>): CSSProperties =>
  ({ '--a': ACCENTS[accent][0], '--b': ACCENTS[accent][1], ...extra }) as CSSProperties;

/** A grid template giving each shown column its share: `[1, 1.6]` → `minmax(0,1fr) minmax(0,1.6fr)`. */
export const columnTemplate = (weights: readonly number[]) => weights.map((w) => `minmax(0,${w}fr)`).join(' ');

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** ₹1,84,500.00 */
export const money = (n: number) => inr.format(Number(n) || 0);

/**
 * What was typed, in capitals — an expense request is kept in capital letters. The box is changed
 * in place with the caret put back where it was, so typing into the middle of a word does not
 * throw the caret to the end the way re-rendering a different value would.
 */
export function upperCaseTyped(event: ChangeEvent<HTMLInputElement>): string {
  const input = event.target;
  const upper = input.value.toUpperCase();
  if (upper !== input.value) {
    const { selectionStart, selectionEnd } = input;
    input.value = upper;
    if (selectionStart !== null && selectionEnd !== null) input.setSelectionRange(selectionStart, selectionEnd);
  }
  return upper;
}

/** The coloured tile, the words, and the required star or "(optional)" — the inside of a label. */
export function LabelBody({
  icon: Icon,
  glyph,
  required,
  optional,
  children,
}: {
  icon?: LucideIcon;
  /** A character for the tile instead of an icon (₹). */
  glyph?: string;
  required?: boolean;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <span className={styles.dot} aria-hidden="true">
        {Icon ? <Icon /> : glyph}
      </span>
      <span className={styles.labelText}>{children}</span>
      {required && (
        <i className={styles.req} aria-hidden="true">
          *
        </i>
      )}
      {optional && <em className={styles.opt}>(optional)</em>}
    </>
  );
}

/** A react-hook-form field in its accent. Use inside a FormField's render. */
export function FieldItem({ accent, className, children }: { accent: Accent; className?: string; children: ReactNode }) {
  return (
    // `space-y-0`: FormItem spaces its children itself; here the label and the note do it.
    <FormItem className={cn(styles.field, 'space-y-0', className)} style={accentStyle(accent)}>
      {children}
    </FormItem>
  );
}

export function FieldLabel(props: Parameters<typeof LabelBody>[0]) {
  return (
    <FormLabel className={styles.label}>
      <LabelBody {...props} />
    </FormLabel>
  );
}

/**
 * The line under a form field: its error once it has one, otherwise `children` — the help text set
 * under Field Control, or something the form noticed. `tone="accent"` colours it in the field's
 * accent, `"ok"` in green.
 */
export function FieldNote({ children, tone }: { children?: ReactNode; tone?: 'accent' | 'ok' }) {
  const { error } = useFormField();
  if (error) return <FormMessage className={cn(styles.sub, styles.subError)} />;
  return (
    <FormDescription
      className={cn(styles.sub, tone === 'accent' && styles.subAccent, tone === 'ok' && styles.subOk)}
      title={typeof children === 'string' ? children : undefined}
    >
      {children}
    </FormDescription>
  );
}

/**
 * A value shown where an input would be: worked out by the form (`on` once it has one — the head of
 * account), or held fixed (`fixed` — the department of a request being edited).
 */
export function ShownField({
  accent,
  icon,
  label,
  on,
  fixed,
  note,
  children,
}: {
  accent: Accent;
  icon: LucideIcon;
  label: ReactNode;
  on?: boolean;
  fixed?: boolean;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.field} style={accentStyle(accent)}>
      <p className={styles.label}>
        <LabelBody icon={icon}>{label}</LabelBody>
      </p>
      <div className={cn(styles.auto, on && styles.autoOn, fixed && styles.autoFixed)}>{children}</div>
      <p className={styles.sub}>{note}</p>
    </div>
  );
}
