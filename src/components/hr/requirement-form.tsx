'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CircleDollarSign,
  FileText,
  Loader2,
  Save,
  Send,
  Sparkles,
  UserMinus,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  EMPLOYMENT_TYPES,
  HR_COLLECTIONS,
  HEADCOUNT_ADDING_TYPES,
  REPLACEMENT_REQUIREMENT_TYPES,
  REQUIREMENT_PRIORITIES,
  REQUIREMENT_REASONS,
  REQUIREMENT_TYPES,
  evaluateCtcAgainstBand,
  findDuplicateRequirements,
  hrCurrency,
  type HrRequirement,
  type RequirementBudget,
  type RequirementPriority,
  type RequirementReason,
  type RequirementType,
} from '@/lib/hr-requirement';
import {
  HrControlError,
  createRequirement,
  ctcBandForGrade,
  evaluateAgainstManpowerPlan,
  loadRequirement,
  submitRequirement,
  updateRequirement,
  type RequirementInput,
} from '@/lib/hr-requirement-service';
import { HrAlertNotice, HrLoader, HrPageHeader, HrSection } from './hr-ui';
import { useEmployees, useHrCollection, useHrConfig, useHrPermissions } from './use-hr-config';

/**
 * The create/edit wizard of spec sections 5–11.
 *
 * A wizard rather than one long form, as the spec asks: a requisition carries forty-odd fields, and
 * a single page of them is where a requesting manager gives up and rings HR instead. The five steps
 * mirror the spec's own sections, and the step strip stays clickable so nobody has to walk forwards
 * through four screens to fix a typo on the first.
 *
 * Validation is deliberately split. Per-step checks stop someone advancing past an obviously
 * incomplete step; the full rule set lives in `hr-requirement-service.ts` and runs on save, so the
 * same rules hold whether the requisition arrives from here, from the project-template generator or
 * from a future mobile screen.
 */

const STEPS = [
  { key: 'info', label: 'Requirement', icon: FileText },
  { key: 'position', label: 'Position', icon: Users },
  { key: 'skills', label: 'Skills', icon: Sparkles },
  { key: 'budget', label: 'Budget', icon: CircleDollarSign },
  { key: 'justification', label: 'Justification', icon: Check },
] as const;

type StepKey = (typeof STEPS)[number]['key'];

interface FormState {
  requirementDate: string;
  departmentId: string;
  projectId: string;
  siteName: string;
  location: string;
  requestingManagerId: string;
  requirementOwnerId: string;

  requirementType: RequirementType;
  requirementReason: RequirementReason | '';
  replacementEmployeeId: string;
  replacementLastWorkingDate: string;

  designation: string;
  jobTitle: string;
  grade: string;
  requestedQuantity: string;
  employmentType: HrRequirement['employmentType'];
  reportingToId: string;
  requiredJoiningDate: string;
  priority: RequirementPriority;
  shift: string;
  travelRequirement: string;
  genderRequirement: 'Any' | 'Male' | 'Female';
  genderRequirementJustification: string;
  minAge: string;
  maxAge: string;
  minExperienceYears: string;
  maxExperienceYears: string;
  qualification: string;
  specialization: string;

  primarySkills: string;
  secondarySkills: string;
  mandatorySkills: string;
  preferredSkills: string;
  domain: string;
  industryExperience: string;
  projectExperience: string;
  certifications: string;
  softwareKnowledge: string;
  equipmentExperience: string;

  expectedCtc: string;
  bandMin: string;
  bandMax: string;
  maximumApprovedCtc: string;
  costCentre: string;
  budgetAvailable: boolean;

  businessJustification: string;
  currentWorkload: string;
  projectRequirement: string;
  clientRequirement: string;
  whyExistingManpowerInsufficient: string;
  impactIfVacant: string;
  notes: string;
}

const EMPTY: FormState = {
  requirementDate: new Date().toISOString().slice(0, 10),
  departmentId: '',
  projectId: '',
  siteName: '',
  location: '',
  requestingManagerId: '',
  requirementOwnerId: '',
  requirementType: 'Replacement',
  requirementReason: '',
  replacementEmployeeId: '',
  replacementLastWorkingDate: '',
  designation: '',
  jobTitle: '',
  grade: '',
  requestedQuantity: '1',
  employmentType: 'Permanent',
  reportingToId: '',
  requiredJoiningDate: '',
  priority: 'Normal',
  shift: '',
  travelRequirement: '',
  genderRequirement: 'Any',
  genderRequirementJustification: '',
  minAge: '',
  maxAge: '',
  minExperienceYears: '',
  maxExperienceYears: '',
  qualification: '',
  specialization: '',
  primarySkills: '',
  secondarySkills: '',
  mandatorySkills: '',
  preferredSkills: '',
  domain: '',
  industryExperience: '',
  projectExperience: '',
  certifications: '',
  softwareKnowledge: '',
  equipmentExperience: '',
  expectedCtc: '',
  bandMin: '',
  bandMax: '',
  maximumApprovedCtc: '',
  costCentre: '',
  budgetAvailable: true,
  businessJustification: '',
  currentWorkload: '',
  projectRequirement: '',
  clientRequirement: '',
  whyExistingManpowerInsufficient: '',
  impactIfVacant: '',
  notes: '',
};

/** Comma-separated text ↔ string[], for the skill fields. */
const toList = (value: string) =>
  value
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);
const fromList = (value: string[] | undefined) => (value || []).join(', ');

export default function RequirementForm({ requirementId }: { requirementId?: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const { settings, departments, projects, users, actor, loading: configLoading } = useHrConfig();
  const permissions = useHrPermissions();
  const { employees } = useEmployees(true);
  const { rows: allRequirements } = useHrCollection<HrRequirement>(HR_COLLECTIONS.requirements);

  const editing = Boolean(requirementId);
  const [step, setStep] = useState<StepKey>('info');
  const [form, setForm] = useState<FormState>(EMPTY);
  const [existing, setExisting] = useState<HrRequirement | null>(null);
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false);
  const [planFacts, setPlanFacts] = useState<{ sanctioned?: number; existing?: number; aboveSanctionedStrength?: boolean } | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm(prev => ({ ...prev, [key]: value }));

  /**
   * Choosing a project fills the site and location from the global project record.
   *
   * Only when they are blank, so it never overwrites something the requester typed — an EPC project
   * can be recruiting for a location the project master does not name. Done here in the change
   * handler rather than in an effect: the repo's React rules forbid setting state from an effect body,
   * and this is a direct consequence of a user action anyway.
   */
  const selectProject = (projectId: string) => {
    const project = projects.find(row => row.id === projectId);
    setForm(prev => ({
      ...prev,
      projectId,
      siteName: prev.siteName || project?.projectSite || '',
      location: prev.location || project?.location || '',
    }));
  };

  /* ---------- load for edit ---------- */

  useEffect(() => {
    if (!requirementId) return;
    let cancelled = false;
    (async () => {
      const requirement = await loadRequirement(requirementId);
      if (cancelled) return;
      if (!requirement) {
        toast({ title: 'Not found', description: 'That requirement no longer exists.', variant: 'destructive' });
        router.push('/hr/requirements');
        return;
      }
      setExisting(requirement);
      setForm({
        ...EMPTY,
        requirementDate: requirement.requirementDate || EMPTY.requirementDate,
        departmentId: requirement.departmentId || '',
        projectId: requirement.projectId || '',
        siteName: requirement.siteName || '',
        location: requirement.location || '',
        requestingManagerId: requirement.requestingManagerId || '',
        requirementOwnerId: requirement.requirementOwnerId || '',
        requirementType: requirement.requirementType,
        requirementReason: requirement.requirementReason || '',
        replacementEmployeeId: requirement.replacement?.employeeId || '',
        replacementLastWorkingDate: requirement.replacement?.lastWorkingDate || '',
        designation: requirement.designation || '',
        jobTitle: requirement.jobTitle || '',
        grade: requirement.grade || '',
        requestedQuantity: String(requirement.requestedQuantity ?? 1),
        employmentType: requirement.employmentType,
        reportingToId: requirement.reportingToId || '',
        requiredJoiningDate: requirement.requiredJoiningDate || '',
        priority: requirement.priority,
        shift: requirement.shift || '',
        travelRequirement: requirement.travelRequirement || '',
        genderRequirement: requirement.genderRequirement || 'Any',
        genderRequirementJustification: requirement.genderRequirementJustification || '',
        minAge: requirement.minAge ? String(requirement.minAge) : '',
        maxAge: requirement.maxAge ? String(requirement.maxAge) : '',
        minExperienceYears: String(requirement.minExperienceYears ?? ''),
        maxExperienceYears: requirement.maxExperienceYears ? String(requirement.maxExperienceYears) : '',
        qualification: requirement.qualification || '',
        specialization: requirement.specialization || '',
        primarySkills: fromList(requirement.skills?.primarySkills),
        secondarySkills: fromList(requirement.skills?.secondarySkills),
        mandatorySkills: fromList(requirement.skills?.mandatorySkills),
        preferredSkills: fromList(requirement.skills?.preferredSkills),
        domain: requirement.skills?.domain || '',
        industryExperience: requirement.skills?.industryExperience || '',
        projectExperience: requirement.skills?.projectExperience || '',
        certifications: fromList(requirement.skills?.certifications),
        softwareKnowledge: fromList(requirement.skills?.softwareKnowledge),
        equipmentExperience: fromList(requirement.skills?.equipmentExperience),
        expectedCtc: requirement.budget?.expectedCtc ? String(requirement.budget.expectedCtc) : '',
        bandMin: requirement.budget?.bandMin ? String(requirement.budget.bandMin) : '',
        bandMax: requirement.budget?.bandMax ? String(requirement.budget.bandMax) : '',
        maximumApprovedCtc: requirement.budget?.maximumApprovedCtc ? String(requirement.budget.maximumApprovedCtc) : '',
        costCentre: requirement.budget?.costCentre || '',
        budgetAvailable: requirement.budget?.budgetAvailable !== false,
        businessJustification: requirement.justification?.businessJustification || '',
        currentWorkload: requirement.justification?.currentWorkload || '',
        projectRequirement: requirement.justification?.projectRequirement || '',
        clientRequirement: requirement.justification?.clientRequirement || '',
        whyExistingManpowerInsufficient: requirement.justification?.whyExistingManpowerInsufficient || '',
        impactIfVacant: requirement.justification?.impactIfVacant || '',
        notes: requirement.notes || '',
      });
      setLoading(false);
    })().catch(() => setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [requirementId, router, toast]);

  /* ---------- defaults from the signed-in user and the grade master ---------- */

  useEffect(() => {
    if (!editing && actor && !form.requestingManagerId) {
      set('requestingManagerId', actor.userId);
    }
  }, [actor, editing, form.requestingManagerId]);

  // The band follows the grade unless the requester has typed over it, so a grade change doesn't
  // leave a stale ceiling behind that the approval matrix would then route against.
  useEffect(() => {
    if (!form.grade) return;
    const band = ctcBandForGrade(settings, form.grade);
    if (band.max > 0) {
      setForm(prev => ({
        ...prev,
        bandMin: prev.bandMin && prev.grade === form.grade ? prev.bandMin : band.min ? String(band.min) : '',
        bandMax: prev.bandMax && prev.grade === form.grade ? prev.bandMax : String(band.max),
      }));
    }
  }, [form.grade, settings]);

  /* ---------- derived ---------- */

  const isReplacement = REPLACEMENT_REQUIREMENT_TYPES.includes(form.requirementType);
  const needsJustification =
    settings.general.requireJustificationForNewPositions && HEADCOUNT_ADDING_TYPES.includes(form.requirementType);

  const replacementEmployee = useMemo(
    () => employees.find(employee => employee.id === form.replacementEmployeeId) || null,
    [employees, form.replacementEmployeeId],
  );

  const bandCheck = useMemo(
    () =>
      evaluateCtcAgainstBand({
        proposedCtc: Number(form.expectedCtc) || 0,
        bandMin: Number(form.bandMin) || 0,
        bandMax: Number(form.bandMax) || 0,
        tolerancePercent: settings.compensation.tolerancePercent,
      }),
    [form.expectedCtc, form.bandMin, form.bandMax, settings.compensation.tolerancePercent],
  );

  /** Spec section 11 — advisory, never blocking. */
  const duplicates = useMemo(() => {
    if (!settings.general.warnOnDuplicateRequirement) return [];
    if (!form.departmentId || !form.designation) return [];
    return findDuplicateRequirements(
      {
        departmentId: form.departmentId,
        designation: form.designation,
        projectId: form.projectId || undefined,
        location: form.location || undefined,
      },
      allRequirements,
      { excludeId: requirementId },
    );
  }, [settings.general.warnOnDuplicateRequirement, form.departmentId, form.designation, form.projectId, form.location, allRequirements, requirementId]);

  // Sanctioned-strength position, shown to the requester before they submit so an above-plan
  // requisition is not a surprise that arrives as an extra Director in the approval chain.
  useEffect(() => {
    if (!actor || !form.designation || (!form.departmentId && !form.projectId)) {
      setPlanFacts(null);
      return;
    }
    let cancelled = false;
    evaluateAgainstManpowerPlan({
      organizationId: actor.organizationId,
      departmentId: form.departmentId,
      projectId: form.projectId || undefined,
      designation: form.designation,
      requestedQuantity: Number(form.requestedQuantity) || 1,
    })
      .then(facts => {
        if (!cancelled) setPlanFacts(facts);
      })
      .catch(() => {
        if (!cancelled) setPlanFacts(null);
      });
    return () => {
      cancelled = true;
    };
  }, [actor, form.designation, form.departmentId, form.projectId, form.requestedQuantity]);

  const buildInput = (): RequirementInput => {
    const department = departments.find(row => row.id === form.departmentId);
    const project = projects.find(row => row.id === form.projectId);
    const manager = users.find(row => row.id === form.requestingManagerId);
    const owner = users.find(row => row.id === form.requirementOwnerId);
    const reportingTo = users.find(row => row.id === form.reportingToId);

    const budget: RequirementBudget = {
      budgetedGrade: form.grade,
      bandMin: Number(form.bandMin) || 0,
      bandMax: Number(form.bandMax) || 0,
      expectedCtc: Number(form.expectedCtc) || 0,
      maximumApprovedCtc: Number(form.maximumApprovedCtc) || 0,
      costCentre: form.costCentre,
      budgetAvailable: form.budgetAvailable,
    };

    return {
      requirementDate: form.requirementDate,
      departmentId: form.departmentId,
      departmentName: department?.name || '',
      projectId: form.projectId || undefined,
      projectName: project?.projectName || undefined,
      siteName: form.siteName || undefined,
      location: form.location || project?.location || undefined,
      requestingManagerId: form.requestingManagerId,
      requestingManagerName: manager?.name || actor?.userName || '',
      requirementOwnerId: form.requirementOwnerId || undefined,
      requirementOwnerName: owner?.name || undefined,
      departmentHodId: department?.head || undefined,
      projectHeadId: project?.siteInCharge || undefined,
      requirementType: form.requirementType,
      requirementReason: (form.requirementReason || undefined) as RequirementReason | undefined,
      replacement: isReplacement && replacementEmployee
        ? {
            employeeId: replacementEmployee.id,
            employeeCode: replacementEmployee.employeeNo || replacementEmployee.employeeId,
            employeeName: replacementEmployee.name,
            designation: replacementEmployee.designation,
            currentCtc: replacementEmployee.grossSalary,
            reason: (form.requirementReason || 'Resignation') as RequirementReason,
            lastWorkingDate: form.replacementLastWorkingDate || undefined,
          }
        : null,
      designation: form.designation,
      jobTitle: form.jobTitle || form.designation,
      grade: form.grade,
      requestedQuantity: Number(form.requestedQuantity) || 1,
      employmentType: form.employmentType,
      reportingToId: form.reportingToId || undefined,
      reportingToName: reportingTo?.name || undefined,
      requiredJoiningDate: form.requiredJoiningDate,
      priority: form.priority,
      shift: form.shift || undefined,
      travelRequirement: form.travelRequirement || undefined,
      genderRequirement: form.genderRequirement,
      genderRequirementJustification: form.genderRequirementJustification || undefined,
      minAge: Number(form.minAge) || undefined,
      maxAge: Number(form.maxAge) || undefined,
      minExperienceYears: Number(form.minExperienceYears) || 0,
      maxExperienceYears: Number(form.maxExperienceYears) || undefined,
      qualification: form.qualification,
      specialization: form.specialization || undefined,
      skills: {
        primarySkills: toList(form.primarySkills),
        secondarySkills: toList(form.secondarySkills),
        mandatorySkills: toList(form.mandatorySkills),
        preferredSkills: toList(form.preferredSkills),
        domain: form.domain || undefined,
        industryExperience: form.industryExperience || undefined,
        projectExperience: form.projectExperience || undefined,
        certifications: toList(form.certifications),
        softwareKnowledge: toList(form.softwareKnowledge),
        equipmentExperience: toList(form.equipmentExperience),
      },
      budget,
      justification: {
        businessJustification: form.businessJustification || undefined,
        currentWorkload: form.currentWorkload || undefined,
        projectRequirement: form.projectRequirement || undefined,
        clientRequirement: form.clientRequirement || undefined,
        whyExistingManpowerInsufficient: form.whyExistingManpowerInsufficient || undefined,
        impactIfVacant: form.impactIfVacant || undefined,
      },
      duplicateAcknowledged: duplicates.length > 0 ? duplicateAcknowledged : undefined,
      notes: form.notes || undefined,
    } as RequirementInput;
  };

  /* ---------- save ---------- */

  const persist = async (thenSubmit: boolean) => {
    if (!actor) {
      toast({ title: 'Not signed in', description: 'Sign in again to continue.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      let id = requirementId;
      if (editing && id) {
        await updateRequirement(id, buildInput(), actor);
      } else {
        const created = await createRequirement(buildInput(), actor);
        id = created.id;
      }

      if (thenSubmit && id) {
        const result = await submitRequirement(id, actor, {
          departmentHodId: departments.find(row => row.id === form.departmentId)?.head,
          projectHeadId: projects.find(row => row.id === form.projectId)?.siteInCharge,
          requestingManagerId: form.requestingManagerId,
          roleByUserId: Object.fromEntries(users.map(row => [row.id, row.role || ''])),
        });
        toast({
          title: 'Submitted for approval',
          description: result.stageLabel ? `Now with ${result.stageLabel}.` : 'Approved.',
        });
      } else {
        toast({ title: editing ? 'Requirement updated' : 'Requirement saved', description: 'Saved as a draft.' });
      }

      router.push(id ? `/hr/requirements/${id}` : '/hr/requirements');
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

  /* ---------- per-step gating ---------- */

  const stepProblem = (key: StepKey): string | null => {
    switch (key) {
      case 'info':
        if (!form.departmentId) return 'Select the department.';
        if (!form.requestingManagerId) return 'Select the requesting manager.';
        if (isReplacement && !form.replacementEmployeeId) return 'Select the employee being replaced.';
        if (isReplacement && !form.requirementReason) return 'Select the replacement reason.';
        return null;
      case 'position':
        if (!form.designation.trim()) return 'Enter the designation.';
        if (!form.grade.trim()) return 'Select the grade.';
        if (!(Number(form.requestedQuantity) > 0)) return 'Enter how many positions are required.';
        if (!form.requiredJoiningDate) return 'Enter the required joining date.';
        if (!form.qualification.trim()) return 'Enter the minimum qualification.';
        if (form.minExperienceYears === '') return 'Enter the minimum experience.';
        if (form.genderRequirement !== 'Any' && !form.genderRequirementJustification.trim()) {
          return 'State the occupational justification for a gender-specific requirement.';
        }
        return null;
      case 'skills':
        if (toList(form.primarySkills).length === 0) return 'List at least one primary skill.';
        return null;
      case 'budget':
        return null;
      case 'justification':
        if (needsJustification && !form.businessJustification.trim()) return 'A business justification is required for a new position.';
        return null;
    }
  };

  const firstProblem = STEPS.map(entry => ({ key: entry.key, problem: stepProblem(entry.key) })).find(entry => entry.problem);
  const canSubmit = !firstProblem && (duplicates.length === 0 || duplicateAcknowledged);
  const stepIndex = STEPS.findIndex(entry => entry.key === step);

  const goNext = () => {
    const problem = stepProblem(step);
    if (problem) {
      toast({ title: 'Complete this step', description: problem, variant: 'destructive' });
      return;
    }
    const next = STEPS[Math.min(STEPS.length - 1, stepIndex + 1)];
    setStep(next.key);
  };

  if (loading || configLoading) return <HrLoader label="Loading requirement…" />;

  if (editing && existing && !['DRAFT', 'REJECTED'].includes(existing.status)) {
    return (
      <div>
        <HrPageHeader title={`Edit ${existing.requirementNumber}`} />
        <HrAlertNotice tone="amber" title="Not editable">
          A requirement that has been submitted for approval can only be changed by sending it back to
          the requester. Open the{' '}
          <Link href={`/hr/requirements/${existing.id}`} className="font-semibold underline">
            workspace
          </Link>{' '}
          to see where it is.
        </HrAlertNotice>
      </div>
    );
  }

  if (!editing && !permissions.can('Add', 'Requirements')) {
    return (
      <HrAlertNotice tone="rose" title="Access denied">
        You do not have permission to raise a manpower requirement.
      </HrAlertNotice>
    );
  }

  return (
    <div className="pb-24">
      <HrPageHeader
        title={editing ? `Edit ${existing?.requirementNumber || 'requirement'}` : 'New Manpower Requirement'}
        description="The requirement ID is generated automatically when the draft is saved."
        actions={
          <Button variant="outline" asChild>
            <Link href="/hr/requirements">Cancel</Link>
          </Button>
        }
      />

      {/* Step strip — clickable, so a correction on step 1 doesn't mean walking forwards again. */}
      <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
        {STEPS.map((entry, index) => {
          const Icon = entry.icon;
          const problem = stepProblem(entry.key);
          const active = entry.key === step;
          return (
            <button
              key={entry.key}
              type="button"
              onClick={() => setStep(entry.key)}
              className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                active
                  ? 'border-indigo-300 bg-indigo-50 text-indigo-800'
                  : problem
                    ? 'border-slate-200 bg-white/70 text-slate-600'
                    : 'border-emerald-200 bg-emerald-50/60 text-emerald-800'
              }`}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/80 text-[10px] font-semibold">
                {problem ? index + 1 : <Check className="h-3 w-3" />}
              </span>
              <Icon className="h-3.5 w-3.5" />
              {entry.label}
            </button>
          );
        })}
      </div>

      <div className="space-y-4">
        {/* ── Step 1: requirement information (spec section 5, 6) ── */}
        {step === 'info' && (
          <>
            <HrSection title="Requirement information" description="Spec section 5 — who is asking, and for where.">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <Label className="text-xs">Requirement date</Label>
                  <Input type="date" value={form.requirementDate} onChange={event => set('requirementDate', event.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Department *</Label>
                  <Select value={form.departmentId} onValueChange={value => set('departmentId', value)}>
                    <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                    <SelectContent>
                      {departments.map(department => (
                        <SelectItem key={department.id} value={department.id}>{department.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Project / site</Label>
                  <Select value={form.projectId || 'none'} onValueChange={value => selectProject(value === 'none' ? '' : value)}>
                    <SelectTrigger><SelectValue placeholder="Not project-specific" /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectItem value="none">Not project-specific</SelectItem>
                      {projects.map(project => (
                        <SelectItem key={project.id} value={project.id}>{project.projectName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    From Settings → Manage Project. Site and location follow the project.
                  </p>
                </div>
                <div>
                  <Label className="text-xs">Site</Label>
                  <Input value={form.siteName} onChange={event => set('siteName', event.target.value)} placeholder="e.g. Rayagada" />
                </div>
                <div>
                  <Label className="text-xs">Location</Label>
                  <Input value={form.location} onChange={event => set('location', event.target.value)} placeholder="Work location" />
                </div>
                <div>
                  <Label className="text-xs">Requesting manager *</Label>
                  <Select value={form.requestingManagerId} onValueChange={value => set('requestingManagerId', value)}>
                    <SelectTrigger><SelectValue placeholder="Select manager" /></SelectTrigger>
                    <SelectContent>
                      {users.map(row => (
                        <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Requirement owner (HOD)</Label>
                  <Select value={form.requirementOwnerId || 'none'} onValueChange={value => set('requirementOwnerId', value === 'none' ? '' : value)}>
                    <SelectTrigger><SelectValue placeholder="Department HOD" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not specified</SelectItem>
                      {users.map(row => (
                        <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </HrSection>

            <HrSection title="Requirement type" description="Spec section 6 — why this position is needed.">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <Label className="text-xs">Type *</Label>
                  <Select value={form.requirementType} onValueChange={value => set('requirementType', value as RequirementType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {REQUIREMENT_TYPES.map(value => (
                        <SelectItem key={value} value={value}>{value}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Reason {isReplacement && '*'}</Label>
                  <Select value={form.requirementReason || 'none'} onValueChange={value => set('requirementReason', value === 'none' ? '' : (value as RequirementReason))}>
                    <SelectTrigger><SelectValue placeholder="Select reason" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not specified</SelectItem>
                      {REQUIREMENT_REASONS.map(value => (
                        <SelectItem key={value} value={value}>{value}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Replacement block — appears only for a replacement type (control rule 63.11). */}
              {isReplacement && (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                    <UserMinus className="h-3.5 w-3.5" /> Replacement of
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="sm:col-span-2">
                      <Label className="text-xs">Employee *</Label>
                      <Select value={form.replacementEmployeeId} onValueChange={value => set('replacementEmployeeId', value)}>
                        <SelectTrigger><SelectValue placeholder="Search the employee master" /></SelectTrigger>
                        <SelectContent className="max-h-72">
                          {employees.map(employee => (
                            <SelectItem key={employee.id} value={employee.id}>
                              {employee.name} · {employee.employeeNo || employee.employeeId} · {employee.designation}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Last working date</Label>
                      <Input
                        type="date"
                        value={form.replacementLastWorkingDate}
                        onChange={event => set('replacementLastWorkingDate', event.target.value)}
                      />
                    </div>
                  </div>
                  {replacementEmployee && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {replacementEmployee.designation || 'Designation not recorded'} · {replacementEmployee.department || 'No department'}
                      {permissions.canViewSalary && replacementEmployee.grossSalary
                        ? ` · current CTC ${hrCurrency(replacementEmployee.grossSalary)}`
                        : ''}
                    </p>
                  )}
                </div>
              )}
            </HrSection>

            {/* Spec section 11 — advisory duplicate warning with the spec's three actions. */}
            {duplicates.length > 0 && (
              <HrAlertNotice tone="amber" title="Possible duplicate">
                <div className="space-y-2">
                  {duplicates.slice(0, 3).map(match => {
                    const fill = { required: match.requirement.requestedQuantity, joined: match.requirement.joinedCount || 0 };
                    return (
                      <p key={match.requirement.id}>
                        Requirement{' '}
                        <Link href={`/hr/requirements/${match.requirement.id}`} className="font-semibold underline">
                          {match.requirement.requirementNumber}
                        </Link>{' '}
                        already exists for {match.requirement.designation} with{' '}
                        {Math.max(0, fill.required - fill.joined)} open{' '}
                        {Math.max(0, fill.required - fill.joined) === 1 ? 'vacancy' : 'vacancies'}.
                      </p>
                    );
                  })}
                  <label className="flex items-center gap-2 pt-1">
                    <Checkbox
                      checked={duplicateAcknowledged}
                      onCheckedChange={value => setDuplicateAcknowledged(value === true)}
                    />
                    <span className="text-xs font-medium">
                      This is a separate requirement — continue with a new one.
                    </span>
                  </label>
                </div>
              </HrAlertNotice>
            )}
          </>
        )}

        {/* ── Step 2: position details (spec section 7) ── */}
        {step === 'position' && (
          <HrSection title="Position details" description="Spec section 7.">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label className="text-xs">Designation *</Label>
                {settings.masters.designations.length > 0 ? (
                  <Select value={form.designation} onValueChange={value => set('designation', value)}>
                    <SelectTrigger><SelectValue placeholder="Select designation" /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      {settings.masters.designations.map(value => (
                        <SelectItem key={value} value={value}>{value}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={form.designation} onChange={event => set('designation', event.target.value)} placeholder="e.g. Site Engineer" />
                )}
              </div>
              <div>
                <Label className="text-xs">Job title</Label>
                <Input value={form.jobTitle} onChange={event => set('jobTitle', event.target.value)} placeholder="Defaults to the designation" />
              </div>
              <div>
                <Label className="text-xs">Grade *</Label>
                {settings.masters.grades.length > 0 ? (
                  <Select value={form.grade} onValueChange={value => set('grade', value)}>
                    <SelectTrigger><SelectValue placeholder="Select grade" /></SelectTrigger>
                    <SelectContent>
                      {settings.masters.grades.map(value => (
                        <SelectItem key={value} value={value}>{value}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={form.grade} onChange={event => set('grade', event.target.value)} placeholder="e.g. M3" />
                )}
              </div>
              <div>
                <Label className="text-xs">Number required *</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={1}
                  value={form.requestedQuantity}
                  onChange={event => set('requestedQuantity', event.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Employment type *</Label>
                <Select value={form.employmentType} onValueChange={value => set('employmentType', value as HrRequirement['employmentType'])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EMPLOYMENT_TYPES.map(value => (
                      <SelectItem key={value} value={value}>{value}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Reporting to</Label>
                <Select value={form.reportingToId || 'none'} onValueChange={value => set('reportingToId', value === 'none' ? '' : value)}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not specified</SelectItem>
                    {users.map(row => (
                      <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Required joining date *</Label>
                <Input type="date" value={form.requiredJoiningDate} onChange={event => set('requiredJoiningDate', event.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Priority *</Label>
                <Select value={form.priority} onValueChange={value => set('priority', value as RequirementPriority)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REQUIREMENT_PRIORITIES.map(value => (
                      <SelectItem key={value} value={value}>
                        {value} · {settings.sla.targets[value]} day SLA
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Shift</Label>
                <Input value={form.shift} onChange={event => set('shift', event.target.value)} placeholder="e.g. General / Rotational" />
              </div>
              <div>
                <Label className="text-xs">Travel requirement</Label>
                <Input value={form.travelRequirement} onChange={event => set('travelRequirement', event.target.value)} placeholder="e.g. 40% site travel" />
              </div>
              <div>
                <Label className="text-xs">Minimum experience (years) *</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={form.minExperienceYears}
                  onChange={event => set('minExperienceYears', event.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Maximum experience (years)</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={form.maxExperienceYears}
                  onChange={event => set('maxExperienceYears', event.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Qualification *</Label>
                {settings.masters.qualifications.length > 0 ? (
                  <Select value={form.qualification} onValueChange={value => set('qualification', value)}>
                    <SelectTrigger><SelectValue placeholder="Select qualification" /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      {settings.masters.qualifications.map(value => (
                        <SelectItem key={value} value={value}>{value}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={form.qualification} onChange={event => set('qualification', event.target.value)} placeholder="e.g. B.E. Electrical" />
                )}
              </div>
              <div>
                <Label className="text-xs">Specialisation</Label>
                <Input value={form.specialization} onChange={event => set('specialization', event.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Age range</Label>
                <div className="flex gap-2">
                  <Input type="number" inputMode="decimal" placeholder="Min" value={form.minAge} onChange={event => set('minAge', event.target.value)} />
                  <Input type="number" inputMode="decimal" placeholder="Max" value={form.maxAge} onChange={event => set('maxAge', event.target.value)} />
                </div>
              </div>
            </div>

            {/* Gender requirement, gated behind a stated justification (spec section 7). */}
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <Label className="text-xs">Gender requirement</Label>
                <Select value={form.genderRequirement} onValueChange={value => set('genderRequirement', value as FormState['genderRequirement'])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Any">Any</SelectItem>
                    <SelectItem value="Male">Male</SelectItem>
                    <SelectItem value="Female">Female</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.genderRequirement !== 'Any' && (
                <div className="sm:col-span-2">
                  <Label className="text-xs">Occupational justification *</Label>
                  <Input
                    value={form.genderRequirementJustification}
                    onChange={event => set('genderRequirementJustification', event.target.value)}
                    placeholder="The legal or job-related reason this is a genuine requirement"
                  />
                </div>
              )}
            </div>

            {planFacts && (
              <div className="mt-4">
                {planFacts.aboveSanctionedStrength ? (
                  <HrAlertNotice tone="amber" title="Above sanctioned strength">
                    {planFacts.sanctioned === undefined
                      ? 'No manpower plan line exists for this designation, so this requirement will route as additional headcount.'
                      : `The plan sanctions ${planFacts.sanctioned} with ${planFacts.existing} on roll. This request exceeds the available headroom and will need budget and management approval.`}
                  </HrAlertNotice>
                ) : (
                  <HrAlertNotice tone="emerald" title="Within the manpower plan">
                    Sanctioned {planFacts.sanctioned}, on roll {planFacts.existing} — this request fits the approved plan.
                  </HrAlertNotice>
                )}
              </div>
            )}
          </HrSection>
        )}

        {/* ── Step 3: skills & experience (spec section 8) ── */}
        {step === 'skills' && (
          <HrSection title="Skills & experience" description="Spec section 8 — this also seeds the job description.">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div>
                <Label className="text-xs">Primary skills * (comma separated)</Label>
                <Textarea
                  rows={2}
                  value={form.primarySkills}
                  onChange={event => set('primarySkills', event.target.value)}
                  placeholder="Transmission Line, Substation, Project Planning"
                />
              </div>
              <div>
                <Label className="text-xs">Secondary skills</Label>
                <Textarea rows={2} value={form.secondarySkills} onChange={event => set('secondarySkills', event.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Mandatory skills</Label>
                <Textarea
                  rows={2}
                  value={form.mandatorySkills}
                  onChange={event => set('mandatorySkills', event.target.value)}
                  placeholder="Used to score talent-pool matches"
                />
              </div>
              <div>
                <Label className="text-xs">Preferred skills</Label>
                <Textarea rows={2} value={form.preferredSkills} onChange={event => set('preferredSkills', event.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Domain</Label>
                <Input value={form.domain} onChange={event => set('domain', event.target.value)} placeholder="e.g. Transmission & Substation" />
              </div>
              <div>
                <Label className="text-xs">Industry experience</Label>
                <Input value={form.industryExperience} onChange={event => set('industryExperience', event.target.value)} placeholder="e.g. EPC / Power" />
              </div>
              <div>
                <Label className="text-xs">Project experience</Label>
                <Input
                  value={form.projectExperience}
                  onChange={event => set('projectExperience', event.target.value)}
                  placeholder="e.g. 132KV and above"
                />
              </div>
              <div>
                <Label className="text-xs">Technical certifications</Label>
                <Input value={form.certifications} onChange={event => set('certifications', event.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Software knowledge</Label>
                <Input value={form.softwareKnowledge} onChange={event => set('softwareKnowledge', event.target.value)} placeholder="AutoCAD, MS Project" />
              </div>
              <div>
                <Label className="text-xs">Equipment experience</Label>
                <Input value={form.equipmentExperience} onChange={event => set('equipmentExperience', event.target.value)} />
              </div>
            </div>
          </HrSection>
        )}

        {/* ── Step 4: salary & budget (spec section 9) ── */}
        {step === 'budget' && (
          <HrSection
            title="Salary & budget"
            description="Spec section 9 — the band comes from the grade master; the expected CTC drives the approval route."
          >
            {!permissions.canViewSalary && (
              <div className="mb-3">
                <HrAlertNotice tone="blue" title="Limited visibility">
                  You can state an expected CTC, but the approved band and the replacement employee&apos;s
                  salary are only shown to users with salary-visibility permission.
                </HrAlertNotice>
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label className="text-xs">Expected CTC (annual)</Label>
                <Input type="number" inputMode="decimal" value={form.expectedCtc} onChange={event => set('expectedCtc', event.target.value)} />
              </div>
              {permissions.canViewSalary && (
                <>
                  <div>
                    <Label className="text-xs">Approved band — minimum</Label>
                    <Input type="number" inputMode="decimal" value={form.bandMin} onChange={event => set('bandMin', event.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">Approved band — maximum</Label>
                    <Input type="number" inputMode="decimal" value={form.bandMax} onChange={event => set('bandMax', event.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">Maximum approved CTC</Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      value={form.maximumApprovedCtc}
                      onChange={event => set('maximumApprovedCtc', event.target.value)}
                    />
                  </div>
                </>
              )}
              <div>
                <Label className="text-xs">Cost centre</Label>
                <Input value={form.costCentre} onChange={event => set('costCentre', event.target.value)} />
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 pb-2">
                  <Checkbox checked={form.budgetAvailable} onCheckedChange={value => set('budgetAvailable', value === true)} />
                  <span className="text-sm">Budget available</span>
                </label>
              </div>
            </div>

            {Number(form.expectedCtc) > 0 && Number(form.bandMax) > 0 && (
              <div className="mt-3 space-y-2">
                {bandCheck.requiresApproval ? (
                  <HrAlertNotice tone="rose" title="System alert">
                    {bandCheck.message} This requirement will route through Finance and management approval.
                  </HrAlertNotice>
                ) : (
                  <HrAlertNotice tone="emerald" title="Within band">
                    {bandCheck.message}
                  </HrAlertNotice>
                )}
                {Number(form.requestedQuantity) > 1 && permissions.canViewSalary && (
                  <p className="text-xs text-muted-foreground">
                    Annual manpower cost at {form.requestedQuantity} positions:{' '}
                    <span className="font-semibold text-slate-700">
                      {hrCurrency(Number(form.expectedCtc) * Number(form.requestedQuantity))}
                    </span>
                  </p>
                )}
              </div>
            )}
          </HrSection>
        )}

        {/* ── Step 5: justification (spec section 10) ── */}
        {step === 'justification' && (
          <HrSection
            title="Requirement justification"
            description={
              needsJustification
                ? 'Spec section 10 — mandatory for a new position.'
                : 'Spec section 10 — optional for a replacement, but it is what an approver reads first.'
            }
          >
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="lg:col-span-2">
                <Label className="text-xs">Business justification {needsJustification && '*'}</Label>
                <Textarea
                  rows={3}
                  value={form.businessJustification}
                  onChange={event => set('businessJustification', event.target.value)}
                  placeholder="Why this position is needed now"
                />
              </div>
              <div>
                <Label className="text-xs">Current workload</Label>
                <Textarea rows={2} value={form.currentWorkload} onChange={event => set('currentWorkload', event.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Project requirement</Label>
                <Textarea rows={2} value={form.projectRequirement} onChange={event => set('projectRequirement', event.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Client / contractual requirement</Label>
                <Textarea rows={2} value={form.clientRequirement} onChange={event => set('clientRequirement', event.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Why existing manpower cannot absorb this</Label>
                <Textarea
                  rows={2}
                  value={form.whyExistingManpowerInsufficient}
                  onChange={event => set('whyExistingManpowerInsufficient', event.target.value)}
                />
              </div>
              <div className="lg:col-span-2">
                <Label className="text-xs">Impact if the position stays vacant</Label>
                <Textarea rows={2} value={form.impactIfVacant} onChange={event => set('impactIfVacant', event.target.value)} />
              </div>
              <div className="lg:col-span-2">
                <Label className="text-xs">Notes</Label>
                <Textarea rows={2} value={form.notes} onChange={event => set('notes', event.target.value)} />
              </div>
            </div>

            <p className="mt-3 text-xs text-muted-foreground">
              Supporting documents — client contract, BOQ, organisation chart, resignation letter — can be
              attached from the requirement workspace once the draft is saved.
            </p>
          </HrSection>
        )}
      </div>

      {/* Sticky action bar. `hr-sticky-actions` clears the home indicator on a phone. */}
      <div className="hr-sticky-actions fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-3 py-2.5 backdrop-blur sm:px-6 lg:pl-[17rem]">
        <div className="flex items-center gap-2">
          <Button variant="outline" disabled={stepIndex === 0} onClick={() => setStep(STEPS[Math.max(0, stepIndex - 1)].key)} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>

          <div className="min-w-0 flex-1 text-center">
            {firstProblem ? (
              <p className="truncate text-xs text-muted-foreground">
                <AlertTriangle className="mr-1 inline h-3 w-3 text-amber-500" />
                {firstProblem.problem}
              </p>
            ) : duplicates.length > 0 && !duplicateAcknowledged ? (
              <p className="truncate text-xs text-amber-700">Acknowledge the possible duplicate to continue.</p>
            ) : (
              <p className="truncate text-xs text-emerald-700">Ready to submit for approval.</p>
            )}
          </div>

          {stepIndex < STEPS.length - 1 ? (
            <Button onClick={goNext} className="gap-1.5">
              Next <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <>
              <Button variant="outline" disabled={saving} onClick={() => persist(false)} className="gap-1.5">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save draft
              </Button>
              <Button disabled={saving || !canSubmit} onClick={() => persist(true)} className="gap-1.5">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Spacer so the sticky bar never covers the last field. */}
      <Card className="mt-4 border-none bg-transparent shadow-none">
        <CardContent className="h-4 p-0" />
      </Card>
    </div>
  );
}
