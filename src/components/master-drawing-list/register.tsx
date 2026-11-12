'use client';

/**
 * Register — Project Management's MDL register on its own: collapsible Scope › Schedule › Group
 * strips (where PM groups by purchase order), an item row per drawing item with its sub-drawings
 * nested beneath, and the same columns, actions and phone cards. Scope and schedule strips start
 * open and groups closed. A filter bar narrows it; any filter opens everything that still has rows.
 */

import { useMemo, useState } from 'react';
import { CheckCircle2, ChevronRight, FilePenLine, Layers, Paperclip, Pencil, Plus, Trash2 } from 'lucide-react';

import { DataList, type ListColumn } from '@/components/shared/data-list';
import { FilterBar } from '@/components/shared/filter-bar';
import { TableCard } from '@/components/shared/table-card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  OVERALL_STATUSES,
  canEditSubDrawing,
  cycleAgeDays,
  formatMdlDate,
  isApproved,
  isOverdue,
  latestRevision,
  latestRevisionAcrossItem,
  outlineNo,
  rollup,
  summariseItems,
  type DrawingItem,
  type DrawingRevision,
  type Rollup,
  type SubDrawing,
} from '@/lib/master-drawing-list/drawings';
import { courtCounts, filterItems, groupItems, isCourtFilter, isOverallStatus, isSchedule, isScope } from '@/lib/master-drawing-list/register';
import { allNames, listOrder } from '@/lib/master-drawing-list/settings';
import { cn } from '@/lib/utils';

import { TreeButtons, TreeStrips, TreeTableRows, plural, useGroupTree } from './group-tree';
import { useMdlSettings } from './mdl-client';
import { CourtBadge, CourtChips, MdlEmpty, MdlStatus } from './mdl-ui';

export interface RegisterActions {
  /** Drawings · Edit on this drawing list. */
  canEdit: boolean;
  canDelete: boolean;
  userId: string | undefined;
  /** Drawing Details: the drawing's numbers, plan, rounds and status. */
  onEdit: (item: DrawingItem, sub: SubDrawing | null) => void;
  /** Edit item details: the description and group. */
  onEditDetails: (item: DrawingItem) => void;
  onAddSub: (item: DrawingItem) => void;
  onRemoveSub: (item: DrawingItem, sub: SubDrawing) => void;
  onDelete: (item: DrawingItem) => void;
  onOpenFile: (item: DrawingItem, revision: DrawingRevision) => void;
}

export interface RegisterFilterState {
  schedule: string | null;
  scope: string | null;
  status: string | null;
  court: string | null;
  q: string;
  set: (changes: Record<string, string | null>) => void;
}

const NESTED_CARD_CLASS = 'border-border bg-muted/30 p-2.5 shadow-none';

function RevisionBadge({ revision }: { revision: DrawingRevision | null }) {
  if (!revision) return <>—</>;
  return (
    <MdlStatus status={revision.status || undefined}>
      {revision.round}
      {revision.status ? ` · ${revision.status}` : ''}
    </MdlStatus>
  );
}

function CycleAge({ days }: { days: number | null }) {
  return days != null ? <span className={days > 30 ? 'font-medium text-amber-600' : ''}>{days}d</span> : <>—</>;
}

/** The latest round's drawing, as a paperclip link beside the revision. */
function LatestFile({ item, revision, onOpenFile }: { item: DrawingItem; revision: DrawingRevision | null; onOpenFile: RegisterActions['onOpenFile'] }) {
  if (!revision?.filePath) return null;
  return (
    <button
      type="button"
      className="ml-1.5 inline-flex items-center text-primary"
      title={`Open ${revision.fileName || 'the drawing'}`}
      aria-label={`Open the ${revision.round} drawing`}
      onClick={(event) => {
        event.stopPropagation();
        onOpenFile(item, revision);
      }}
    >
      <Paperclip className="h-3.5 w-3.5" />
    </button>
  );
}

type CardRow = { id: string; item: DrawingItem; outline: number[]; rollup: Rollup };
type SubCardRow = { id: string; item: DrawingItem; sub: SubDrawing; outline: number[] };

const COLUMN_COUNT = 16;

export function RegisterView({ items, today, filters, actions }: { items: DrawingItem[]; today: string; filters: RegisterFilterState; actions: RegisterActions }) {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState(filters.q);
  const settings = useMdlSettings();
  const order = useMemo(() => listOrder(settings.masterData), [settings.masterData]);

  const active = {
    schedule: isSchedule(filters.schedule) ? filters.schedule : null,
    scope: isScope(filters.scope) ? filters.scope : null,
    status: isOverallStatus(filters.status) ? filters.status : null,
    court: isCourtFilter(filters.court) ? filters.court : null,
    q: search,
  };
  const filtering = Boolean(active.schedule || active.scope || active.status || active.court || search.trim());
  const shown = useMemo(() => filterItems(items, active, today), [items, active.schedule, active.scope, active.status, active.court, active.q, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => groupItems(shown, order), [shown, order]);
  const strips = useGroupTree(groups, filtering);

  const toggleExpanded = (id: string) =>
    setExpandedItems((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const registerHead = (
    <TableHeader>
      <TableRow>
        <TableHead className="w-16">SL NO</TableHead>
        <TableHead>Sl. No.</TableHead>
        <TableHead className="min-w-[200px]">Item Description</TableHead>
        <TableHead>Drawings</TableHead>
        <TableHead>Ball in Court</TableHead>
        <TableHead>Assigned To</TableHead>
        <TableHead>Doc No.</TableHead>
        <TableHead>Drawing No.</TableHead>
        <TableHead>Planned Start</TableHead>
        <TableHead>Planned End</TableHead>
        <TableHead>Revision</TableHead>
        <TableHead>Cycle Age</TableHead>
        <TableHead>Approve Date</TableHead>
        <TableHead>Status</TableHead>
        <TableHead>Remark</TableHead>
        <TableHead className="w-32" />
      </TableRow>
    </TableHeader>
  );

  const itemRows = (rows: DrawingItem[], prefix: number[]) =>
    rows.map((item, index) => {
      const rolled = rollup(item, today);
      const latest = latestRevisionAcrossItem(item);
      const subDrawings = item.subDrawings;
      const isExpanded = expandedItems.has(item.id);
      const approvedPct = rolled.subTotal ? Math.round((rolled.subApproved / rolled.subTotal) * 100) : 0;
      return [
        <TableRow
          key={item.id}
          className={cn(subDrawings.length && 'cursor-pointer', subDrawings.length && isExpanded && 'border-b-0 bg-muted/30')}
          onClick={subDrawings.length ? () => toggleExpanded(item.id) : undefined}
        >
          <TableCell className="whitespace-nowrap font-medium">{outlineNo(...prefix, index)}.</TableCell>
          <TableCell className="whitespace-nowrap">{item.slNo || '—'}</TableCell>
          <TableCell className="max-w-[220px]">
            <div className="flex items-center gap-1">
              {subDrawings.length ? <ChevronRight aria-hidden className={cn('h-4 w-4 shrink-0 transition-transform', isExpanded && 'rotate-90')} /> : <span className="w-4 shrink-0" />}
              <span className="truncate" title={item.description}>
                {item.description || '—'}
              </span>
            </div>
          </TableCell>
          <TableCell className="whitespace-nowrap">
            {subDrawings.length > 0 ? (
              <div className="flex items-center gap-1.5">
                <div className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${rolled.subApproved} of ${rolled.subTotal} drawings approved`}>
                  <div className="h-full bg-emerald-500" style={{ width: `${approvedPct}%` }} />
                </div>
                <span className="flex items-center gap-1 whitespace-nowrap text-[10px] font-medium text-muted-foreground">
                  <Layers className="h-2.5 w-2.5" />
                  {rolled.subApproved}/{rolled.subTotal}
                </span>
              </div>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </TableCell>
          <TableCell className="whitespace-nowrap">{subDrawings.length === 0 ? <CourtBadge record={item} today={today} /> : <span className="text-muted-foreground">—</span>}</TableCell>
          <TableCell>—</TableCell>
          <TableCell className="whitespace-nowrap">{item.docNo || '—'}</TableCell>
          <TableCell className="max-w-xs truncate" title={item.drawingNo}>
            {item.drawingNo || '—'}
          </TableCell>
          <TableCell className="whitespace-nowrap">{formatMdlDate(rolled.plannedStartDate)}</TableCell>
          <TableCell className="whitespace-nowrap">
            <span className={rolled.overdue ? 'font-medium text-red-600' : ''}>{formatMdlDate(rolled.plannedEndDate)}</span>
            {rolled.overdue && <MdlStatus status="Overdue" className="ml-1.5" title={rolled.subTotal ? 'This item has a drawing past its planned end date — expand to see which' : undefined} />}
          </TableCell>
          <TableCell className="whitespace-nowrap">
            <RevisionBadge revision={latest} />
            <LatestFile item={item} revision={latestRevision(item.revisions)} onOpenFile={actions.onOpenFile} />
          </TableCell>
          <TableCell className="whitespace-nowrap">
            <CycleAge days={cycleAgeDays(rolled, today)} />
          </TableCell>
          <TableCell className="whitespace-nowrap">{formatMdlDate(rolled.approveDate)}</TableCell>
          <TableCell className="whitespace-nowrap">
            <MdlStatus status={rolled.status} />
          </TableCell>
          <TableCell className="max-w-xs truncate" title={item.remark}>
            {item.remark || '—'}
          </TableCell>
          <TableCell onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => actions.onEdit(item, null)} disabled={!actions.canEdit} aria-label={`Update the drawing for ${item.description}`} title="Update drawing — rounds and status">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              {actions.canEdit && (
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => actions.onEditDetails(item)} aria-label={`Edit the details of ${item.description}`} title="Edit item details — description and group">
                  <FilePenLine className="h-3.5 w-3.5" />
                </Button>
              )}
              {actions.canEdit && (
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => actions.onAddSub(item)} aria-label={`Add a sub-drawing to ${item.description}`} title="Add sub-drawing">
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              )}
              {actions.canDelete && (
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => actions.onDelete(item)} aria-label={`Remove ${item.description} from the MDL register`} title="Remove from MDL register">
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              )}
            </div>
          </TableCell>
        </TableRow>,
        ...(isExpanded
          ? subDrawings.map((sub, subIndex) => {
              const subLatest = latestRevision(sub.revisions ?? []);
              const subOverdue = isOverdue(sub, today);
              const canEditThisSub = canEditSubDrawing(sub, actions.userId, actions.canEdit);
              return (
                <TableRow key={`${item.id}-${sub.id}`} className="border-b-0 last:border-b">
                  <TableCell className="whitespace-nowrap tabular-nums">
                    <span className="pl-3">{outlineNo(...prefix, index, subIndex)}.</span>
                  </TableCell>
                  <TableCell />
                  <TableCell className="max-w-[220px]">
                    <div className="flex items-center gap-1.5 border-l-2 border-muted pl-3">
                      {isApproved(sub.status) && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                      <span className="truncate text-sm" title={sub.title}>
                        {sub.title || 'Untitled drawing'}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>—</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <CourtBadge record={sub} today={today} />
                  </TableCell>
                  <TableCell className="max-w-[140px] whitespace-nowrap">
                    <span className={cn('truncate text-xs', !sub.assignedToName && 'text-muted-foreground')}>{sub.assignedToName || 'Unassigned'}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{sub.docNo || '—'}</TableCell>
                  <TableCell className="max-w-xs truncate" title={sub.drawingNo}>
                    {sub.drawingNo || '—'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatMdlDate(sub.plannedStartDate)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <span className={subOverdue ? 'font-medium text-red-600' : ''}>{formatMdlDate(sub.plannedEndDate)}</span>
                    {subOverdue && <MdlStatus status="Overdue" className="ml-1.5" />}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <RevisionBadge revision={subLatest} />
                    <LatestFile item={item} revision={subLatest} onOpenFile={actions.onOpenFile} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <CycleAge days={cycleAgeDays(sub, today)} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatMdlDate(sub.approveDate)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <MdlStatus status={sub.status} />
                  </TableCell>
                  <TableCell className="max-w-xs truncate" title={sub.remark}>
                    {sub.remark || '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => actions.onEdit(item, sub)} disabled={!canEditThisSub} aria-label={`Edit sub-drawing ${sub.title || 'untitled'}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {actions.canEdit && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => actions.onRemoveSub(item, sub)} aria-label={`Remove sub-drawing ${sub.title || 'untitled'}`} title="Remove sub-drawing">
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          : []),
      ];
    });

  /** How many of the rows' drawings are approved, as a bar and a count. */
  const approvedBar = (rows: DrawingItem[]) => {
    const summary = summariseItems(rows);
    const approvedPct = summary.drawings ? Math.round((summary.approved / summary.drawings) * 100) : 0;
    return (
      <div className="ml-auto flex items-center gap-2">
        <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-background" role="img" aria-label={`${summary.approved} of ${summary.drawings} drawings approved`}>
          <div className="h-full bg-emerald-500" style={{ width: `${approvedPct}%` }} />
        </div>
        <span className="whitespace-nowrap text-[10px] font-medium text-muted-foreground">
          {summary.approved}/{summary.drawings} approved
        </span>
      </div>
    );
  };
  /* ── Phone: groups become tappable strips; an open group lists its items as cards, sub-drawings nested. */
  const cardColumns: ListColumn<CardRow>[] = [
    {
      header: 'Item Description',
      mobile: 'title',
      cell: ({ item, outline }) => (
        <>
          <span className="mr-1 tabular-nums text-muted-foreground">{outlineNo(...outline)}.</span>
          {item.description || '—'}
        </>
      ),
    },
    { header: 'Sl. No.', mobile: 'title', cell: ({ item }) => `Sl. No. ${item.slNo || '—'}` },
    { header: 'Remark', mobile: 'title', cell: ({ item }) => item.remark || null },
    { header: 'Status', mobile: 'aside', cell: ({ rollup: rolled }) => <MdlStatus status={rolled.status} /> },
    { header: 'Overdue', mobile: 'aside', cell: ({ rollup: rolled }) => (rolled.overdue ? <MdlStatus status="Overdue" /> : null) },
    {
      header: 'Drawings',
      cell: ({ item, rollup: rolled }) =>
        item.subDrawings.length > 0 ? (
          <span className="flex items-center gap-1 whitespace-nowrap text-xs font-medium text-muted-foreground">
            <Layers className="h-3 w-3" />
            {rolled.subApproved}/{rolled.subTotal} approved
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { header: 'Ball in Court', cell: ({ item }) => (item.subDrawings.length ? <span className="text-muted-foreground">—</span> : <CourtBadge record={item} today={today} />) },
    { header: 'Doc No.', cell: ({ item }) => item.docNo || '—' },
    { header: 'Drawing No.', cell: ({ item }) => <span title={item.drawingNo}>{item.drawingNo || '—'}</span> },
    { header: 'Planned Start', cell: ({ rollup: rolled }) => formatMdlDate(rolled.plannedStartDate) },
    { header: 'Planned End', cell: ({ rollup: rolled }) => <span className={rolled.overdue ? 'font-medium text-red-600' : ''}>{formatMdlDate(rolled.plannedEndDate)}</span> },
    { header: 'Revision', cell: ({ item }) => <RevisionBadge revision={latestRevisionAcrossItem(item)} /> },
    { header: 'Cycle Age', cell: ({ rollup: rolled }) => <CycleAge days={cycleAgeDays(rolled, today)} /> },
    { header: 'Approve Date', cell: ({ rollup: rolled }) => formatMdlDate(rolled.approveDate) },
    {
      header: 'Actions',
      mobile: 'footer',
      cell: ({ item }) => {
        const isExpanded = expandedItems.has(item.id);
        return (
          <div className="flex w-full flex-col gap-2">
            {item.subDrawings.length > 0 && (
              <div className="flex">
                <Button variant="outline" size="sm" onClick={() => toggleExpanded(item.id)} aria-expanded={isExpanded}>
                  <ChevronRight className={cn('mr-1.5 h-4 w-4 transition-transform', isExpanded && 'rotate-90')} />
                  {isExpanded ? 'Hide' : 'Show'} {item.subDrawings.length} drawing{item.subDrawings.length === 1 ? '' : 's'}
                </Button>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => actions.onEdit(item, null)} disabled={!actions.canEdit} aria-label={`Update the drawing for ${item.description}`}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" /> Update
              </Button>
              {actions.canEdit && (
                <Button variant="outline" size="sm" onClick={() => actions.onEditDetails(item)} aria-label={`Edit the details of ${item.description}`}>
                  <FilePenLine className="mr-1.5 h-3.5 w-3.5" /> Details
                </Button>
              )}
              {actions.canEdit && (
                <Button variant="outline" size="sm" onClick={() => actions.onAddSub(item)} aria-label={`Add a sub-drawing to ${item.description}`}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> Sub-drawing
                </Button>
              )}
              {actions.canDelete && (
                <Button variant="outline" size="sm" onClick={() => actions.onDelete(item)} aria-label={`Remove ${item.description} from the MDL register`}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              )}
            </div>
          </div>
        );
      },
    },
  ];

  const subCardColumns: ListColumn<SubCardRow>[] = [
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
    { header: 'Remark', mobile: 'title', cell: ({ sub }) => sub.remark || null },
    { header: 'Doc No.', cell: ({ sub }) => sub.docNo || '—' },
    { header: 'Drawing No.', cell: ({ sub }) => <span title={sub.drawingNo}>{sub.drawingNo || '—'}</span> },
    { header: 'Planned Start', cell: ({ sub }) => formatMdlDate(sub.plannedStartDate) },
    {
      header: 'Planned End',
      cell: ({ sub }) => (
        <>
          <span className={isOverdue(sub, today) ? 'font-medium text-red-600' : ''}>{formatMdlDate(sub.plannedEndDate)}</span>
          {isOverdue(sub, today) && <MdlStatus status="Overdue" className="ml-1.5" />}
        </>
      ),
    },
    { header: 'Revision', cell: ({ sub }) => <RevisionBadge revision={latestRevision(sub.revisions ?? [])} /> },
    { header: 'Cycle Age', cell: ({ sub }) => <CycleAge days={cycleAgeDays(sub, today)} /> },
    { header: 'Approve Date', cell: ({ sub }) => formatMdlDate(sub.approveDate) },
    {
      header: 'Actions',
      mobile: 'footer',
      cell: ({ item, sub }) => (
        <>
          <Button variant="outline" size="sm" onClick={() => actions.onEdit(item, sub)} disabled={!canEditSubDrawing(sub, actions.userId, actions.canEdit)} aria-label={`Edit sub-drawing ${sub.title || 'untitled'}`}>
            <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
          </Button>
          {actions.canEdit && (
            <Button variant="outline" size="sm" onClick={() => actions.onRemoveSub(item, sub)} aria-label={`Remove sub-drawing ${sub.title || 'untitled'}`}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5 text-destructive" /> Remove
            </Button>
          )}
        </>
      ),
    },
  ];

  const phoneCards = (rows: DrawingItem[], prefix: number[]) => {
    const cardRows: CardRow[] = rows.map((item, index) => ({ id: item.id, item, outline: [...prefix, index], rollup: rollup(item, today) }));
    return (
      <DataList
        cardsOnly
        rows={cardRows}
        columns={cardColumns}
        expandedIds={new Set(cardRows.filter((row) => row.item.subDrawings.length && expandedItems.has(row.id)).map((row) => row.id))}
        renderExpanded={(row) => (
          <DataList
            cardsOnly
            rows={row.item.subDrawings.map((sub, subIndex) => ({ id: sub.id, item: row.item, sub, outline: [...row.outline, subIndex] }))}
            columns={subCardColumns}
            rowClassName={() => NESTED_CARD_CLASS}
          />
        )}
      />
    );
  };

  return (
    <TableCard
      description={
        <>
          {plural(strips.tree.length, 'scope')} · {plural(groups.length, 'group')} · {shown.length} of {plural(items.length, 'item')}
        </>
      }
      actions={filtering ? undefined : <TreeButtons state={strips} />}
      toolbar={
        <div className="space-y-3">
        <CourtChips counts={courtCounts(items, today)} total={items.length} value={active.court} onChange={(court) => filters.set({ court })} />
        <FilterBar
          search={{
            value: search,
            onChange: (value) => {
              setSearch(value);
              filters.set({ q: value.trim() || null });
            },
            placeholder: 'Search description, numbers, group, remark…',
          }}
          activeCount={[active.schedule, active.scope, active.status].filter(Boolean).length}
          onClear={() => {
            setSearch('');
            filters.set({ schedule: null, scope: null, status: null, court: null, q: null });
          }}
        >
          <Select value={active.scope ?? 'all'} onValueChange={(value) => filters.set({ scope: value === 'all' ? null : value })}>
            <SelectTrigger aria-label="Scope" className="text-left">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All scopes</SelectItem>
              {allNames(settings.masterData.scopes).map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={active.schedule ?? 'all'} onValueChange={(value) => filters.set({ schedule: value === 'all' ? null : value })}>
            <SelectTrigger aria-label="Schedule" className="text-left">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All schedules</SelectItem>
              {allNames(settings.masterData.schedules).map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={active.status ?? 'all'} onValueChange={(value) => filters.set({ status: value === 'all' ? null : value })}>
            <SelectTrigger aria-label="Status" className="text-left">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {OVERALL_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterBar>
        </div>
      }
    >
      {!groups.length ? (
        <MdlEmpty title={items.length ? 'No item matches these filters' : 'No items in this drawing list yet'} description={items.length ? 'Clear a filter or the search to see more.' : 'Add an item, or load the workbook on the Excel Import page.'} />
      ) : (
        <>
          <Table containerClassName="hidden sm:block">
            {registerHead}
            <TableBody>
              <TreeTableRows state={strips} aside={approvedBar} columnCount={COLUMN_COUNT} rows={(group, index) => itemRows(group.items, [index])} />
            </TableBody>
          </Table>
          <TreeStrips state={strips} aside={approvedBar} cards={(group, index) => phoneCards(group.items, [index])} />
        </>
      )}
    </TableCard>
  );
}
