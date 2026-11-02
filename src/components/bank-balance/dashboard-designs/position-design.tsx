'use client';

import Link from 'next/link';
import { Fragment, useMemo, useState } from 'react';
import { format, startOfMonth } from 'date-fns';
import { Activity, ArrowDown, ArrowUp, Check, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { compactInr, formatDay, formatInr, utilisationLevel } from '@/lib/bank-balance-ledger';
import { flowBetween } from '@/lib/bank-balance-dashboard';
import { cn } from '@/lib/utils';
import {
  AttentionList,
  BankAvatar,
  DashboardHeader,
  Figure,
  NoAccounts,
  PanelLink,
  Segmented,
  UsageBar,
  accountName,
  bankShort,
  exportPositions,
  headlineInr,
  maskedNumber,
  plural,
  useDashboard,
  type BankDashboardModel,
  type Position,
} from './kit';

type Filter = 'all' | 'cc' | 'ca';

const listNames = (names: string[]) =>
  names.length === 0 ? '' : names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;

/** Each account's limit as a share of the combined limit, filled to what is drawn. */
function LimitStrip({ rows }: { rows: Position[] }) {
  const withLimit = rows.filter((row) => row.limit > 0);
  if (withLimit.length === 0) return <p className="text-sm text-muted-foreground">No Cash Credit limit in force today.</p>;
  return (
    <div className="flex gap-0.5">
      {withLimit.map((row) => {
        const level = utilisationLevel(row.pct);
        const fill = level === 'critical' ? 'bg-rose-500' : level === 'high' ? 'bg-amber-500' : 'bg-slate-800 dark:bg-slate-300';
        return (
          <div
            key={row.account.id}
            className="min-w-0"
            style={{ flexGrow: row.limit, flexBasis: 0 }}
            title={`${accountName(row.account)}: ${formatInr(row.drawn, 0)} drawn of ${formatInr(row.limit, 0)} (${row.pct.toFixed(1)}%)`}
          >
            <div className="h-3.5 overflow-hidden rounded-[3px] bg-slate-200 dark:bg-slate-700">
              <div className={cn('h-full', fill)} style={{ width: `${Math.min(100, row.pct)}%` }} />
            </div>
            <p className="mt-2 truncate text-xs font-medium text-foreground">{bankShort(row.account)}</p>
            <p className="truncate text-xs tabular-nums text-muted-foreground">{compactInr(row.limit)}</p>
          </div>
        );
      })}
    </div>
  );
}

function CheckRow({ label, value, bad, href }: { label: string; value: string; bad?: boolean; href?: string }) {
  const body = (
    <>
      <span className={cn('inline-flex min-w-0 items-center gap-2', bad ? 'text-rose-700 dark:text-rose-400' : 'text-foreground')}>
        {bad ? (
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-rose-500" />
        ) : (
          <Check aria-hidden className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        )}
        <span className="truncate">{label}</span>
      </span>
      <span className={cn('shrink-0 tabular-nums', bad ? 'font-semibold text-rose-700 dark:text-rose-400' : 'text-muted-foreground')}>{value}</span>
    </>
  );
  return href ? (
    <Link href={href} className="flex items-center justify-between gap-3 py-2 text-sm hover:underline">
      {body}
    </Link>
  ) : (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">{body}</div>
  );
}

function FlowFigure({ icon: Icon, tone, value, label }: { icon?: typeof ArrowUp; tone?: string; value: string; label: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {Icon && (
        <span aria-hidden className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', tone)}>
          <Icon className="h-3.5 w-3.5" />
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold tabular-nums text-foreground">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

const TYPE_CHIP = 'inline-flex rounded border px-1.5 py-0.5 text-[11px] font-semibold text-foreground';

/**
 * Position table: today's position and the checks on top, the day and the month in a strip, then
 * every account in one table — sanctioned limit, drawn, available and utilisation — with subtotals.
 */
export function PositionDesign({ model }: { model: BankDashboardModel }) {
  const { rows, cc, current, inactiveRows, totals, ledgers } = useDashboard(model);
  const { now, interestMtd, staleCheques, attention } = model;
  const [filter, setFilter] = useState<Filter>('all');

  const today = useMemo(() => flowBetween(ledgers, now, now), [ledgers, now]);
  const month = useMemo(() => flowBetween(ledgers, startOfMonth(now), now), [ledgers, now]);

  const breaches = cc.filter((row) => row.limit > 0 && row.drawn > row.limit).length;
  const overdrawn = current.filter((row) => row.figure < 0).length;
  const issues = breaches + overdrawn + (staleCheques?.count ?? 0);
  // Findings the three fixed checks do not already show: high utilisation, missing limits, cheques due.
  const otherFindings = attention.filter(
    (item) => !(item.target === 'accounts' || (item.target === 'cheques' && /stale/i.test(item.text)) || (item.target === 'utilisation' && /over its limit/i.test(item.text))),
  );

  if (rows.length === 0 && inactiveRows.length === 0) {
    return (
      <div className="relative w-full space-y-5 px-4 py-4 sm:px-6 lg:px-8">
        <DashboardHeader model={model} onExport={() => exportPositions(model, [])} />
        <NoAccounts addHref={model.links.addAccount} />
      </div>
    );
  }

  const currentNames = [...new Set(current.map((row) => bankShort(row.account)))];
  const groups: Array<{ id: Filter; title: string; rows: Position[]; subtotal?: boolean; muted?: boolean }> = [
    { id: 'cc', title: `Cash credit, ${plural(cc.length, 'account')}`, rows: cc, subtotal: true },
    { id: 'ca', title: `Current, ${plural(current.length, 'account')}`, rows: current, subtotal: true },
    { id: 'all', title: `Inactive, ${plural(inactiveRows.length, 'account')}`, rows: inactiveRows, muted: true },
  ];
  const shownGroups = groups.filter((group) => group.rows.length > 0 && (filter === 'all' || group.id === filter));
  const sum = (list: Position[], pick: (row: Position) => number) => list.reduce((total, row) => total + pick(row), 0);

  const sinceText = (row: Position) => (row.account.openingDate ? formatDay(row.account.openingDate) : 'Not recorded');

  return (
    <div className="relative w-full space-y-5 px-4 py-4 sm:px-6 lg:px-8">
      <DashboardHeader model={model} onExport={() => exportPositions(model, [...rows, ...inactiveRows])} />

      <section className="grid grid-cols-1 gap-6 rounded-2xl border bg-card p-5 shadow-sm sm:p-6 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0 space-y-6">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <Figure
              label="Cash in current accounts"
              value={formatInr(totals.currentBalance)}
              hint={current.length ? `${plural(current.length, 'account')}${currentNames.length ? `, ${listNames(currentNames)}` : ''}` : 'No current accounts'}
            />
            <Figure
              label="Drawn against cash credit"
              value={headlineInr(totals.ccDrawn)}
              title={formatInr(totals.ccDrawn)}
              hint={`${totals.drawnPct.toFixed(0)}% of ${compactInr(totals.ccLimit)} sanctioned`}
            />
            <Figure
              label="Undrawn headroom"
              value={headlineInr(totals.ccHeadroom)}
              title={formatInr(totals.ccHeadroom)}
              tone="teal"
              hint={`Across ${plural(totals.ccCount, 'cash-credit account')}`}
            />
          </div>
          <div>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-foreground">
                Cash credit limits in force today <span className="font-normal text-muted-foreground">(DP + OD + TOD)</span>
              </p>
              <p className="text-xs tabular-nums text-muted-foreground">{formatInr(totals.ccLimit, 0)} total</p>
            </div>
            <LimitStrip rows={cc} />
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-slate-800 dark:bg-slate-300" />
                Drawn
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-slate-200 dark:bg-slate-700" />
                Undrawn
              </span>
            </div>
          </div>
        </div>

        <div className="min-w-0 self-start rounded-xl bg-muted/50 p-4">
          <div className="flex items-center justify-between gap-2 pb-1">
            <p className="text-sm font-semibold text-foreground">Checks</p>
            {attention.length === 0 ? (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">All clear</span>
            ) : (
              <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', issues ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300')}>
                {plural(attention.length, 'to review', 'to review')}
              </span>
            )}
          </div>
          <div className="divide-y divide-border/70">
            <CheckRow label="Limit breaches" value={breaches ? String(breaches) : 'None'} bad={breaches > 0} href={breaches ? model.attentionHref('utilisation') : undefined} />
            <CheckRow label="Overdrawn accounts" value={overdrawn ? String(overdrawn) : 'None'} bad={overdrawn > 0} href={overdrawn ? model.attentionHref('accounts') : undefined} />
            {staleCheques && (
              <CheckRow label="Stale cheques" value={staleCheques.count ? String(staleCheques.count) : 'None'} bad={staleCheques.count > 0} href={staleCheques.count ? model.attentionHref('cheques') : undefined} />
            )}
            <CheckRow label="Interest accrued, est." value={formatInr(interestMtd, 0)} href={model.links.interest} />
          </div>
          {otherFindings.length > 0 && (
            <div className="-mx-2 mt-2 border-t pt-2">
              <AttentionList items={otherFindings} hrefOf={model.attentionHref} />
            </div>
          )}
        </div>
      </section>

      <section className="grid grid-cols-1 items-center gap-5 rounded-2xl border bg-card p-5 shadow-sm sm:px-6 lg:grid-cols-[auto_1px_minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <p className="mb-2 text-xs text-muted-foreground">Today, {format(now, 'd MMMM')}</p>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <FlowFigure icon={ArrowUp} tone="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" value={formatInr(today.receipts, 0)} label="Receipts" />
            <FlowFigure icon={ArrowDown} tone="bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" value={formatInr(today.payments, 0)} label="Payments" />
            <FlowFigure icon={Activity} tone="bg-muted text-muted-foreground" value={String(today.count)} label={today.count === 1 ? 'Entry' : 'Entries'} />
          </div>
        </div>
        <div aria-hidden className="hidden h-12 w-px bg-border lg:block" />
        <div className="min-w-0">
          <p className="mb-2 text-xs text-muted-foreground">{format(now, 'MMMM')} to date, internal transfers excluded</p>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <FlowFigure value={formatInr(month.receipts, 0)} label="Receipts" />
            <FlowFigure value={formatInr(month.payments, 0)} label="Payments" />
            <FlowFigure value={`${month.net < 0 ? '−' : ''}${formatInr(Math.abs(month.net), 0)}`} label="Net flow" />
          </div>
        </div>
        <PanelLink href={model.links.ledger}>Open ledger</PanelLink>
      </section>

      <section className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold text-foreground">Accounts</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">{rows.length}</span>
          <div className="flex-1" />
          <Segmented
            label="Account type"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: `All ${rows.length}` },
              { value: 'cc', label: `Cash credit ${cc.length}` },
              { value: 'ca', label: `Current ${current.length}` },
            ]}
          />
          {model.links.addAccount && (
            <Button asChild variant="outline" size="sm">
              <Link href={model.links.addAccount}>
                <Plus className="mr-1.5 h-4 w-4" />
                Add account
              </Link>
            </Button>
          )}
        </div>

        {/* Phone: one card per account. */}
        <div className="space-y-4 md:hidden">
          {shownGroups.map((group) => (
            <div key={group.title}>
              <p className="mb-2 text-xs font-medium text-muted-foreground">{group.title}</p>
              <div className="divide-y rounded-xl border bg-card">
                {group.rows.map((row) => (
                  <div key={row.account.id} className={cn('flex items-start gap-3 p-3', group.muted && 'opacity-60')}>
                    <BankAvatar account={row.account} tone="solid" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{row.account.bankName || accountName(row.account)}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {accountName(row.account)} {maskedNumber(row.account)}
                      </p>
                      {row.cc && (
                        <div className="mt-2 flex items-center gap-2">
                          <UsageBar pct={row.pct} />
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{row.pct.toFixed(0)}%</span>
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={cn('text-sm font-semibold tabular-nums', row.available < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-foreground')}>
                        {formatInr(row.available, row.cc ? 0 : 2)}
                      </p>
                      <p className="text-xs text-muted-foreground">{row.cc ? `of ${compactInr(row.limit)}` : 'balance'}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Tablet and up: the table. */}
        <div className="hidden min-w-0 overflow-x-auto rounded-xl border bg-card shadow-sm md:block">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-5 py-3 font-medium">Bank and account</th>
                <th className="px-3 py-3 font-medium">Type</th>
                <th className="hidden px-3 py-3 font-medium 2xl:table-cell">Branch</th>
                <th className="px-3 py-3 text-right font-medium">Sanctioned limit</th>
                <th className="px-3 py-3 text-right font-medium">Drawn</th>
                <th className="px-3 py-3 text-right font-medium">Available</th>
                <th className="px-5 py-3 font-medium">Utilisation</th>
                <th className="px-5 py-3 font-medium">Since</th>
              </tr>
            </thead>
            <tbody>
              {shownGroups.map((group) => (
                <Fragment key={group.title}>
                  <tr className="border-b bg-muted/40">
                    <td colSpan={8} className="px-5 py-2 text-xs font-medium text-muted-foreground">
                      {group.title}
                    </td>
                  </tr>
                  {group.rows.map((row) => (
                    <tr key={row.account.id} className={cn('border-b last:border-b-0', group.muted && 'opacity-60')}>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <BankAvatar account={row.account} tone="solid" />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground">{row.account.bankName || accountName(row.account)}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {accountName(row.account)} {maskedNumber(row.account)}
                              <span className="2xl:hidden"> · {row.account.branch || 'Branch not recorded'}</span>
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className={TYPE_CHIP}>{row.cc ? 'CC' : 'CA'}</span>
                      </td>
                      <td className="hidden max-w-[14rem] truncate px-3 py-3 text-muted-foreground 2xl:table-cell">{row.account.branch || 'Branch not recorded'}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{row.cc ? formatInr(row.limit, 0) : '—'}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{row.cc ? formatInr(row.drawn, 0) : '—'}</td>
                      <td className={cn('px-3 py-3 text-right font-semibold tabular-nums', row.available < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-foreground')}>
                        {formatInr(row.available, row.cc ? 0 : 2)}
                      </td>
                      <td className="px-5 py-3">
                        {row.cc ? (
                          row.limit > 0 ? (
                            <div className="flex items-center gap-3">
                              <UsageBar pct={row.pct} className="w-24" />
                              <span className="tabular-nums text-muted-foreground">{row.pct.toFixed(0)}%</span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">No limit</span>
                          )
                        ) : (
                          <span className="text-muted-foreground">Balance account</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">{sinceText(row)}</td>
                    </tr>
                  ))}
                  {group.subtotal && (
                    <tr className="border-b bg-muted/20 font-semibold">
                      <td className="px-5 py-2.5" colSpan={2}>
                        {group.id === 'cc' ? 'Cash credit subtotal' : 'Current accounts subtotal'}
                      </td>
                      <td className="hidden 2xl:table-cell" />
                      <td className="px-3 py-2.5 text-right tabular-nums">{group.id === 'cc' ? formatInr(sum(group.rows, (row) => row.limit), 0) : ''}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{group.id === 'cc' ? formatInr(sum(group.rows, (row) => row.drawn), 0) : ''}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatInr(sum(group.rows, (row) => row.available), group.id === 'cc' ? 0 : 2)}</td>
                      <td className="px-5 py-2.5 tabular-nums">{group.id === 'cc' ? `${totals.drawnPct.toFixed(0)}%` : ''}</td>
                      <td />
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Figures are worked out from the ledger at the last refresh: each account’s opening figure plus every entry dated up to today. Headline
          figures are rounded to crore; the table shows full rupees. Inactive accounts are left out of every total.
        </p>
      </section>
    </div>
  );
}
