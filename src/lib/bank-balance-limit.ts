import type { BankAccount, DpLogEntry } from '@/lib/types';
import { entryAppliesOn } from '@/lib/bank-balance-ledger';

export const getEffectiveCcLimitFromEntry = (
  entry?: DpLogEntry | null
) =>
  (entry?.amount || 0) +
  (entry?.odAmount || 0) +
  (entry?.todAmount || 0);

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
