'use client';

/**
 * Pending Tasks — Project Management's MDL queue on its own: every item not yet approved, in the
 * register's groups (Scope › Schedule › Group, where PM groups by purchase order), overdue first
 * then by planned end date, with its sub-drawings beneath. Update opens the Drawing Details dialog.
 */

import { useMemo, useState } from 'react';
import { CheckCircle2, ListTodo } from 'lucide-react';

import { DataList, type ListColumn } from '@/components/shared/data-list';
import { TableCard } from '@/components/shared/table-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cycleAgeDays, formatMdlDate, isApproved, isOverdue, outlineNo, rollup, type DrawingItem, type Rollup, type SubDrawing } from '@/lib/master-drawing-list/drawings';
import { courtCounts, groupItems, inCourt, pendingItems, type CourtFilter } from '@/lib/master-drawing-list/register';
import { listOrder } from '@/lib/master-drawing-list/settings';
import { cn } from '@/lib/utils';

import { TreeButtons, TreeStrips, TreeTableRows, useGroupTree } from './group-tree';
import { useMdlSettings } from './mdl-client';
import { CourtBadge, CourtChips, MdlEmpty, MdlStatus } from './mdl-ui';

type PendingCardRow = { id: string; item: DrawingItem; rollup: Rollup; outline: number[] };
type PendingSubCardRow = { id: string; item: DrawingItem; sub: SubDrawing; outline: number[] };

const NESTED_CARD_CLASS = 'border-border bg-muted/30 p-2.5 shadow-none';
const COLUMN_COUNT = 10;

const CycleAge = ({ days }: { days: number | null }) => (days != null ? <span className={days > 30 ? 'font-medium text-amber-600' : ''}>{days}d</span> : <>—</>);

export function PendingView({ items, today, onSelect }: { items: DrawingItem[]; today: string; onSelect: (item: DrawingItem, sub: SubDrawing | null) => void }) {
  const [court, setCourt] = useState<CourtFilter | null>(null);
  const open = useMemo(() => pendingItems(items, today), [items, today]);
  const counts = useMemo(() => courtCounts(open, today), [open, today]);
  const { masterData } = useMdlSettings();
  const order = useMemo(() => listOrder(masterData), [masterData]);
  const groups = useMemo(() => groupItems(court ? open.filter((item) => inCourt(item, court, today)) : open, order), [open, court, today, order]);
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);
  const strips = useGroupTree(groups);

  /** Outstanding drawings and how many are already past their planned end date. */
  const groupStats = (rows: DrawingItem[]) => {
    let outstanding = 0;
    let overdue = 0;
    for (const item of rows) {
      if (item.subDrawings.length) {
        outstanding += item.subDrawings.filter((sub) => !isApproved(sub.status)).length;
        overdue += item.subDrawings.filter((sub) => !isApproved(sub.status) && isOverdue(sub, today)).length;
      } else {
        outstanding += 1;
        if (rollup(item, today).overdue) overdue += 1;
      }
    }
    return { outstanding, overdue };
  };

  const sortRows = (rows: DrawingItem[]) =>
    rows
      .map((item) => ({ item, rolled: rollup(item, today) }))
      .sort((a, b) => {
        if (a.rolled.overdue !== b.rolled.overdue) return a.rolled.overdue ? -1 : 1;
        return (a.rolled.plannedEndDate || '9999-12-31').localeCompare(b.rolled.plannedEndDate || '9999-12-31');
      });

  const rowsOf = (rows: DrawingItem[], prefix: number[]) =>
    sortRows(rows).map(({ item, rolled }, index) => [
      <TableRow key={item.id} className={cn('cursor-pointer', item.subDrawings.length && 'border-b-0 bg-muted/30')} onClick={() => onSelect(item, null)}>
        <TableCell className="whitespace-nowrap font-semibold">{outlineNo(...prefix, index)}.</TableCell>
        <TableCell className="whitespace-nowrap">{item.slNo || '—'}</TableCell>
        <TableCell className="max-w-[240px] truncate font-medium" title={item.description}>
          {item.description || '—'}
        </TableCell>
        <TableCell className="whitespace-nowrap">
          {item.subDrawings.length > 0 ? (
            <Badge variant="neutral" className="whitespace-nowrap">
              {rolled.subApproved}/{rolled.subTotal}
            </Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell>—</TableCell>
        <TableCell className="whitespace-nowrap">
          <span className={rolled.overdue ? 'font-medium text-red-600' : ''}>{formatMdlDate(rolled.plannedEndDate)}</span>
          {rolled.overdue && <MdlStatus status="Overdue" className="ml-1.5" title={rolled.subTotal ? 'This item has a drawing past its planned end date — see the rows below' : undefined} />}
        </TableCell>
        <TableCell className="whitespace-nowrap">
          <CycleAge days={cycleAgeDays(rolled, today)} />
        </TableCell>
        <TableCell className="whitespace-nowrap">{item.subDrawings.length ? null : <CourtBadge record={item} today={today} />}</TableCell>
        <TableCell className="whitespace-nowrap">
          <MdlStatus status={rolled.status} />
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => onSelect(item, null)}>
            Update
          </Button>
        </TableCell>
      </TableRow>,
      ...item.subDrawings.map((sub, subIndex) => {
        const subOverdue = isOverdue(sub, today);
        const subApproved = isApproved(sub.status);
        return (
          <TableRow key={`${item.id}-${sub.id}`} className={cn('cursor-pointer border-b-0 last:border-b', subApproved && 'text-muted-foreground')} onClick={() => onSelect(item, sub)}>
            <TableCell className="whitespace-nowrap tabular-nums">
              <span className="pl-3">{outlineNo(...prefix, index, subIndex)}.</span>
            </TableCell>
            <TableCell />
            <TableCell className="max-w-[240px]" title={sub.title}>
              <div className="flex items-center gap-1.5 border-l-2 border-muted pl-3">
                {subApproved && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                <span className="truncate text-sm">{sub.title || 'Untitled drawing'}</span>
              </div>
            </TableCell>
            <TableCell>—</TableCell>
            <TableCell className="max-w-[140px] whitespace-nowrap">
              <span className={cn('truncate text-xs', !sub.assignedToName && 'text-muted-foreground')}>{sub.assignedToName || 'Unassigned'}</span>
            </TableCell>
            <TableCell className="whitespace-nowrap">
              <span className={subOverdue ? 'font-medium text-red-600' : ''}>{formatMdlDate(sub.plannedEndDate)}</span>
              {subOverdue && <MdlStatus status="Overdue" className="ml-1.5" />}
            </TableCell>
            <TableCell className="whitespace-nowrap">
              <CycleAge days={cycleAgeDays(sub, today)} />
            </TableCell>
            <TableCell className="whitespace-nowrap">
              <CourtBadge record={sub} today={today} />
            </TableCell>
            <TableCell className="whitespace-nowrap">
              <MdlStatus status={sub.status} />
            </TableCell>
            <TableCell onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => onSelect(item, sub)}>
                Update
              </Button>
            </TableCell>
          </TableRow>
        );
      }),
    ]);

  /** A strip's figures: outstanding drawings, and how many are past their planned end date. */
  const pendingAside = (rows: DrawingItem[]) => {
    const { outstanding, overdue } = groupStats(rows);
    return (
      <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
        {outstanding} outstanding
        {overdue > 0 && <MdlStatus status="Overdue">{overdue} overdue</MdlStatus>}
      </span>
    );
  };

  const cardColumns: ListColumn<PendingCardRow>[] = [
    {
      header: 'Item / Drawing',
      mobile: 'title',
      cell: ({ item, outline }) => (
        <>
          <span className="mr-1 tabular-nums text-muted-foreground">{outlineNo(...outline)}.</span>
          {item.description || '—'}
        </>
      ),
    },
    { header: 'Sl. No.', mobile: 'title', cell: ({ item }) => `Sl. No. ${item.slNo || '—'}` },
    { header: 'Status', mobile: 'aside', cell: ({ rollup: rolled }) => <MdlStatus status={rolled.status} /> },
    { header: 'Overdue', mobile: 'aside', cell: ({ rollup: rolled }) => (rolled.overdue ? <MdlStatus status="Overdue" /> : null) },
    { header: 'Planned End', cell: ({ rollup: rolled }) => <span className={rolled.overdue ? 'font-medium text-red-600' : ''}>{formatMdlDate(rolled.plannedEndDate)}</span> },
    { header: 'Cycle Age', cell: ({ rollup: rolled }) => <CycleAge days={cycleAgeDays(rolled, today)} /> },
    {
      header: 'Drawings',
      cell: ({ item, rollup: rolled }) =>
        item.subDrawings.length > 0 ? (
          <Badge variant="neutral" className="whitespace-nowrap">
            {rolled.subApproved}/{rolled.subTotal}
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      header: 'Update',
      mobile: 'footer',
      cell: ({ item }) => (
        <Button variant="outline" size="sm" onClick={() => onSelect(item, null)}>
          Update
        </Button>
      ),
    },
  ];
  const subCardColumns: ListColumn<PendingSubCardRow>[] = [
    {
      header: 'Drawing',
      mobile: 'title',
      cell: ({ sub, outline }) => (
        <span className="flex items-start gap-1.5">
          <span className="text-xs tabular-nums text-muted-foreground">{outlineNo(...outline)}.</span>
          {isApproved(sub.status) && <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />}
          <span className="min-w-0 break-words">{sub.title || 'Untitled drawing'}</span>
        </span>
      ),
    },
    {
      header: 'Stage',
      mobile: 'title',
      cell: ({ sub }) => (
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <CourtBadge record={sub} today={today} />
          <MdlStatus status={sub.status} />
          <span className={cn(sub.assignedToName && 'text-foreground')}>{sub.assignedToName || 'Unassigned'}</span>
        </span>
      ),
    },
    { header: 'Planned End', cell: ({ sub }) => <span className={isOverdue(sub, today) ? 'font-medium text-red-600' : ''}>{formatMdlDate(sub.plannedEndDate)}</span> },
    { header: 'Cycle Age', cell: ({ sub }) => <CycleAge days={cycleAgeDays(sub, today)} /> },
    {
      header: 'Update',
      mobile: 'footer',
      cell: ({ item, sub }) => (
        <Button variant="outline" size="sm" onClick={() => onSelect(item, sub)}>
          Update
        </Button>
      ),
    },
  ];

  const phoneCards = (rows: DrawingItem[], prefix: number[]) => {
    const cardRows: PendingCardRow[] = sortRows(rows).map(({ item, rolled }, index) => ({ id: item.id, item, rollup: rolled, outline: [...prefix, index] }));
    return (
      <DataList
        cardsOnly
        rows={cardRows}
        columns={cardColumns}
        expandedIds={new Set(cardRows.filter((row) => row.item.subDrawings.length).map((row) => row.id))}
        renderExpanded={(row) => (
          <DataList cardsOnly rows={row.item.subDrawings.map((sub, subIndex) => ({ id: sub.id, item: row.item, sub, outline: [...row.outline, subIndex] }))} columns={subCardColumns} rowClassName={() => NESTED_CARD_CLASS} />
        )}
      />
    );
  };

  return (
    <TableCard
      title="Pending Tasks"
      icon={ListTodo}
      description="Every drawing not yet approved — overdue first, then by planned end date."
      count={total}
      noun="item"
      toolbar={<CourtChips counts={counts} total={open.length} value={court} onChange={setCourt} filters={['sel', 'client', 'not_started', 'overdue']} />}
      actions={groups.length ? <TreeButtons state={strips} /> : undefined}
    >
      {!groups.length ? (
        <MdlEmpty title={court ? 'Nothing under this filter' : 'Nothing pending'} description={court ? 'Choose All to see every open drawing.' : 'Every drawing in this list is approved.'} />
      ) : (
        <>
          <Table containerClassName="hidden sm:block">
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">SL NO</TableHead>
                <TableHead>Sl. No.</TableHead>
                <TableHead className="min-w-[220px]">Item / Drawing</TableHead>
                <TableHead>Drawings</TableHead>
                <TableHead>Assigned To</TableHead>
                <TableHead>Planned End</TableHead>
                <TableHead>Cycle Age</TableHead>
                <TableHead>Ball in Court</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              <TreeTableRows state={strips} aside={pendingAside} columnCount={COLUMN_COUNT} rows={(group, index) => rowsOf(group.items, [index])} />
            </TableBody>
          </Table>
          <TreeStrips state={strips} aside={pendingAside} cards={(group, index) => phoneCards(group.items, [index])} />
        </>
      )}
    </TableCard>
  );
}
