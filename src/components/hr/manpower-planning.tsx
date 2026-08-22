'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Download, Loader2, Pencil, Plus, Target } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  HR_COLLECTIONS,
  financialYearForHrDate,
  isOpenRequirementStatus,
  summarizeManpowerPosition,
  summarizeRequirementFill,
  type HrManpowerPlan,
  type HrRequirement,
} from '@/lib/hr-requirement';
import { HrControlError, upsertManpowerPlan } from '@/lib/hr-requirement-service';
import { exportRowsToExcel } from '@/lib/report-excel';
import {
  HrDataList,
  HrEmptyState,
  HrFilterCard,
  HrKpiCard,
  HrLoader,
  HrMeter,
  HrPageHeader,
  hrDialog,
  type HrListColumn,
} from './hr-ui';
import { useHrCollection, useHrConfig, useHrPermissions } from './use-hr-config';

/**
 * Manpower planning, spec section 4.
 *
 * A plan line is (department or project) × designation, carrying the sanctioned strength that the
 * approval matrix later checks a requisition against (section 13). Existing strength is entered
 * rather than counted from the employee master on purpose: the plan records what was *approved and
 * known* when it was set, and a live headcount query would silently re-baseline the sanction every
 * time somebody resigned.
 *
 * The "under recruitment" column is live, though — it comes from open requirements, which is what
 * makes the vacancy figure actionable rather than historical.
 */

export default function ManpowerPlanning() {
  const { toast } = useToast();
  const { departments, projects, settings, loading: configLoading } = useHrConfig();
  const permissions = useHrPermissions();
  const { rows: plans, loading } = useHrCollection<HrManpowerPlan>(HR_COLLECTIONS.manpowerPlans);
  const { rows: requirements } = useHrCollection<HrRequirement>(HR_COLLECTIONS.requirements);

  const [financialYear, setFinancialYear] = useState(financialYearForHrDate());
  const [departmentId, setDepartmentId] = useState('all');
  const [projectId, setProjectId] = useState('all');
  const [editing, setEditing] = useState<HrManpowerPlan | null>(null);
  const [creating, setCreating] = useState(false);

  /** Open requirements per (scope × designation), so a plan row can show live recruitment. */
  const openPositions = useMemo(() => {
    const map = new Map<string, number>();
    for (const requirement of requirements) {
      if (!isOpenRequirementStatus(requirement.status)) continue;
      const fill = summarizeRequirementFill({
        requestedQuantity: requirement.requestedQuantity,
        joinedCount: requirement.joinedCount,
        cancelledPositions: requirement.cancelledPositions,
      });
      const key = `${requirement.projectId || requirement.departmentId}__${requirement.designation}`.toLowerCase();
      map.set(key, (map.get(key) || 0) + fill.balance);
    }
    return map;
  }, [requirements]);

  const decorated = useMemo(
    () =>
      plans
        .filter(plan => (financialYear === 'all' ? true : plan.financialYear === financialYear))
        .filter(plan => (departmentId === 'all' ? true : plan.departmentId === departmentId))
        .filter(plan => (projectId === 'all' ? true : plan.projectId === projectId))
        .map(plan => {
          const key = `${plan.projectId || plan.departmentId}__${plan.designation}`.toLowerCase();
          const position = summarizeManpowerPosition({
            approvedStrength: plan.approvedStrength,
            existing: plan.existingStrength,
            underRecruitment: openPositions.get(key) || 0,
            plannedAdditional: plan.plannedAdditional,
          });
          return { ...plan, position };
        })
        .sort(
          (a, b) =>
            (a.departmentName || a.projectName || '').localeCompare(b.departmentName || b.projectName || '') ||
            (a.designation || '').localeCompare(b.designation || ''),
        ),
    [plans, financialYear, departmentId, projectId, openPositions],
  );

  const totals = useMemo(
    () =>
      decorated.reduce(
        (accumulator, row) => ({
          sanctioned: accumulator.sanctioned + row.position.approvedStrength,
          existing: accumulator.existing + row.position.existing,
          planned: accumulator.planned + row.position.plannedAdditional,
          vacancy: accumulator.vacancy + row.position.shortage,
          critical: accumulator.critical + row.position.criticalShortage,
        }),
        { sanctioned: 0, existing: 0, planned: 0, vacancy: 0, critical: 0 },
      ),
    [decorated],
  );

  const years = useMemo(() => {
    const set = new Set(plans.map(plan => plan.financialYear).filter(Boolean));
    set.add(financialYearForHrDate());
    return Array.from(set).sort().reverse();
  }, [plans]);

  const columns: Array<HrListColumn<(typeof decorated)[number]>> = [
    {
      header: 'Scope',
      mobile: 'title',
      cell: row => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-800">{row.projectName || row.departmentName || '—'}</p>
          <p className="truncate text-xs text-muted-foreground">{row.projectName ? 'Project' : 'Department'}</p>
        </div>
      ),
    },
    { header: 'Designation', mobile: 'title', cell: row => row.designation },
    { header: 'Grade', className: 'hidden xl:table-cell', cell: row => row.grade || '—' },
    { header: 'Sanctioned', align: 'right', cell: row => <span className="tabular-nums font-medium">{row.position.approvedStrength}</span> },
    { header: 'On roll', align: 'right', cell: row => <span className="tabular-nums">{row.position.existing}</span> },
    { header: 'Planned +', align: 'right', className: 'hidden lg:table-cell', cell: row => <span className="tabular-nums">{row.position.plannedAdditional}</span> },
    {
      header: 'Vacancy',
      align: 'right',
      cell: row => (
        <span className={row.position.shortage > 0 ? 'font-medium tabular-nums text-rose-700' : 'tabular-nums text-muted-foreground'}>
          {row.position.shortage}
        </span>
      ),
    },
    {
      header: 'Under recruitment',
      align: 'right',
      className: 'hidden lg:table-cell',
      cell: row => <span className="tabular-nums">{row.position.underRecruitment}</span>,
    },
    {
      header: 'Critical gap',
      align: 'right',
      cell: row =>
        row.position.criticalShortage > 0 ? (
          <Badge variant="outline" className="border-rose-200 bg-rose-50 tabular-nums text-rose-800">
            {row.position.criticalShortage}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      header: 'Position',
      className: 'hidden xl:table-cell',
      mobile: 'aside',
      cell: row => (
        <span
          className={
            row.position.status === 'Critically short'
              ? 'text-xs font-medium text-rose-700'
              : row.position.status === 'Short staffed'
                ? 'text-xs font-medium text-amber-700'
                : 'text-xs text-muted-foreground'
          }
        >
          {row.position.status}
        </span>
      ),
    },
    {
      header: 'Fulfilment',
      className: 'hidden lg:table-cell',
      mobile: 'omit',
      cell: row => (
        <div className="w-24">
          <HrMeter label="" percent={row.position.fulfilmentPercent} />
        </div>
      ),
    },
    {
      header: 'Actions',
      mobile: 'footer',
      cell: row =>
        permissions.can('Edit', 'Manpower Planning') ? (
          <Button size="sm" variant="outline" className="gap-1" onClick={() => setEditing(row)}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];

  if (loading || configLoading) return <HrLoader label="Loading the manpower plan…" />;

  return (
    <div>
      <HrPageHeader
        title="Manpower Planning"
        description={`${decorated.length} plan ${decorated.length === 1 ? 'line' : 'lines'} · sanctioned ${totals.sanctioned} · on roll ${totals.existing} · vacancy ${totals.vacancy}`}
        actions={
          <>
            {permissions.can('Export', 'Manpower Planning') && (
              <Button
                variant="outline"
                className="gap-2"
                onClick={() =>
                  exportRowsToExcel(
                    'Manpower Plan',
                    decorated.map(row => ({
                      'Financial Year': row.financialYear,
                      Department: row.departmentName || '',
                      Project: row.projectName || '',
                      Designation: row.designation,
                      Grade: row.grade || '',
                      'Approved Strength': row.position.approvedStrength,
                      Existing: row.position.existing,
                      'Planned Additional': row.position.plannedAdditional,
                      Vacancy: row.position.shortage,
                      'Under Recruitment': row.position.underRecruitment,
                      'Critical Gap': row.position.criticalShortage,
                      Position: row.position.status,
                      Status: row.status,
                    })),
                  )
                }
              >
                <Download className="h-4 w-4" /> Export
              </Button>
            )}
            {permissions.can('Add', 'Manpower Planning') && (
              <Button className="gap-2" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" /> Add plan line
              </Button>
            )}
          </>
        }
      />

      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <HrKpiCard label="Sanctioned" value={totals.sanctioned} icon={Target} tone="blue" />
        <HrKpiCard label="On roll" value={totals.existing} tone="emerald" />
        <HrKpiCard label="Planned addition" value={totals.planned} tone="indigo" />
        <HrKpiCard label="Vacancy" value={totals.vacancy} tone="amber" />
        <HrKpiCard label="Critical gap" value={totals.critical} tone="rose" hint="No recruitment running" />
      </div>

      <HrFilterCard summary={`${decorated.length} of ${plans.length} lines`}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <Label className="text-xs">Financial year</Label>
            <Select value={financialYear} onValueChange={setFinancialYear}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All years</SelectItem>
                {years.map(year => (
                  <SelectItem key={year} value={year}>{year}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Department</Label>
            <Select value={departmentId} onValueChange={setDepartmentId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {departments.map(department => (
                  <SelectItem key={department.id} value={department.id}>{department.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All projects</SelectItem>
                {projects.map(project => (
                  <SelectItem key={project.id} value={project.id}>{project.projectName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </HrFilterCard>

      <HrDataList
        rows={decorated}
        columns={columns}
        rowClassName={row => (row.position.criticalShortage > 0 ? 'bg-rose-50/40' : undefined)}
        empty={
          <HrEmptyState
            icon={Target}
            title="No manpower plan lines yet"
            description="Set the sanctioned strength per designation so requirements can be checked against an approved plan."
            action={
              permissions.can('Add', 'Manpower Planning') ? (
                <Button size="sm" className="gap-2" onClick={() => setCreating(true)}>
                  <Plus className="h-4 w-4" /> Add plan line
                </Button>
              ) : undefined
            }
          />
        }
      />

      <PlanDialog
        open={creating || Boolean(editing)}
        plan={editing}
        defaultFinancialYear={financialYear === 'all' ? financialYearForHrDate() : financialYear}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </div>
  );
}

function PlanDialog({
  open,
  plan,
  defaultFinancialYear,
  onClose,
}: {
  open: boolean;
  plan: HrManpowerPlan | null;
  defaultFinancialYear: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { departments, projects, settings, actor } = useHrConfig();
  const [scope, setScope] = useState<'department' | 'project'>(plan?.projectId ? 'project' : 'department');
  const [departmentId, setDepartmentId] = useState(plan?.departmentId || '');
  const [projectId, setProjectId] = useState(plan?.projectId || '');
  const [designation, setDesignation] = useState(plan?.designation || '');
  const [grade, setGrade] = useState(plan?.grade || '');
  const [approvedStrength, setApprovedStrength] = useState(String(plan?.approvedStrength ?? ''));
  const [existingStrength, setExistingStrength] = useState(String(plan?.existingStrength ?? ''));
  const [plannedAdditional, setPlannedAdditional] = useState(String(plan?.plannedAdditional ?? ''));
  const [expectedExits, setExpectedExits] = useState(String(plan?.expectedExits ?? ''));
  const [remarks, setRemarks] = useState(plan?.remarks || '');
  const [status, setStatus] = useState<HrManpowerPlan['status']>(plan?.status || 'Draft');
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const submit = async () => {
    if (!actor) return;
    setSaving(true);
    try {
      await upsertManpowerPlan(
        {
          id: plan?.id,
          financialYear: plan?.financialYear || defaultFinancialYear,
          departmentId: scope === 'department' ? departmentId : departmentId || undefined,
          departmentName: departments.find(row => row.id === departmentId)?.name,
          projectId: scope === 'project' ? projectId : undefined,
          projectName: scope === 'project' ? projects.find(row => row.id === projectId)?.projectName : undefined,
          designation,
          grade: grade || undefined,
          approvedStrength: Number(approvedStrength) || 0,
          existingStrength: Number(existingStrength) || 0,
          plannedAdditional: Number(plannedAdditional) || 0,
          expectedExits: Number(expectedExits) || 0,
          remarks,
          status,
        },
        actor,
      );
      toast({ title: plan ? 'Plan line updated' : 'Plan line added' });
      onClose();
    } catch (error) {
      toast({
        title: 'Could not save',
        description: error instanceof HrControlError || error instanceof Error ? error.message : 'Something went wrong.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className={hrDialog.contentWide}>
        <DialogHeader className={hrDialog.header}>
          <DialogTitle>{plan ? 'Edit plan line' : 'Add plan line'}</DialogTitle>
          <DialogDescription>
            Spec section 4 — the sanctioned strength a requisition is checked against.
          </DialogDescription>
        </DialogHeader>

        <div className={hrDialog.bodyGrid}>
          <div>
            <Label className="text-xs">Plan for *</Label>
            <Select value={scope} onValueChange={value => setScope(value as typeof scope)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="department">A department</SelectItem>
                <SelectItem value="project">A project / site</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Department {scope === 'department' ? '*' : ''}</Label>
            <Select value={departmentId} onValueChange={setDepartmentId}>
              <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
              <SelectContent className="max-h-64">
                {departments.map(department => (
                  <SelectItem key={department.id} value={department.id}>{department.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {scope === 'project' && (
            <div className="sm:col-span-2">
              <Label className="text-xs">Project *</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {projects.map(project => (
                    <SelectItem key={project.id} value={project.id}>{project.projectName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label className="text-xs">Designation *</Label>
            {settings.masters.designations.length > 0 ? (
              <Select value={designation} onValueChange={setDesignation}>
                <SelectTrigger><SelectValue placeholder="Select designation" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {settings.masters.designations.map(value => (
                    <SelectItem key={value} value={value}>{value}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input value={designation} onChange={event => setDesignation(event.target.value)} />
            )}
          </div>

          <div>
            <Label className="text-xs">Grade</Label>
            <Input value={grade} onChange={event => setGrade(event.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Approved strength *</Label>
            <Input type="number" inputMode="decimal" min={0} value={approvedStrength} onChange={event => setApprovedStrength(event.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Existing (on roll) *</Label>
            <Input type="number" inputMode="decimal" min={0} value={existingStrength} onChange={event => setExistingStrength(event.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Planned additional</Label>
            <Input type="number" inputMode="decimal" min={0} value={plannedAdditional} onChange={event => setPlannedAdditional(event.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Expected exits</Label>
            <Input type="number" inputMode="decimal" min={0} value={expectedExits} onChange={event => setExpectedExits(event.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={value => setStatus(value as HrManpowerPlan['status'])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(['Draft', 'Approved', 'Revised', 'Closed'] as const).map(value => (
                  <SelectItem key={value} value={value}>{value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Remarks</Label>
            <Textarea rows={2} value={remarks} onChange={event => setRemarks(event.target.value)} />
          </div>
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={submit}
            disabled={saving || !designation || (scope === 'project' ? !projectId : !departmentId)}
            className="gap-2"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
