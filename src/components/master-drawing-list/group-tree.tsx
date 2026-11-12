'use client';

/**
 * The Scope › Schedule › Group strips shared by the Register and Pending Tasks:
 *   - the open and closed state: scope and schedule strips start open and groups closed; a filter
 *     can force everything open;
 *   - the Expand all / Collapse all buttons;
 *   - the strips as table rows (desktop) or tappable bands (phone).
 * Each screen supplies its own figures for a strip and its own rows or cards for a group.
 */

import { Fragment, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronRight, Folder, FolderTree, Layers } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { TableCell, TableRow } from '@/components/ui/table';
import { outlineNo } from '@/lib/master-drawing-list/drawings';
import { groupTitle, nestGroups, type RegisterGroup, type RegisterScope } from '@/lib/master-drawing-list/register';
import { cn } from '@/lib/utils';

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

const toggled = (set: Set<string>, key: string) => {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
};

export interface GroupTree<T> {
  tree: RegisterScope<T>[];
  /** Groups are numbered down the whole list. */
  groupNo: Map<string, number>;
  isBranchOpen: (key: string) => boolean;
  isGroupOpen: (key: string) => boolean;
  toggleBranch: (key: string) => void;
  toggleGroup: (key: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  canExpand: boolean;
  canCollapse: boolean;
}

/** `forceOpen` (a filter is on) opens every strip and ignores clicks on them. */
export function useGroupTree<T>(groups: RegisterGroup<T>[], forceOpen = false): GroupTree<T> {
  /** Scope and schedule strips start open: these are the ones closed. */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const tree = useMemo(() => nestGroups(groups), [groups]);
  const groupKeys = groups.map((group) => group.key);
  const scopeKeys = tree.map((scope) => scope.key);
  const branchKeys = tree.flatMap((scope) => [scope.key, ...scope.schedules.map((schedule) => schedule.key)]);
  return {
    tree,
    groupNo: new Map(groupKeys.map((key, index) => [key, index])),
    isBranchOpen: (key) => forceOpen || !collapsed.has(key),
    isGroupOpen: (key) => forceOpen || expanded.has(key),
    toggleBranch: (key) => {
      if (!forceOpen) setCollapsed((current) => toggled(current, key));
    },
    toggleGroup: (key) => {
      if (!forceOpen) setExpanded((current) => toggled(current, key));
    },
    expandAll: () => {
      setCollapsed(new Set());
      setExpanded(new Set(groupKeys));
    },
    collapseAll: () => {
      setCollapsed(new Set(scopeKeys));
      setExpanded(new Set());
    },
    canExpand: branchKeys.some((key) => collapsed.has(key)) || groupKeys.some((key) => !expanded.has(key)),
    canCollapse: scopeKeys.some((key) => !collapsed.has(key)) || expanded.size > 0,
  };
}

export function TreeButtons({ state }: { state: Pick<GroupTree<unknown>, 'expandAll' | 'collapseAll' | 'canExpand' | 'canCollapse'> }) {
  return (
    <>
      <Button variant="ghost" size="sm" className="h-9 px-2 text-xs sm:h-7" onClick={state.expandAll} disabled={!state.canExpand}>
        Expand all
      </Button>
      <Button variant="ghost" size="sm" className="h-9 px-2 text-xs sm:h-7" onClick={state.collapseAll} disabled={!state.canCollapse}>
        Collapse all
      </Button>
    </>
  );
}

const Chevron = ({ isOpen }: { isOpen: boolean }) => <ChevronRight aria-hidden className={cn('h-4 w-4 shrink-0 transition-transform', isOpen && 'rotate-90')} />;

/** A scope's or schedule's heading: what it is, its name, what it holds, and the screen's figures. */
export function BranchHeading({ level, name, holds, isOpen, aside }: { level: 'Scope' | 'Schedule'; name: string; holds: string; isOpen: boolean; aside: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Chevron isOpen={isOpen} />
      {level === 'Scope' ? <FolderTree className="h-4 w-4 shrink-0 text-indigo-600" /> : <Folder className="h-4 w-4 shrink-0 text-amber-600" />}
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{level}</span>
      <span className={level === 'Scope' ? 'font-bold' : 'font-semibold'}>{name}</span>
      <span className="text-xs text-muted-foreground">{holds}</span>
      {aside}
    </div>
  );
}

/** A group's heading: outline number, the workbook heading, how many items, and the screen's figures. */
export function GroupHeading({ group, index, isOpen, aside }: { group: RegisterGroup<unknown>; index: number; isOpen: boolean; aside: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Chevron isOpen={isOpen} />
      <span className="text-xs font-medium tabular-nums text-muted-foreground">{outlineNo(index)}.</span>
      <Layers className="h-4 w-4 shrink-0 text-sky-600" />
      <span className={cn('font-semibold', !group.group && 'italic text-muted-foreground')}>{groupTitle(group)}</span>
      <span className="text-xs text-muted-foreground">{plural(group.items.length, 'item')}</span>
      {aside}
    </div>
  );
}

interface TreeViewProps<T> {
  state: GroupTree<T>;
  /** The figures at the right of a strip, for the items under it. */
  aside: (items: T[]) => ReactNode;
}

const scopeHolds = (scope: RegisterScope<unknown>) => `${plural(scope.schedules.length, 'schedule')} · ${plural(scope.items.length, 'item')}`;
const scheduleHolds = (schedule: RegisterScope<unknown>['schedules'][number]) => `${plural(schedule.groups.length, 'group')} · ${plural(schedule.items.length, 'item')}`;

/** Desktop: the strips as full-width rows in the screen's table body, a group's own rows beneath it. */
export function TreeTableRows<T>({ state, aside, columnCount, rows }: TreeViewProps<T> & { columnCount: number; rows: (group: RegisterGroup<T>, index: number) => ReactNode }) {
  return state.tree.map((scope) => {
    const scopeOpen = state.isBranchOpen(scope.key);
    return (
      <Fragment key={scope.key}>
        <TableRow className="cursor-pointer bg-muted" onClick={() => state.toggleBranch(scope.key)} aria-expanded={scopeOpen}>
          <TableCell colSpan={columnCount}>
            <BranchHeading level="Scope" name={scope.scope} holds={scopeHolds(scope)} isOpen={scopeOpen} aside={aside(scope.items)} />
          </TableCell>
        </TableRow>
        {scopeOpen &&
          scope.schedules.map((schedule) => {
            const scheduleOpen = state.isBranchOpen(schedule.key);
            return (
              <Fragment key={schedule.key}>
                <TableRow className="cursor-pointer bg-muted/60" onClick={() => state.toggleBranch(schedule.key)} aria-expanded={scheduleOpen}>
                  <TableCell colSpan={columnCount} className="pl-8">
                    <BranchHeading level="Schedule" name={schedule.schedule} holds={scheduleHolds(schedule)} isOpen={scheduleOpen} aside={aside(schedule.items)} />
                  </TableCell>
                </TableRow>
                {scheduleOpen &&
                  schedule.groups.map((group) => {
                    const index = state.groupNo.get(group.key) ?? 0;
                    const isOpen = state.isGroupOpen(group.key);
                    return (
                      <Fragment key={group.key}>
                        <TableRow className={cn('cursor-pointer bg-muted/30', isOpen && 'border-b-0')} onClick={() => state.toggleGroup(group.key)} aria-expanded={isOpen}>
                          <TableCell colSpan={columnCount} className="pl-14">
                            <GroupHeading group={group} index={index} isOpen={isOpen} aside={aside(group.items)} />
                          </TableCell>
                        </TableRow>
                        {isOpen ? rows(group, index) : null}
                      </Fragment>
                    );
                  })}
              </Fragment>
            );
          })}
      </Fragment>
    );
  });
}

/** Enter/Space on a `role="button"` strip — but not when the key was meant for a control inside it. */
const onStripKey = (event: KeyboardEvent, action: () => void) => {
  if (event.target !== event.currentTarget) return;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    action();
  }
};

function Strip({ isOpen, onToggle, className, children }: { isOpen: boolean; onToggle: () => void; className: string; children: ReactNode }) {
  return (
    <div role="button" tabIndex={0} aria-expanded={isOpen} onClick={onToggle} onKeyDown={(event) => onStripKey(event, onToggle)} className={cn('cursor-pointer', className)}>
      {children}
    </div>
  );
}

/** Phone: the strips as tappable bands, indented a step per level; an open group shows its cards. */
export function TreeStrips<T>({ state, aside, cards }: TreeViewProps<T> & { cards: (group: RegisterGroup<T>, index: number) => ReactNode }) {
  return (
    <div className="divide-y sm:hidden">
      {state.tree.map((scope) => {
        const scopeOpen = state.isBranchOpen(scope.key);
        return (
          <div key={scope.key}>
            <Strip isOpen={scopeOpen} onToggle={() => state.toggleBranch(scope.key)} className="bg-muted px-3 py-3">
              <BranchHeading level="Scope" name={scope.scope} holds={scopeHolds(scope)} isOpen={scopeOpen} aside={aside(scope.items)} />
            </Strip>
            {scopeOpen && (
              <div className="divide-y border-t">
                {scope.schedules.map((schedule) => {
                  const scheduleOpen = state.isBranchOpen(schedule.key);
                  return (
                    <div key={schedule.key}>
                      <Strip isOpen={scheduleOpen} onToggle={() => state.toggleBranch(schedule.key)} className="bg-muted/60 py-3 pl-6 pr-3">
                        <BranchHeading level="Schedule" name={schedule.schedule} holds={scheduleHolds(schedule)} isOpen={scheduleOpen} aside={aside(schedule.items)} />
                      </Strip>
                      {scheduleOpen && (
                        <div className="divide-y border-t">
                          {schedule.groups.map((group) => {
                            const index = state.groupNo.get(group.key) ?? 0;
                            const isOpen = state.isGroupOpen(group.key);
                            return (
                              <div key={group.key}>
                                <Strip isOpen={isOpen} onToggle={() => state.toggleGroup(group.key)} className="bg-muted/30 py-3 pl-9 pr-3">
                                  <GroupHeading group={group} index={index} isOpen={isOpen} aside={aside(group.items)} />
                                </Strip>
                                {isOpen && <div className="border-t bg-muted/30 p-2.5">{cards(group, index)}</div>}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
