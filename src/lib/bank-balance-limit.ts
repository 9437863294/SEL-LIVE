import type { BankAccount, DpLogEntry } from '@/lib/types';
import { entryAppliesOn } from '@/lib/bank-balance-ledger';

/**
 * DP + OD + TOD. Each part is coerced: a figure stored as a string (an imported or hand-edited
 * `drawingPower` row) would otherwise be CONCATENATED — "500000" + 0 + 0 reads as 50,000,000,
 * a hundredfold limit — instead of added.
 */
const num = (value: unknown) => Number(value) || 0;

export const getEffectiveCcLimitFromEntry = (
  entry?: DpLogEntry | null
) =>
  num(entry?.amount) +
  num(entry?.odAmount) +
  num(entry?.todAmount);

export const getApplicableCcLimitEntry = (
  account: BankAccount,
  onDate: Date
) => {
  if (
    account.accountType !== 'Cash Credit' ||
    !Array.isArray(account.drawingPower) ||
    account.drawingPower.length === 0
  ) {
    return null;
  }

  // Same day rules as every other dated log in the module (see bank-balance-ledger).
  return [...account.drawingPower]
    .sort((a, b) => b.fromDate.localeCompare(a.fromDate))
    .find((entry) => entryAppliesOn(entry, onDate));
};

export const getApplicableCcLimit = (
  account: BankAccount,
  onDate: Date
) =>
  getEffectiveCcLimitFromEntry(
    getApplicableCcLimitEntry(account, onDate)
  );
