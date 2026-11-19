'use client';

/**
 * Which projects have deduction settings of their own — Settings → Deduction types.
 *
 * `OwnSettingsOverview`, on the default: every such project against the heads any of them sets — a
 * blank cell follows the default — or the same grouped by setting (which projects take Building Cess
 * on gross…), so a change to the default is made knowing whom it does not reach. A project opens its
 * own settings. `ProjectOwnSettings`, on one project: what it sets, its figure beside the default's.
 *
 * Props only — no lookups — so they render wherever the config is to hand.
 */

import { useState } from 'react';
import { Building2, ChevronRight, LayoutGrid, Rows3 } from 'lucide-react';

import { InfoTip } from '@/components/shared/info-tip';
import { cn } from '@/lib/utils';
import { deductionChangeShort, ownSettingsByChange, ownSettingsCount, ownSettingsGrid, type DeductionFieldChange, type OwnSettingGroup, type ProjectDeductionHead } from '@/lib/bill-tracking/deduction-types';
import { describeTerms, projectBasisRuleGroups, projectBasisRules, ruleScope } from '@/lib/bill-tracking/value-basis';
import type { BillTrackingConfig, BillTypeMaster, ValueBasisRule } from '@/lib/bill-tracking/types';

type OverviewConfig = Pick<BillTrackingConfig, 'deductionTypes' | 'projectProfiles' | 'billTypes'>;
type View = 'grid' | 'setting';

/** The project's figure for one field — amber, the colour own settings are marked with — the default on hover. */
function OwnChip({ change }: { change: DeductionFieldChange }) {
  return (
    <span
      className="inline-flex items-center whitespace-nowrap rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-inset ring-amber-200"
      title={`${change.label} — this project: ${deductionChangeShort(change)}; default: ${deductionChangeShort({ field: change.field, value: change.defaultValue })}`}
    >
      {deductionChangeShort(change)}
    </span>
  );
}

/**
 * A value basis rule a project sets for itself: its name, then its terms and the invoices it covers.
 * `compact` (the grid, one line a row): the name alone, the terms on hover and to screen readers.
 */
function BasisRule({ rule, billTypes, compact = false }: { rule: ValueBasisRule; billTypes: readonly Pick<BillTypeMaster, 'id' | 'name'>[]; compact?: boolean }) {
  const name = rule.name || 'Value basis rule';
  const terms = `${describeTerms(rule)} · ${ruleScope(rule, billTypes)}`;
  const chip = (
    <span
      className={cn('inline-flex max-w-full items-center gap-1.5 rounded-md bg-violet-50 px-1.5 py-0.5 text-xs font-medium text-violet-900 ring-1 ring-inset ring-violet-200', compact && 'whitespace-nowrap')}
      title={compact ? `${name}${rule.active ? '' : ' (off)'}: ${terms}` : undefined}
    >
      <span className="truncate">{name}</span>
      {rule.active ? null : <span className="shrink-0 font-normal text-violet-700">· off</span>}
      {compact ? <span className="sr-only">: {terms}</span> : null}
    </span>
  );
  if (compact) return chip;
  return (
    <span className="block min-w-0">
      {chip}
      <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{terms}</span>
    </span>
  );
}

/** The two views, as a segmented switch. */
function ViewSwitch({ value, onChange }: { value: View; onChange: (value: View) => void }) {
  const options: { value: View; label: string; icon: typeof LayoutGrid }[] = [
    { value: 'grid', label: 'By project', icon: LayoutGrid },
    { value: 'setting', label: 'By setting', icon: Rows3 },
  ];
  return (
    <div className="inline-flex gap-0.5 rounded-xl bg-muted p-[3px]" role="radiogroup" aria-label="Show own settings">
      {options.map((option) => {
        const on = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(option.value)}
            className={cn('flex items-center gap-1.5 rounded-[9px] px-3 py-1.5 text-[12.5px] font-semibold text-muted-foreground transition', on && 'bg-card text-foreground shadow-[0_2px_8px_-3px_rgba(15,23,42,0.27)]')}
          >
            <Icon className="h-[15px] w-[15px]" aria-hidden="true" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function OwnSettingsOverview({ config, projectName, onOpen, manage }: { config: OverviewConfig; projectName: (id: string) => string; onOpen: (projectId: string) => void; manage: boolean }) {
  const [view, setView] = useState<View>('grid');
  const { columns, rows } = ownSettingsGrid(config);
  if (!rows.length) return null;
  const byName = (a: string, b: string) => projectName(a).localeCompare(projectName(b));
  const sorted = [...rows].sort((a, b) => byName(a.projectId, b.projectId));
  const basisGroups = projectBasisRuleGroups(config.projectProfiles);
  const anyBasis = basisGroups.length > 0;
  const openLabel = (id: string) => `${manage ? 'View or change' : 'View'} ${projectName(id)}’s own settings`;
  const count = `${rows.length} project${rows.length === 1 ? ' has its' : 's have their'} own deduction settings`;

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-label={count}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-slate-200 bg-slate-50/70 px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-800" aria-hidden="true">
            <Building2 className="h-4 w-4" />
          </span>
          <h4 className="min-w-0 text-sm font-semibold text-slate-900">{count}</h4>
          <InfoTip label="About projects’ own settings">
            These projects use the default below except where shown. A change to the default never changes a figure a project sets for itself. A blank (—) follows the default; open a project to {manage ? 'view or change' : 'view'} its own settings.
          </InfoTip>
        </div>
        <ViewSwitch value={view} onChange={setView} />
      </div>

      {view === 'grid' ? (
        // `relative`: the screen-reader labels in blank cells are absolutely positioned — without a
        // positioned scroll box they escape its clipping and widen the whole page on a phone.
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left align-bottom">
                <th scope="col" className="sticky left-0 z-10 min-w-[10rem] border-b border-slate-200 bg-white px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 sm:min-w-[14rem] sm:px-4">
                  Project
                </th>
                {columns.map((column) => (
                  <th key={column.deductionTypeId} scope="col" className="min-w-[7.5rem] border-b border-l border-slate-200 px-3 py-2 font-normal">
                    <span className="block text-xs font-semibold leading-snug text-slate-800">{column.name}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">Default: {column.defaults.join(' · ')}</span>
                  </th>
                ))}
                {anyBasis ? (
                  <th scope="col" className="min-w-[10rem] border-b border-l border-slate-200 px-3 py-2 font-normal">
                    <span className="block text-xs font-semibold leading-snug text-slate-800">Value basis</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">Default: the default rules</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => {
                const rules = projectBasisRules(config.projectProfiles, row.projectId);
                // One line a row: the count of what it sets goes in the hover text (the row shows it).
                const label = `${openLabel(row.projectId)} (${ownSettingsCount(row)})`;
                return (
                  <tr key={row.projectId} className="align-middle">
                    <th scope="row" className="sticky left-0 z-10 border-b border-slate-100 bg-white px-2.5 py-1.5 text-left font-normal sm:px-4">
                      <button type="button" onClick={() => onOpen(row.projectId)} className="flex max-w-full items-center gap-1 text-left text-slate-900 hover:text-emerald-700 hover:underline" title={label} aria-label={label}>
                        {/* Three lines at most in a phone's narrow column; from sm one line, the column as wide as the name (to 22rem). */}
                        <span className="line-clamp-3 min-w-0 break-words text-[13px] font-medium leading-snug sm:block sm:max-w-[22rem] sm:truncate sm:text-sm">{projectName(row.projectId)}</span>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50 sm:h-4 sm:w-4" aria-hidden="true" />
                      </button>
                    </th>
                    {columns.map((column) => {
                      const changes = row.cells[column.deductionTypeId];
                      return (
                        <td key={column.deductionTypeId} className="border-b border-l border-slate-100 px-3 py-1.5">
                          {changes?.length ? (
                            <span className="flex flex-wrap gap-1">
                              {changes.map((change) => (
                                <OwnChip key={change.field} change={change} />
                              ))}
                            </span>
                          ) : (
                            <span className="text-slate-300" title="Follows the default">
                              —<span className="sr-only">the default</span>
                            </span>
                          )}
                        </td>
                      );
                    })}
                    {anyBasis ? (
                      <td className="border-b border-l border-slate-100 px-3 py-1.5">
                        {rules.length ? (
                          <span className="flex flex-wrap gap-1">
                            {rules.map((rule) => (
                              <BasisRule key={rule.id} rule={rule} billTypes={config.billTypes} compact />
                            ))}
                          </span>
                        ) : (
                          <span className="text-slate-300" title="Follows the default rules">
                            —<span className="sr-only">the default rules</span>
                          </span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {byHead(ownSettingsByChange(config)).map((head) => (
            <HeadSettings
              key={head.deductionTypeId}
              head={head.name}
              settings={head.groups.map((group) => ({
                key: `${group.change.field}|${group.change.value}`,
                setting: (
                  <>
                    <OwnChip change={group.change} />
                    <span>instead of {deductionChangeShort({ field: group.change.field, value: group.change.defaultValue })}</span>
                  </>
                ),
                projectIds: [...group.projectIds].sort(byName),
              }))}
              projectName={projectName}
              onOpen={onOpen}
              openLabel={openLabel}
            />
          ))}
          {basisGroups.length ? (
            <HeadSettings
              head="Value basis"
              settings={basisGroups.map((group) => ({ key: group.rule.id, setting: <BasisRule rule={group.rule} billTypes={config.billTypes} />, projectIds: [...group.projectIds].sort(byName) }))}
              projectName={projectName}
              onOpen={onOpen}
              openLabel={openLabel}
            />
          ) : null}
        </ul>
      )}
    </section>
  );
}

/** The groups of one head together (they come in the master's order of heads). */
const byHead = (groups: readonly OwnSettingGroup[]) =>
  groups.reduce<{ deductionTypeId: string; name: string; groups: OwnSettingGroup[] }[]>((heads, group) => {
    const last = heads[heads.length - 1];
    if (last?.deductionTypeId === group.deductionTypeId) last.groups.push(group);
    else heads.push({ deductionTypeId: group.deductionTypeId, name: group.name, groups: [group] });
    return heads;
  }, []);

/**
 * One head in the "By setting" view, named once: each value projects use instead of the default, with
 * the projects that use it — each opens that project's own settings.
 */
function HeadSettings({
  head,
  settings,
  projectName,
  onOpen,
  openLabel,
}: {
  head: string;
  settings: { key: string; setting: React.ReactNode; projectIds: string[] }[];
  projectName: (id: string) => string;
  onOpen: (projectId: string) => void;
  openLabel: (id: string) => string;
}) {
  return (
    <li className="grid grid-cols-1 gap-x-6 gap-y-2 px-3 py-3 sm:px-4 lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
      <p className="text-sm font-medium text-slate-900">{head}</p>
      <ul className="min-w-0 space-y-3">
        {settings.map((entry) => (
          <li key={entry.key} className="grid grid-cols-1 gap-1.5 md:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] md:gap-4">
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-slate-500">{entry.setting}</div>
              <p className="mt-1 text-[11px] text-slate-400">
                {entry.projectIds.length} project{entry.projectIds.length === 1 ? '' : 's'}
              </p>
            </div>
            <div className="flex min-w-0 flex-wrap content-start gap-1.5">
              {entry.projectIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onOpen(id)}
                  title={openLabel(id)}
                  className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-left text-xs font-medium text-slate-700 transition-colors hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"
                >
                  {projectName(id)}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </li>
  );
}

/**
 * On one project: what it sets for itself, its figure beside the default's, then its own value basis
 * rules. Everything else follows the default.
 */
export function ProjectOwnSettings({ name, heads, basisRules, billTypes }: { name: string; heads: readonly ProjectDeductionHead[]; basisRules: readonly ValueBasisRule[]; billTypes: readonly Pick<BillTypeMaster, 'id' | 'name'>[] }) {
  return (
    <section className="overflow-hidden rounded-xl border border-amber-200 bg-white shadow-sm">
      <div className="flex min-w-0 items-center gap-2.5 border-b border-amber-200 bg-amber-50/70 px-3 py-2.5 sm:px-4">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-800" aria-hidden="true">
          <Building2 className="h-4 w-4" />
        </span>
        <h4 className="min-w-0 text-sm font-semibold text-slate-900">
          {name} uses its own settings for {ownSettingsCount({ heads: heads.length, basisRules: basisRules.length })}
        </h4>
        <InfoTip label="About this project’s own settings">Everything else follows the default. Marked cells in the table below are this project’s own; Reset sends a head back to the default.</InfoTip>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <th scope="col" className="w-[32%] px-3 py-2 sm:px-4">Head</th>
              <th scope="col" className="w-[40%] px-3 py-2">This project</th>
              <th scope="col" className="px-3 py-2">Default</th>
            </tr>
          </thead>
          <tbody>
            {heads.map((head) => (
              <tr key={head.deductionTypeId} className="border-t border-slate-100 align-top">
                <th scope="row" className="px-3 py-2 text-left font-medium text-slate-900 sm:px-4">{head.name}</th>
                <td className="px-3 py-2">
                  <span className="flex flex-wrap gap-1">
                    {head.changes.map((change) => (
                      <OwnChip key={change.field} change={change} />
                    ))}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">{head.changes.map((change) => deductionChangeShort({ field: change.field, value: change.defaultValue })).join(' · ')}</td>
              </tr>
            ))}
            {basisRules.map((rule) => (
              <tr key={rule.id} className="border-t border-slate-100 align-top">
                <th scope="row" className="px-3 py-2 text-left font-medium text-slate-900 sm:px-4">Value basis</th>
                <td className="px-3 py-2">
                  <BasisRule rule={rule} billTypes={billTypes} />
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">The default rules</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
