import { startOfDay } from 'date-fns';

import type { BankAccount, DpLogEntry } from '@/lib/types';

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

  const targetDate = startOfDay(onDate);

  return [...account.drawingPower]
    .sort(
      (a, b) =>
        new Date(b.fromDate).getTime() -
        new Date(a.fromDate).getTime()
    )
    .find((entry) => {
      const from = startOfDay(new Date(entry.fromDate));
      const to = entry.toDate
        ? startOfDay(new Date(entry.toDate))
        : null;

      return (
        from <= targetDate &&
        (to === null || to >= targetDate)
      );
    });
};

export const getApplicableCcLimit = (
  account: BankAccount,
  onDate: Date
) =>
  getEffectiveCcLimitFromEntry(
    getApplicableCcLimitEntry(account, onDate)
  );
