import type { DateRange } from 'react-day-picker';
import {
  endOfDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
} from 'date-fns';

export type DateRangePreset =
  | 'custom'
  | 'today'
  | 'yesterday'
  | 'thisWeek'
  | 'last7Days'
  | 'thisMonth'
  | 'thisFY';

export const DATE_RANGE_PRESET_OPTIONS: Array<{
  value: DateRangePreset;
  label: string;
}> = [
  { value: 'custom', label: 'Custom Range' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'thisWeek', label: 'This Week' },
  { value: 'last7Days', label: 'Last 7 Days' },
  { value: 'thisMonth', label: 'This Month' },
  { value: 'thisFY', label: 'This FY' },
];

const getCurrentFYStart = (now: Date) => {
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return new Date(year, 3, 1);
};

export const getDateRangeFromPreset = (
  preset: Exclude<DateRangePreset, 'custom'>,
  now = new Date()
): DateRange => {
  switch (preset) {
    case 'today':
      return { from: startOfDay(now), to: endOfDay(now) };
    case 'yesterday': {
      const day = subDays(now, 1);
      return { from: startOfDay(day), to: endOfDay(day) };
    }
    case 'thisWeek':
      return {
        from: startOfWeek(now, { weekStartsOn: 1 }),
        to: endOfDay(now),
      };
    case 'last7Days':
      return {
        from: startOfDay(subDays(now, 6)),
        to: endOfDay(now),
      };
    case 'thisMonth':
      return { from: startOfMonth(now), to: endOfDay(now) };
    case 'thisFY':
      return { from: startOfDay(getCurrentFYStart(now)), to: endOfDay(now) };
  }
};

