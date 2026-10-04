/**
 * "Export in legacy Bill Tracking format": bills laid out in the exact columns of the finance
 * team's old `Bill Tracking` sheet, so the file can go to external stakeholders who still expect
 * that layout — and so a round trip (export → import) reproduces the same bills.
 *
 * Deduction lines are placed in their legacy column by deduction-type code; lines whose type has no
 * legacy column are added into "Other". "Date of Receipt of Payment" is the latest verified receipt
 * (the sheet only ever had room for one). STATUS is written in the sheet's own words.
 */

import { DEDUCTION_IMPORT_COLUMNS, LEGACY_TEMPLATE_HEADERS } from './import.ts';
import { sumMoney } from './money.ts';
import type { Bill, BillPaymentStatus, DeductionTypeMaster } from './types';

const LEGACY_STATUS: Record<BillPaymentStatus, string> = {
  not_received: 'NOT RECEIVED',
  partially_received: 'PARTIALLY RECEIVED',
  received: 'RECEIVED',
  over_received: 'RECEIVED',
  adjusted: 'ADJUSTED',
  cancelled: 'CANCELLED',
};

export const LEGACY_EXPORT_HEADERS = LEGACY_TEMPLATE_HEADERS;

export function legacyExportRows(bills: readonly Bill[], deductionTypes: readonly DeductionTypeMaster[]): (string | number | null)[][] {
  const codeOf = new Map(deductionTypes.map((type) => [type.id, type.code]));
  const legacyCodes = DEDUCTION_IMPORT_COLUMNS.map((column) => column.deductionCode as string);
  return bills.map((bill) => {
    const byCode = new Map<string, number>();
    for (const line of bill.deductions ?? []) {
      const code = codeOf.get(line.deductionTypeId) ?? 'OTHER';
      const target = legacyCodes.includes(code) ? code : 'OTHER';
      byCode.set(target, sumMoney([byCode.get(target) ?? 0, line.amount]));
    }
    const deductionCells = legacyCodes.map((code) => byCode.get(code) ?? null);
    return [
      bill.legacyTimestamp ?? bill.createdAt?.slice(0, 10) ?? null,
      bill.serialNumber ?? null,
      bill.billSerialNumber ?? null,
      bill.gstInvoiceNumber ?? 'NA',
      bill.billDate,
      bill.projectNameSnapshot,
      bill.description ?? null,
      bill.billTypeName,
      bill.taxableAmount || null,
      bill.gstAmount || null,
      ...deductionCells,
      bill.totalDeduction || null,
      bill.netReceivable,
      bill.totalReceived || null,
      bill.shortfallSurplus,
      bill.lastReceiptDate ?? null,
      LEGACY_STATUS[bill.paymentStatus],
      bill.targetWeek ?? null,
      bill.receivedWeek ?? null,
      bill.currentStage ?? null,
      bill.remarks ?? null,
      bill.typeV2 ?? bill.billTypeName.split('-')[0].toUpperCase(),
      bill.taxableOrAdvance ?? 'BILL',
    ];
  });
}
