/**
 * Daily Requisition's Reception No series as Settings › Serial Numbers edits it: the stored
 * document (`serialNumberConfigs/daily-requisition`, src/lib/daily-requisition-import.ts) read as
 * parts — prefix, financial year, running number, suffix — joined by one separator, and written
 * back in the shape every allocator reads. A document saved before this page round-trips unchanged:
 * `SEL\REC\` + `2025-26\` reads as prefix "SEL\REC", fixed year "2025-26", separator "\".
 *
 * Pure, so `node --experimental-strip-types --test` loads it (tests/daily-requisition-serial.test.mjs).
 */

import {
  counterStart,
  fyLabel,
  fyStartOf,
  formatReceptionNo,
  serialDigits,
  type FyToken,
  type RequisitionSerialConfig,
} from './daily-requisition-import.ts';

export const SEPARATORS = ['/', '\\', '-', '.', ''] as const;
export type Separator = (typeof SEPARATORS)[number];

export interface SerialDesign {
  separator: Separator;
  prefixOn: boolean;
  prefix: string;
  fyOn: boolean;
  fyMode: 'auto' | 'fixed';
  /** How an automatic year reads. */
  fyToken: FyToken;
  /** The year as typed, when fixed. */
  fyText: string;
  suffixOn: boolean;
  suffix: string;
  digits: number;
  resetEvery: 'never' | 'fy';
  /** The next running number. */
  next: number;
}

const TOKENS: FyToken[] = ['{FY2}', '{FYS}', '{FY}'];
const isSep = (c: string): c is Exclude<Separator, ''> => c !== '' && (SEPARATORS as readonly string[]).includes(c);

/** The stored series, as parts. */
export function designFromConfig(config: RequisitionSerialConfig | null | undefined, on: Date = new Date()): SerialDesign {
  const prefix = String(config?.prefix ?? '');
  const format = String(config?.format ?? '');
  const suffix = String(config?.suffix ?? '');
  const lastOf = (s: string) => s.slice(-1);
  const separator: Separator = isSep(lastOf(prefix)) ? lastOf(prefix) as Separator : isSep(lastOf(format)) ? (lastOf(format) as Separator) : prefix || format ? '' : '/';
  const strip = (s: string) => (separator && s.endsWith(separator) ? s.slice(0, -1) : s);
  const token = TOKENS.find((t) => format.includes(t));
  const fyText = strip(format);
  const raw = Math.trunc(Number(config?.startingIndex));
  return {
    separator,
    prefixOn: strip(prefix) !== '',
    prefix: strip(prefix),
    fyOn: format !== '',
    fyMode: token ? 'auto' : 'fixed',
    fyToken: token ?? '{FY}',
    fyText: token ? fyLabel(fyStartOf(on), token) : fyText,
    suffixOn: suffix !== '',
    suffix: separator && suffix.startsWith(separator) ? suffix.slice(separator.length) : suffix,
    digits: serialDigits(config ?? {}),
    resetEvery: config?.resetEvery === 'fy' && token ? 'fy' : 'never',
    next: config ? counterStart(config, on) : Number.isFinite(raw) && raw >= 1 ? raw : 1,
  };
}

/**
 * The parts, as the document every allocator reads. Starting again each year needs an automatic
 * year in the number, so without one it is written as never. The financial year the counter is
 * set for is today's: the next number typed here is this year's next number.
 */
export function configFromDesign(d: SerialDesign, on: Date = new Date()): Required<Pick<RequisitionSerialConfig, 'prefix' | 'format' | 'suffix' | 'startingIndex' | 'digits' | 'resetEvery'>> & { counterFy?: number } {
  const sep = d.separator;
  const yearPart = d.fyOn ? (d.fyMode === 'auto' ? d.fyToken : d.fyText.trim()) : '';
  const resetEvery = d.resetEvery === 'fy' && d.fyOn && d.fyMode === 'auto' ? 'fy' : 'never';
  const out = {
    prefix: d.prefixOn && d.prefix.trim() ? `${d.prefix.trim()}${sep}` : '',
    format: yearPart ? `${yearPart}${sep}` : '',
    suffix: d.suffixOn && d.suffix.trim() ? `${sep}${d.suffix.trim()}` : '',
    startingIndex: Math.max(1, Math.trunc(Number(d.next)) || 1),
    digits: Math.min(6, Math.max(3, Math.trunc(Number(d.digits)) || 4)),
    resetEvery,
  } as const;
  return resetEvery === 'fy' ? { ...out, counterFy: fyStartOf(on) } : { ...out };
}

export type SerialPartKind = 'prefix' | 'fy' | 'number' | 'suffix';

/** The number as its parts, for the preview that colours each one. */
export function previewParts(d: SerialDesign, index: number, on: Date = new Date()): Array<{ kind: SerialPartKind; text: string }> {
  const parts: Array<{ kind: SerialPartKind; text: string }> = [];
  if (d.prefixOn && d.prefix.trim()) parts.push({ kind: 'prefix', text: d.prefix.trim() });
  if (d.fyOn) {
    const year = d.fyMode === 'auto' ? fyLabel(fyStartOf(on), d.fyToken) : d.fyText.trim();
    if (year) parts.push({ kind: 'fy', text: year });
  }
  parts.push({ kind: 'number', text: String(index).padStart(Math.min(6, Math.max(3, d.digits)), '0') });
  if (d.suffixOn && d.suffix.trim()) parts.push({ kind: 'suffix', text: d.suffix.trim() });
  return parts;
}

/** The whole number for a running number, exactly as the allocators will issue it. */
export function numberFor(d: SerialDesign, index: number, on: Date = new Date()): string {
  return formatReceptionNo(configFromDesign(d, on), index, on);
}

/** Everything before the running number on the day given — the part every number of the series shares. */
export function seriesStem(d: SerialDesign, on: Date = new Date()): string {
  const c = configFromDesign(d, on);
  return formatReceptionNo({ ...c, suffix: '', digits: 3 }, 0, on).slice(0, -3);
}

/** The running number inside a Reception No of this series, or null when it is not one of them. */
export function runningNumberOf(receptionNo: string, d: SerialDesign, on: Date = new Date()): number | null {
  const stem = seriesStem(d, on);
  const c = configFromDesign(d, on);
  if (!receptionNo.startsWith(stem)) return null;
  let rest = receptionNo.slice(stem.length);
  if (c.suffix) {
    if (!rest.endsWith(c.suffix)) return null;
    rest = rest.slice(0, -c.suffix.length);
  }
  return /^\d+$/.test(rest) ? Number(rest) : null;
}

/**
 * A fixed year that has fallen behind: the text reads as a financial year, but not today's. With
 * the token that writes it the same way, for the "use automatic" fix.
 */
export function staleFixedYear(d: SerialDesign, on: Date = new Date()): { stored: string; current: string; token: FyToken } | null {
  if (!d.fyOn || d.fyMode !== 'fixed') return null;
  const text = d.fyText.trim().replace(/[\\/.\s]+$/, '');
  let start: number | null = null;
  let token: FyToken = '{FY}';
  let m: RegExpMatchArray | null;
  if ((m = text.match(/^(\d{4})-(\d{2})$/))) start = Number(m[1]);
  else if ((m = text.match(/^(\d{2})-(\d{2})$/))) {
    start = 2000 + Number(m[1]);
    token = '{FY2}';
  } else if ((m = text.match(/^FY ?(\d{2})$/i))) {
    start = 2000 + Number(m[1]) - 1;
    token = '{FYS}';
  }
  const now = fyStartOf(on);
  if (start === null || start === now) return null;
  return { stored: text, current: fyLabel(now, token), token };
}
