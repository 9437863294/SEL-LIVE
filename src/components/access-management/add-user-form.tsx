'use client';

/**
 * Create a user, then hand them back to whatever sent you here (§14).
 *
 * The handover is the point: an administrator setting up a new site engineer otherwise creates the
 * account in User Management, navigates back, searches for the name they just typed, and only then
 * assigns access. This creates the account and returns with that user already selected, so the next
 * click is the assignment.
 *
 * It does not replace User Management's own dialog and does not change it. Both write the same fields
 * to `users/{uid}` through the same Identity Toolkit call, so a user created here is indistinguishable
 * from one created there — which is what makes keeping both safe.
 *
 * ── Why this is a page and not a dialog ─────────────────────────────────────────────────────────
 *
 * It was a dialog. It is the longest form in the application — an employee picker over ~1,300 people,
 * eleven fields, and then the entire role library — and a dialog is the wrong container for that at
 * any width. Three concrete problems, not matters of taste:
 *
 *   1. **Two nested scrolling regions.** The employee list and the role picker each scroll inside a
 *      body that also scrolls, so a wheel gesture near either one does something unpredictable.
 *   2. **No address.** "Open the add-user form for this employee" was not a link, so it could not be
 *      shared, bookmarked, or returned to after a mis-click dismissed it and lost the typed fields.
 *   3. **Nowhere to grow.** A modal is capped at the viewport by definition, and this form is only
 *      going to get longer.
 *
 * The form itself is exported separately from the page so the layout is the only thing that changed.
 */

import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCheck, Copy, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import type { Department, Project, Role, User } from '@/lib/types';
import { createUserWithAccess, type AccessActor } from '@/lib/access-control-service';
import type { LinkableEmployeeRow, ReportingManagerInfo } from '@/lib/greythr-sync-client';
import { RolePicker } from './pickers';
import { CategoryChips, EmployeePicker } from './employee-picker';

/* The same generator User Management uses — ambiguous characters excluded so a password read off a
 * screen and typed by hand does not fail on I/l/0/O. */
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghjkmnpqrstuvwxyz';
const NUMS = '23456789';
const SYMS = '@#$%!&';

function generatePassword(): string {
  const pick = (set: string) => set[Math.floor(Math.random() * set.length)];
  const chars = [
    pick(UPPER), pick(UPPER), pick(UPPER),
    pick(LOWER), pick(LOWER), pick(LOWER), pick(LOWER),
    pick(NUMS), pick(NUMS), pick(NUMS),
    pick(SYMS), pick(SYMS),
  ];
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [chars[index], chars[swap]] = [chars[swap], chars[index]];
  }
  return chars.join('');
}

export interface AddUserFormProps {
  roles: Role[];
  departments: Department[];
  designations: string[];
  projects: Project[];
  users: User[];
  actor: AccessActor;
  /** Called with the new user so the caller can select it and continue assigning (§14). */
  onCreated: (user: User) => void;
  /** Abandon and go back. */
  onCancel: () => void;
}

export function AddUserForm({
  roles,
  departments,
  designations,
  projects,
  users,
  actor,
  onCreated,
  onCancel,
}: AddUserFormProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const [form, setForm] = useState({
    employeeId: '',
    employeeNo: '',
    name: '',
    email: '',
    mobile: 'N/A',
    password: '',
    baseRole: '',
    departmentId: '',
    designation: '',
    reportingManagerId: '',
    location: '',
    projectId: '',
    status: 'Active' as 'Active' | 'Inactive',
  });
  const [additionalRoleIds, setAdditionalRoleIds] = useState<string[]>([]);

  /**
   * The greytHR employee this account is being created for.
   *
   * When set, the user record carries an explicit `employeeId` link — so the sync no longer has to
   * infer the relationship from an email address, which is the fragile join it was stuck with.
   */
  const [employee, setEmployee] = useState<LinkableEmployeeRow | null>(null);
  const [employeeCategories, setEmployeeCategories] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<'greythr' | 'manual'>('greythr');
  /**
   * The picked employee's reporting manager, kept even when they have no platform login.
   *
   * `form.reportingManagerId` can only ever be a real user id, because it feeds a `<Select>` of real
   * accounts — there is nothing to select for a manager who has not been onboarded yet. This is kept
   * alongside so that case can still say something ("reports to Priya Kumar — no login yet") instead
   * of leaving the field blank with no explanation.
   */
  const [reportingManagerInfo, setReportingManagerInfo] = useState<ReportingManagerInfo | null>(null);

  // One password per visit to the page. Regenerating on every render would change it under an
  // administrator who had already copied it.
  useEffect(() => {
    setForm((current) => ({ ...current, password: generatePassword() }));
    setCopied(false);
  }, []);

  /**
   * Prefill from the chosen employee.
   *
   * Matching by *name* for department and project, because greytHR is the authority on what those
   * are called and this app's own masters were populated from the same source. A greytHR value with
   * no local counterpart is still shown on the employee record — it just cannot be turned into a
   * department id or a project id, so those selects stay empty; a note under each one says so rather
   * than leaving a silent blank that reads as a bug.
   *
   * Designation is different — it is not an id lookup, it is a plain string written straight to
   * `form.designation`. The failure mode there was a Radix `<Select>` gotcha, not a missing record:
   * its `value` prop has to match one of its options *exactly*, and greytHR's designation string is
   * not guaranteed to be byte-identical to whatever the shared `designations` list happens to hold
   * (case, trailing space, or simply a value this app has never seen before). `designationOptions`
   * below guarantees a match by construction — see there — so this only needs to normalise onto an
   * existing entry when one already matches, to avoid listing "Site Accountant" and "SITE ACCOUNTANT"
   * as two different options for what is one designation.
   */
  const applyEmployee = useCallback(
    (
      picked: LinkableEmployeeRow | null,
      categories: Record<string, string>,
      reportingManager?: ReportingManagerInfo | null,
    ) => {
      setEmployee(picked);
      setEmployeeCategories(categories);
      setReportingManagerInfo(reportingManager ?? null);

      if (!picked) {
        setForm((current) => ({ ...current, employeeId: '', employeeNo: '', reportingManagerId: '' }));
        return;
      }

      const department = departments.find(
        (entry) => entry.name.trim().toLowerCase() === picked.department.trim().toLowerCase(),
      );
      const project = projects.find(
        (entry) => (entry.projectName || '').trim().toLowerCase() === picked.projectName.trim().toLowerCase(),
      );
      const designation =
        designations.find((entry) => entry.trim().toLowerCase() === picked.designation.trim().toLowerCase()) ??
        picked.designation;

      setForm((current) => ({
        ...current,
        employeeId: picked.employeeId,
        employeeNo: picked.employeeNo,
        name: picked.name || current.name,
        email: picked.email || current.email,
        mobile: picked.phone || current.mobile,
        designation: designation || current.designation,
        location: picked.location || current.location,
        departmentId: department?.id ?? '',
        projectId: project?.id ?? '',
        // Blank when the manager has no login yet — `reportingManagerInfo` still carries their name
        // so the screen can say who, even though there is nobody to select.
        reportingManagerId: reportingManager?.userId ?? '',
      }));
    },
    [departments, designations, projects],
  );

  /**
   * The Designation select's own option list, with the picked value guaranteed present.
   *
   * The shared `designations` list (from `useAccessDirectory`) feeds scope-grant pickers elsewhere in
   * Access Management too, so it is not mutated here — this is a local copy for this one control. If
   * greytHR's value is not already in it, it is appended rather than left to render as a blank Select
   * next to a form that quietly does hold the right value in `form.designation`.
   */
  const designationOptions = useMemo(() => {
    if (!form.designation || designations.includes(form.designation)) return designations;
    return [...designations, form.designation].sort((a, b) => a.localeCompare(b));
  }, [designations, form.designation]);

  /**
   * The manager dropdown renders at most 300 rows so the popover stays responsive on a ~1,300-user
   * directory — the search narrows the list rather than the cap hiding people silently.
   */
  const [managerSearch, setManagerSearch] = useState('');
  const managerCandidates = useMemo(() => {
    const query = managerSearch.trim().toLowerCase();
    return users
      .filter((user) => user.status !== 'Inactive')
      .filter(
        (user) =>
          !query || [user.name, user.email].filter(Boolean).join(' ').toLowerCase().includes(query),
      );
  }, [users, managerSearch]);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const activeRoles = useMemo(
    () => roles.filter((role) => role.status !== 'Inactive' && role.status !== 'Disabled'),
    [roles],
  );

  /*
   * There is no `reset()` any more.
   *
   * The dialog needed one because it was reused across openings; a page is torn down when you leave
   * it, so navigation is the reset. Keeping the old function would have been dead code that looked
   * like the safety net for a case that no longer exists.
   */

  const handleCreate = async () => {
    if (!form.name.trim() || !form.email.trim() || !form.baseRole) {
      toast({
        title: 'Missing details',
        description: 'Name, email and a base role are required.',
        variant: 'destructive',
      });
      return;
    }
    // This email becomes a Firebase Auth account and the welcome-mail recipient — a typo here is a
    // login that can never be used, so it is cheaper to reject it now than to delete the account.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      toast({
        title: 'Invalid email',
        description: `“${form.email.trim()}” does not look like an email address.`,
        variant: 'destructive',
      });
      return;
    }
    setSaving(true);
    try {
      const { user } = await createUserWithAccess(
        {
          name: form.name.trim(),
          email: form.email.trim(),
          password: form.password,
          mobile: form.mobile.trim(),
          baseRole: form.baseRole,
          status: form.status,
          additionalRoleIds,
          departmentIds: form.departmentId ? [form.departmentId] : [],
          designations: form.designation ? [form.designation] : [],
          projectIds: form.projectId ? [form.projectId] : [],
          reportingManagerId: form.reportingManagerId || undefined,
          location: form.location || undefined,
          // The explicit greytHR link, when the account was created from an employee record.
          employeeId: form.employeeId || undefined,
          employeeNo: form.employeeNo || undefined,
        },
        actor,
      );

      toast({
        title: 'User created',
        description: `${user.name} is ready. Returning so you can assign access now.`,
      });
      onCreated(user);
    } catch (error) {
      toast({
        title: 'Could not create user',
        description: error instanceof Error ? error.message : 'Unexpected error.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Sections rather than one undifferentiated column: on a page there is room to say what each
          group of fields is for, which a modal never had. */}
      <FormSection
        title="Who is this account for?"
        description="greytHR first — it fills in the details and establishes the link that carries a resignation through to this login. Manual entry is for contractors and anyone not in the HR system."
      >
          <div className="rounded-xl border border-white/70 bg-white/70 p-1">
            <div className="grid max-w-md grid-cols-2 gap-1">
              {(
                [
                  { id: 'greythr', label: 'From greytHR employee' },
                  { id: 'manual', label: 'Enter manually' },
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    setMode(option.id);
                    if (option.id === 'manual') applyEmployee(null, {});
                  }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    mode === option.id
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {mode === 'greythr' && (
            <div className="space-y-2">
              <Label>greytHR employee</Label>
              <EmployeePicker value={employee} onSelect={applyEmployee} disabled={saving} />
              {employee && Object.keys(employeeCategories).length > 0 && (
                <div className="rounded-xl border border-white/70 bg-white/70 p-2.5">
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Everything greytHR holds for them today
                  </p>
                  <CategoryChips categories={employeeCategories} />
                </div>
              )}
            </div>
          )}

          {mode === 'greythr' && !employee && (
            <p className="text-[11px] text-muted-foreground">
              Pick an employee above and the fields below fill in automatically. Only active employees
              without an existing login are listed.
            </p>
          )}
      </FormSection>

      <FormSection title="Identity" description="What they sign in with.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-user-name">Name *</Label>
              <Input
                id="new-user-name"
                value={form.name}
                onChange={(event) => set('name', event.target.value)}
                placeholder="e.g. Amit Kumar"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-user-email">Email *</Label>
              <Input
                id="new-user-email"
                type="email"
                value={form.email}
                onChange={(event) => set('email', event.target.value)}
                placeholder="amit@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-user-employee-id">Employee no.</Label>
              <Input
                id="new-user-employee-id"
                value={form.employeeNo}
                onChange={(event) => set('employeeNo', event.target.value)}
                readOnly={!!employee}
                className={employee ? 'bg-slate-50' : undefined}
                placeholder={employee ? '' : 'Optional — no greytHR link'}
              />
              <p className="text-[11px] text-muted-foreground">
                {employee
                  ? `Linked to greytHR employee ${employee.employeeId}. Their resignation will reach this login automatically.`
                  : 'Without a greytHR link, this account is matched to an employee by email address only.'}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-user-mobile">Mobile</Label>
              <Input
                id="new-user-mobile"
                value={form.mobile}
                onChange={(event) => set('mobile', event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="new-user-password">Auto-generated password</Label>
              <span className="text-[11px] text-muted-foreground">Emailed to the user</span>
            </div>
            <div className="flex gap-2">
              <Input
                id="new-user-password"
                value={form.password}
                readOnly
                className="flex-1 border-dashed bg-slate-50 font-mono tracking-widest"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                title="Copy password"
                onClick={() => {
                  void navigator.clipboard.writeText(form.password);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? <CheckCheck className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                title="Generate a new password"
                onClick={() => {
                  set('password', generatePassword());
                  setCopied(false);
                }}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
      </FormSection>

      <FormSection
        title="Role and placement"
        description="The base role is their primary one, written exactly as User Management writes it. Department, designation and project also decide what any scoped rules confer on them."
      >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Base role *</Label>
              <Select value={form.baseRole} onValueChange={(value) => set('baseRole', value)}>
                <SelectTrigger><SelectValue placeholder="Select the primary role" /></SelectTrigger>
                <SelectContent>
                  {activeRoles.map((role) => (
                    <SelectItem key={role.id} value={role.name}>{role.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Written to the user's own <code>role</code> field, exactly as User Management does. This
                is their primary role; anything else goes on top of it.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(value) => set('status', value as 'Active' | 'Inactive')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Department</Label>
              {/* Every optional select offers "None": without it, a value picked once could only be
                  cleared by abandoning the page. Radix reserves the empty string, hence the sentinel. */}
              <Select
                value={form.departmentId || undefined}
                onValueChange={(value) => set('departmentId', value === 'none' ? '' : value)}
              >
                <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {departments.map((department) => (
                    <SelectItem key={department.id} value={department.id}>{department.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* Only shown when greytHR named a department and it genuinely has no local match —
                  otherwise a blank select with no explanation reads as this screen having failed to
                  fill it in, when the real answer is "there is nothing to select yet". */}
              {employee?.department && !form.departmentId && (
                <p className="text-[11px] text-amber-700">
                  greytHR: {employee.department} — no matching department record.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Designation</Label>
              <Select
                value={form.designation || undefined}
                onValueChange={(value) => set('designation', value === 'none' ? '' : value)}
              >
                <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {designationOptions.map((designation) => (
                    <SelectItem key={designation} value={designation}>{designation}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Reporting manager</Label>
              <Input
                value={managerSearch}
                onChange={(event) => setManagerSearch(event.target.value)}
                placeholder="Search by name or email…"
              />
              <Select
                value={form.reportingManagerId || undefined}
                onValueChange={(value) => set('reportingManagerId', value === 'none' ? '' : value)}
              >
                <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {managerCandidates.slice(0, 300).map((user) => (
                    <SelectItem key={user.id} value={user.id}>{user.name || user.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {managerCandidates.length > 300 && (
                <p className="text-[11px] text-muted-foreground">
                  Showing the first 300 of {managerCandidates.length} — search to find anyone else.
                </p>
              )}
              {/* greytHR knows who they report to, but that person has no platform login to select —
                  the name is worth showing even though the field itself has to stay empty. */}
              {reportingManagerInfo && !form.reportingManagerId && (
                <p className="text-[11px] text-amber-700">
                  greytHR: reports to {reportingManagerInfo.name || `employee ${reportingManagerInfo.employeeId}`}
                  {' '}— no platform login yet.
                </p>
              )}
              {employee && !reportingManagerInfo && (
                <p className="text-[11px] text-muted-foreground">
                  Not recorded in greytHR for this employee.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Project / site</Label>
              <Select
                value={form.projectId || undefined}
                onValueChange={(value) => set('projectId', value === 'none' ? '' : value)}
              >
                <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.projectName || project.siteCode || project.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {employee?.projectName && !form.projectId && (
                <p className="text-[11px] text-amber-700">
                  greytHR: {employee.projectName} — no matching project record.
                </p>
              )}
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="new-user-location">Location</Label>
              <Input
                id="new-user-location"
                value={form.location}
                onChange={(event) => set('location', event.target.value)}
                placeholder="e.g. Bhubaneswar"
              />
            </div>
          </div>
      </FormSection>

      <FormSection
        title="Additional roles"
        description="Optional, and added on top of the base role — never instead of it. These can also be assigned later; nothing here has to be decided now."
        badge={
          additionalRoleIds.length > 0 ? (
            <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
              {additionalRoleIds.length} selected
            </Badge>
          ) : null
        }
      >
        {/* Taller than it was in the dialog: this is the control administrators spend the most time
            in and a page has the room the modal did not. */}
        <RolePicker
          roles={activeRoles}
          selectedIds={additionalRoleIds}
          onSelectionChange={setAdditionalRoleIds}
          heightClassName="h-64"
        />
      </FormSection>

      {/*
        Sticky, because the form is long enough to scroll and a save button that scrolls off the
        bottom is a save button an administrator has to hunt for. `bottom-0` with a blurred backdrop
        rather than a fixed bar, so it sits inside the page's own scroll container.
      */}
      <div className="sticky bottom-0 -mx-1 flex flex-col gap-2 border-t border-white/70 bg-white/85 px-1 py-3 backdrop-blur-sm sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onCancel} disabled={saving} className="sm:w-32">
          Cancel
        </Button>
        <Button onClick={handleCreate} disabled={saving} className="sm:w-40">
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Create user
        </Button>
      </div>
    </div>
  );
}

/** A titled group of fields. Exists so the page reads as sections rather than one long column. */
function FormSection({
  title,
  description,
  badge,
  children,
}: {
  title: string;
  description?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/60 bg-white/80 p-4 shadow-sm backdrop-blur-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {badge}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
