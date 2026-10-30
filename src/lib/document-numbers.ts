/**
 * The document-number series set on Settings › Serial Nos., and the next number each one will hand
 * out — composed exactly the way its module composes it, so the preview never promises a number the
 * module would not produce:
 *
 * - Site Fund Requisition: prefix + format + the index padded to four digits. Its allocator
 *   (`AllRequisitionsTab2`) never adds the suffix.
 * - Daily Requisition: prefix + format + index + suffix (`formatReceptionNo`).
 * - Store Stock GRN: prefix + today's date written in `format` + index + suffix, as Stock In does it
 *   (a lowercase `m` is read as the month).
 *
 * Each module refuses to number anything while its `serialNumberConfigs/{id}` document is missing,
 * so the defaults below are only suggestions for a series nobody has saved yet.
 */

import { format as formatDate } from 'date-fns';
import type { SerialNumberConfig } from './types';

export interface DocumentSeries {
  id: string;
  name: string;
  /** False where the module leaves the suffix off. */
  usesSuffix: boolean;
  /** True where `format` is a date pattern rather than literal text. */
  datedFormat: boolean;
  /** What the form starts from before the series is first saved. */
  suggested: SerialNumberConfig;
}

export const DOCUMENT_SERIES: DocumentSeries[] = [
  {
    id: 'site-fund-requisition',
    name: 'Site Fund Requisition',
    usesSuffix: false,
    datedFormat: false,
    suggested: { prefix: 'SEL\\SFR\\', format: '2025-26\\', suffix: '', startingIndex: 10 },
  },
  {
    id: 'daily-requisition',
    name: 'Daily Requisition',
    usesSuffix: true,
    datedFormat: false,
    suggested: { prefix: 'SEL\\REC\\', format: '2025-26\\', suffix: '', startingIndex: 7340 },
  },
  {
    id: 'store-stock-grn',
    name: 'Store Stock GRN',
    usesSuffix: true,
    datedFormat: true,
    suggested: { prefix: 'GRN-', format: 'yyyyMMdd-', suffix: '', startingIndex: 1 },
  },
];

export function documentSeries(id: string): DocumentSeries | undefined {
  return DOCUMENT_SERIES.find((series) => series.id === id);
}

/** The counter as the allocators read it: anything unusable starts the series at 1. */
export function nextIndexOf(config: Pick<SerialNumberConfig, 'startingIndex'>): number {
  const raw = Math.trunc(Number(config.startingIndex));
  return Number.isFinite(raw) && raw >= 1 ? raw : 1;
}

/**
 * The number the series hands out next. `null` when a dated format is not a date pattern the
 * module could write (it would fail to number the document).
 */
export function nextDocumentNumber(series: DocumentSeries, config: SerialNumberConfig, now: Date = new Date()): string | null {
  const index = String(nextIndexOf(config)).padStart(4, '0');
  let middle = config.format || '';
  if (series.datedFormat) {
    try {
      middle = formatDate(now, (config.format || 'yyyyMMdd').replace(/m/g, 'M'));
    } catch {
      return null;
    }
  }
  return `${config.prefix || ''}${middle}${index}${series.usesSuffix ? config.suffix || '' : ''}`;
}
