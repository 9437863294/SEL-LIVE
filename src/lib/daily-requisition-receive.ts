/**
 * Receiving several expense requests (DEPs) into Daily Requisition at once.
 *
 * The requests are numbered in DEP order: within a department the lowest serial (…/0001) takes the
 * first reception number of the block and the highest takes the last, so the register reads in the
 * same order as the department's own series. Departments group by their DEP prefix.
 *
 * Pure — no Firebase — so the ordering is unit-testable with `node --test`.
 */

import { allocateReceptionNos, type RequisitionSerialConfig } from './daily-requisition-import.ts';

/** How many requests one receipt may take: each costs three writes (entry, request, log) of a transaction's 500. */
export const MAX_RECEIVE_AT_ONCE = 100;

/**
 * DEP numbers in natural order: `SEL/EXP/FIN/2026-27/0002` before `…/0010`, and one department's
 * series together (its prefix sorts as text, its serial as a number).
 */
export function compareRequestNos(a: string, b: string): number {
  return String(a ?? '').localeCompare(String(b ?? ''), 'en', { numeric: true, sensitivity: 'base' });
}

export function orderForReception<T extends { requestNo?: string }>(requests: readonly T[]): T[] {
  return [...requests].sort((x, y) => compareRequestNos(x.requestNo ?? '', y.requestNo ?? ''));
}

export interface ReceptionPlanItem<T> {
  request: T;
  receptionNo: string;
}

/** The requests in DEP order, each with the reception number it will take, and where the counter is left. */
export function planReception<T extends { requestNo?: string }>(
  requests: readonly T[],
  config: RequisitionSerialConfig,
): { items: Array<ReceptionPlanItem<T>>; nextIndex: number } {
  const ordered = orderForReception(requests);
  const { receptionNos, nextIndex } = allocateReceptionNos(config, ordered.length);
  return { items: ordered.map((request, index) => ({ request, receptionNo: receptionNos[index] })), nextIndex };
}
