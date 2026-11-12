'use client';

/**
 * Workplan Calendar and Gantt Chart — Project Management's two MDL plan views over this register's
 * items: each item's planned start, planned end (red once overdue) and approve date on a calendar,
 * and its planned window as a bar coloured by status. Picking one opens its drawing.
 */

import { useMemo } from 'react';

import { rollup, type DrawingItem } from '@/lib/master-drawing-list/drawings';

import GanttChart, { type GanttRow } from './gantt-chart';
import WorkplanCalendar, { type WorkplanCalendarEvent } from './workplan-calendar';

const CALENDAR_LEGEND = [
  { label: 'Planned start', colorClass: 'bg-blue-500' },
  { label: 'Planned due', colorClass: 'bg-amber-500' },
  { label: 'Overdue', colorClass: 'bg-red-500' },
  { label: 'Approved', colorClass: 'bg-emerald-500' },
];

export function CalendarView({ items, today, onSelect }: { items: DrawingItem[]; today: string; onSelect: (item: DrawingItem) => void }) {
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const events = useMemo<WorkplanCalendarEvent[]>(() => {
    const list: WorkplanCalendarEvent[] = [];
    for (const item of items) {
      // Rolled up, so an item with sub-drawings plots the whole window its drawings occupy.
      const r = rollup(item, today);
      const label = item.description || 'Untitled drawing';
      if (r.plannedStartDate) list.push({ id: item.id, date: r.plannedStartDate, label, colorClass: 'bg-blue-500' });
      if (r.plannedEndDate) list.push({ id: item.id, date: r.plannedEndDate, label, colorClass: r.overdue ? 'bg-red-500' : 'bg-amber-500' });
      if (r.approveDate) list.push({ id: item.id, date: r.approveDate, label, colorClass: 'bg-emerald-500' });
    }
    return list;
  }, [items, today]);
  return (
    <WorkplanCalendar
      events={events}
      onSelectEvent={(id) => {
        const item = byId.get(id);
        if (item) onSelect(item);
      }}
      legend={CALENDAR_LEGEND}
    />
  );
}

const STATUS_BAR_COLORS: Record<string, string> = {
  Pending: 'bg-slate-400',
  'In Progress': 'bg-blue-500',
  Approved: 'bg-emerald-500',
  'Approved with Comments': 'bg-amber-500',
  Rejected: 'bg-red-500',
};

const GANTT_LEGEND = [
  { label: 'Pending', colorClass: 'bg-slate-400' },
  { label: 'In Progress', colorClass: 'bg-blue-500' },
  { label: 'Approved', colorClass: 'bg-emerald-500' },
  { label: 'Approved w/ Comments', colorClass: 'bg-amber-500' },
  { label: 'Rejected', colorClass: 'bg-red-500' },
  { label: 'Overdue', colorClass: 'bg-red-700' },
];

export function GanttView({ items, today, onSelect }: { items: DrawingItem[]; today: string; onSelect: (item: DrawingItem) => void }) {
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const rows = useMemo<GanttRow[]>(
    () =>
      items
        .map((item) => ({ item, r: rollup(item, today) }))
        .filter(({ r }) => r.plannedStartDate && r.plannedEndDate)
        .map(({ item, r }) => ({
          id: item.id,
          label: item.description || 'Untitled drawing',
          sublabel: `${item.slNo ? `Sl. No. ${item.slNo} · ` : ''}${r.status}${r.subTotal ? ` · ${r.subApproved}/${r.subTotal} drawings` : ''}`,
          start: r.plannedStartDate,
          end: r.plannedEndDate,
          barLabel: r.status,
          colorClass: r.overdue ? 'bg-red-700' : (STATUS_BAR_COLORS[r.status] ?? 'bg-slate-400'),
        })),
    [items, today],
  );
  return (
    <GanttChart
      rows={rows}
      onSelectRow={(id) => {
        const item = byId.get(id);
        if (item) onSelect(item);
      }}
      legend={GANTT_LEGEND}
      emptyMessage="Set planned start & end dates on drawings to see them here."
    />
  );
}
