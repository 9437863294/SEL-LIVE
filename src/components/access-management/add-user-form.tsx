'use client';

/**
 * Create a user without leaving the access screen (§14).
 *
 * The point of having this here at all is the handover it avoids: an administrator setting up a new
 * site engineer otherwise creates the account in User Management, navigates back, searches for the
 * name they just typed, and only then assigns access. This creates the account and hands the new
 * user back already selected, so the next click is the assignment.
 *
 * It does not replace User Management's own dialog and does not change it. Both write the same five
 * fields to `users/{uid}` through the same Identity Toolkit call, so a user created here is
 * indistinguishable from one created there — which is what makes keeping both safe.
 */

import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCheck, Copy, Loader2, RefreshCw, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { hrDialog } from '@/components/hr/hr-ui';
import { useToast } from '@/hooks/use-toast';
import { app } from '@/lib/firebase';
import type { Department, Project, Role, User } from '@/lib/types';
import { createUserWithAccess, type AccessActor } from '@/lib/access-control-service';
import type { LinkableEmployeeRow } from '@/lib/greythr-sync-client';
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

export interface AddUserDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: Role[];
  departments: Department[];
  designations: string[];
  projects: Project[];
  users: User[];
  actor: AccessActor;
  /** Called with the new user so the caller can select it and continue assigning (§14). */
  onCreated: (user: User) => void;
}

export function AddUserDrawer({
  open,
  onOpenChange,
  roles,
  departments,
  designations,
  projects,
  users,
  actor,
  onCreated,
}: AddUserDrawerProps) {
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

  useEffect(() => {
    if (!open) return;
    setForm((current) => ({ ...current, password: generatePassword() }));
    setCopied(false);
  }, [open]);

  /**
   * Prefill from the chosen employee.
   *
   * Matching by *name* for department, designation and project, because greytHR is the authority on
   * what those are called and this app's own masters were populated from the same source. A greytHR
   * value with no local counterpart is still shown on the employee record — it just cannot be turned
   * into a department id or a project id, so those selects stay empty rather than guessing.
   */
  const applyEmployee = useCallback(
    (picked: LinkableEmployeeRow | null, categories: Record<string, string>) => {
      setEmployee(picked);
      setEmployeeCategories(categories);

      if (!picked) {
        setForm((current) => ({ ...current, employeeId: '', employeeNo: '' }));
        return;
      }

      const department = departments.find(
        (entry) => entry.name.trim().toLowerCase() === picked.department.trim().toLowerCase(),
      );
      const project = projects.find(
        (entry) => (entry.projectName || '').trim().toLowerCase() === picked.projectName.trim().toLowerCase(),
      );

      setForm((current) => ({
        ...current,
        employeeId: picked.employeeId,
        employeeNo: picked.employeeNo,
        name: picked.name || current.name,
        email: picked.email || current.email,
        mobile: picked.phone || current.mobile,
        designation: picked.designation || current.designation,
        location: picked.location || current.location,
        departmentId: department?.id ?? '',
        projectId: project?.id ?? '',
      }));
    },
    [departments, projects],
  );

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const activeRoles = useMemo(
    () => roles.filter((role) => role.status !== 'Inactive' && role.status !== 'Disabled'),
    [roles],
  );

  const reset = () => {
    setForm({
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
      status: 'Active',
    });
    setAdditionalRoleIds([]);
    setEmployee(null);
    setEmployeeCategories({});
    setMode('greythr');
  };

  const handleCreate = async () => {
    if (!form.name.trim() || !form.email.trim() || !form.baseRole) {
      toast({
        title: 'Missing details',
        description: 'Name, email and a base role are required.',
        variant: 'destructive',
      });
      return;
    }
    setSaving(true);
    try {
      const { user } = await createUserWithAccess(
        {
          name: form.name,
          email: form.email,
          password: form.password,
          mobile: form.mobile,
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
        { apiKey: String(app.options.apiKey), roles },
      );

      toast({
        title: 'User created',
        description: `${user.name} is ready. They are selected below so you can assign access now.`,
      });
      reset();
      onOpenChange(false);
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
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : (reset(), onOpenChange(false)))}>
      <DialogContent className={hrDialog.contentWide}>
        <DialogHeader className={hrDialog.header}>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-indigo-600" />
            Add user
          </DialogTitle>
          <DialogDescription>
            Creates the login and the profile, then returns here with the new user selected. A welcome
            email with the credentials is sent automatically.
          </DialogDescription>
        </DialogHeader>

        <div className={hrDialog.body}>
          {/* Where the person comes from. greytHR first, because that is the correct path — manual
              entry exists for contractors and anyone not in the HR system. */}
          <div className="rounded-xl border border-white/70 bg-white/70 p-1">
            <div className="grid grid-cols-2 gap-1">
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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              <Select value={form.departmentId} onValueChange={(value) => set('departmentId', value)}>
                <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>
                  {departments.map((department) => (
                    <SelectItem key={department.id} value={department.id}>{department.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Designation</Label>
              <Select value={form.designation} onValueChange={(value) => set('designation', value)}>
                <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>
                  {designations.map((designation) => (
                    <SelectItem key={designation} value={designation}>{designation}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Reporting manager</Label>
              <Select value={form.reportingManagerId} onValueChange={(value) => set('reportingManagerId', value)}>
                <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>
                  {users
                    .filter((user) => user.status !== 'Inactive')
                    .slice(0, 300)
                    .map((user) => (
                      <SelectItem key={user.id} value={user.id}>{user.name || user.email}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Project / site</Label>
              <Select value={form.projectId} onValueChange={(value) => set('projectId', value)}>
                <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.projectName || project.siteCode || project.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Additional roles</Label>
              {additionalRoleIds.length > 0 && (
                <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
                  {additionalRoleIds.length} selected
                </Badge>
              )}
            </div>
            <RolePicker
              roles={activeRoles}
              selectedIds={additionalRoleIds}
              onSelectionChange={setAdditionalRoleIds}
              heightClassName="h-40"
            />
          </div>
        </div>

        <DialogFooter className={hrDialog.footer}>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create user
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
