'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { ArrowDown, ArrowLeft, ArrowUp, GitBranch, Loader2, Plus, RotateCcw, Save, ShieldCheck, Trash2, Users } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';
import {
  DEFAULT_INSURANCE_WORKFLOW_CONFIG,
  INSURANCE_WORKFLOW_CONFIG_DOC_ID,
  type InsuranceWorkflowAction,
  type InsuranceWorkflowAssignmentType,
  type InsuranceWorkflowConfig,
  type InsuranceWorkflowStep,
  normalizeInsuranceWorkflowConfig,
} from '@/lib/vehicle-insurance-workflow';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

const NO_VALUE = '__none__';
const ACTIONS: InsuranceWorkflowAction[] = ['Acknowledge', 'Complete', 'Approve', 'Return', 'Reject'];

export default function InsuranceWorkflowSettingsPage() {
  const { users } = useAuth();
  const { can } = useAuthorization();
  const { toast } = useToast();
  const canView = can('View', 'Vehicle Management.Settings') || can('Edit', 'Vehicle Management.Settings');
  const canEdit = can('Edit', 'Vehicle Management.Settings');
  const [config, setConfig] = useState<InsuranceWorkflowConfig>(normalizeInsuranceWorkflowConfig());
  const [triggerDaysText, setTriggerDaysText] = useState('90, 60, 30, 15, 7, 0');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const savedConfig = useRef('');

  const activeUsers = useMemo(
    () => users.filter((user) => user.status !== 'Inactive').sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
    [users]
  );
  const roles = useMemo(
    () => Array.from(new Set(activeUsers.map((user) => String(user.role || '').trim()).filter(Boolean))).sort(),
    [activeUsers]
  );

  useEffect(() => {
    const load = async () => {
      try {
        const snapshot = await getDoc(doc(db, VEHICLE_COLLECTIONS.settings, INSURANCE_WORKFLOW_CONFIG_DOC_ID));
        const loaded = normalizeInsuranceWorkflowConfig(snapshot.exists() ? snapshot.data() as Partial<InsuranceWorkflowConfig> : null);
        setConfig(loaded);
        setTriggerDaysText(loaded.triggerDays.join(', '));
        savedConfig.current = JSON.stringify(loaded);
      } catch (error) {
        console.error('Unable to load insurance workflow settings', error);
        toast({ title: 'Unable to load workflow', description: 'Default workflow settings are shown.', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [toast]);

  const updateStep = (stepId: string, patch: Partial<InsuranceWorkflowStep>) => {
    setConfig((current) => ({ ...current, steps: current.steps.map((item) => item.id === stepId ? { ...item, ...patch } : item) }));
  };

  const addStep = () => {
    const nextIndex = config.steps.length + 1;
    setConfig((current) => ({
      ...current,
      steps: [...current.steps, {
        id: `step-${Date.now()}`,
        name: `Workflow Step ${nextIndex}`,
        description: '',
        tatHours: 24,
        assignmentType: 'User',
        primaryUserId: '',
        backupUserId: '',
        role: '',
        highValueUserId: '',
        highValueRole: '',
        actions: ['Acknowledge', 'Complete'],
        documentRequired: false,
      }],
    }));
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= config.steps.length) return;
    setConfig((current) => {
      const steps = [...current.steps];
      [steps[index], steps[target]] = [steps[target], steps[index]];
      return { ...current, steps };
    });
  };

  const removeStep = (stepId: string) => {
    if (config.steps.length <= 1) {
      toast({ title: 'One step is required', variant: 'destructive' });
      return;
    }
    setConfig((current) => ({ ...current, steps: current.steps.filter((item) => item.id !== stepId) }));
  };

  const toggleAction = (workflowStep: InsuranceWorkflowStep, action: InsuranceWorkflowAction, checked: boolean) => {
    const actions = checked
      ? Array.from(new Set([...workflowStep.actions, action]))
      : workflowStep.actions.filter((item) => item !== action);
    updateStep(workflowStep.id, { actions });
  };

  const save = async () => {
    const triggerDays = Array.from(new Set(triggerDaysText.split(',').map((item) => Number(item.trim())).filter((item) => Number.isFinite(item) && item >= 0))).sort((a, b) => b - a);
    if (!triggerDays.length) return toast({ title: 'Add at least one valid trigger day', variant: 'destructive' });
    for (const workflowStep of config.steps) {
      if (!workflowStep.name.trim()) return toast({ title: 'Every workflow step needs a name', variant: 'destructive' });
      if (workflowStep.tatHours < 1) return toast({ title: `${workflowStep.name} needs a valid TAT`, variant: 'destructive' });
      if (!workflowStep.actions.length) return toast({ title: `${workflowStep.name} needs at least one action`, variant: 'destructive' });
    }
    const normalized = normalizeInsuranceWorkflowConfig({ ...config, triggerDays });
    setIsSaving(true);
    try {
      await setDoc(doc(db, VEHICLE_COLLECTIONS.settings, INSURANCE_WORKFLOW_CONFIG_DOC_ID), { ...normalized, updatedAt: serverTimestamp() });
      setConfig(normalized);
      setTriggerDaysText(normalized.triggerDays.join(', '));
      savedConfig.current = JSON.stringify(normalized);
      toast({ title: 'Workflow saved', description: 'New and newly-created renewal cases will use this configuration.' });
    } catch (error) {
      console.error('Unable to save insurance workflow settings', error);
      toast({ title: 'Unable to save workflow', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const dirty = JSON.stringify({ ...config, triggerDays: triggerDaysText }) !== JSON.stringify({ ...JSON.parse(savedConfig.current || '{}'), triggerDays: (JSON.parse(savedConfig.current || '{}').triggerDays || []).join(', ') });

  if (!canView) return <Card><CardHeader><CardTitle>Access Restricted</CardTitle><CardDescription>You do not have permission to view workflow settings.</CardDescription></CardHeader></Card>;
  if (isLoading) return <div className="space-y-4"><Skeleton className="h-28 rounded-xl" /><Skeleton className="h-72 rounded-xl" /></div>;

  return (
    <div className="space-y-4">
      <Card className="vm-panel-strong overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-violet-500 via-indigo-500 to-cyan-500" />
        <CardHeader className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex items-start gap-3">
            <Link href="/vehicle-management/settings"><Button variant="outline" size="icon" className="bg-white"><ArrowLeft className="h-4 w-4" /></Button></Link>
            <div><CardTitle className="flex items-center gap-2 text-lg"><GitBranch className="h-5 w-5 text-violet-600" />Insurance Workflow Setup</CardTitle><CardDescription>Configure expiry triggers, assignments, approval routing, stage TAT and escalation.</CardDescription></div>
          </div>
          <div className="flex gap-2"><Button variant="outline" onClick={() => { const defaults = normalizeInsuranceWorkflowConfig(DEFAULT_INSURANCE_WORKFLOW_CONFIG); setConfig(defaults); setTriggerDaysText(defaults.triggerDays.join(', ')); }} disabled={!canEdit}><RotateCcw className="mr-1.5 h-4 w-4" />Defaults</Button><Button onClick={() => void save()} disabled={!canEdit || isSaving || !dirty} className="bg-gradient-to-r from-violet-600 to-indigo-600"><Save className="mr-1.5 h-4 w-4" />{isSaving ? 'Saving...' : 'Save Workflow'}</Button></div>
        </CardHeader>
      </Card>

      <Card className="vm-panel">
        <CardHeader><CardTitle className="text-base">Workflow Rules</CardTitle><CardDescription>These rules determine when cases start and how premium-based approval is routed.</CardDescription></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SettingSwitch label="Workflow Enabled" description="Automatically create cases inside the expiry window." checked={config.enabled} onCheckedChange={(enabled) => setConfig((current) => ({ ...current, enabled }))} disabled={!canEdit} />
          <SettingSwitch label="Automatic Escalation" description="Move overdue work to the configured backup owner." checked={config.autoEscalate} onCheckedChange={(autoEscalate) => setConfig((current) => ({ ...current, autoEscalate }))} disabled={!canEdit} />
          <Field label="Expiry trigger days"><Input value={triggerDaysText} onChange={(event) => setTriggerDaysText(event.target.value)} placeholder="90, 60, 30, 15, 7, 0" disabled={!canEdit} /><p className="text-[11px] text-muted-foreground">Comma-separated days before expiry.</p></Field>
          <Field label="High-value premium threshold"><Input type="number" min="0" value={config.highValuePremiumThreshold} onChange={(event) => setConfig((current) => ({ ...current, highValuePremiumThreshold: Math.max(0, Number(event.target.value)) }))} disabled={!canEdit} /></Field>
          <Field label="Reminder before TAT (hours)"><Input type="number" min="0" value={config.reminderBeforeHours} onChange={(event) => setConfig((current) => ({ ...current, reminderBeforeHours: Math.max(0, Number(event.target.value)) }))} disabled={!canEdit} /></Field>
          <Field label="Fallback owner"><UserSelect users={activeUsers} value={config.fallbackUserId} onChange={(fallbackUserId) => setConfig((current) => ({ ...current, fallbackUserId }))} disabled={!canEdit} allowNone /></Field>
          <div className="rounded-xl border border-violet-100 bg-violet-50/60 p-3 sm:col-span-2"><p className="text-xs font-semibold text-violet-800">Dynamic assignment</p><p className="mt-1 text-xs text-violet-700">A step may use a selected user, anyone matching a role, or a different approver when the current premium exceeds the configured threshold.</p></div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between"><div><h2 className="font-semibold text-slate-800">Workflow Stages</h2><p className="text-xs text-muted-foreground">Cases move through these stages from top to bottom.</p></div><Button variant="outline" onClick={addStep} disabled={!canEdit}><Plus className="mr-1.5 h-4 w-4" />Add Stage</Button></div>

      <div className="space-y-3">
        {config.steps.map((workflowStep, index) => (
          <Card key={workflowStep.id} className="vm-panel overflow-hidden">
            <CardHeader className="border-b border-slate-100 p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-100 font-bold text-violet-700">{index + 1}</div>
                <div className="min-w-0 flex-1"><CardTitle className="text-base">{workflowStep.name}</CardTitle><CardDescription>{workflowStep.description || 'No instructions added.'}</CardDescription></div>
                <Badge variant="outline" className="hidden bg-white sm:inline-flex">{workflowStep.tatHours}h TAT</Badge>
                {canEdit && <div className="flex gap-1"><Button size="icon" variant="ghost" onClick={() => moveStep(index, -1)} disabled={index === 0}><ArrowUp className="h-4 w-4" /></Button><Button size="icon" variant="ghost" onClick={() => moveStep(index, 1)} disabled={index === config.steps.length - 1}><ArrowDown className="h-4 w-4" /></Button><Button size="icon" variant="ghost" className="text-rose-600" onClick={() => removeStep(workflowStep.id)}><Trash2 className="h-4 w-4" /></Button></div>}
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 p-4 lg:grid-cols-2">
              <div className="space-y-4">
                <Field label="Stage name"><Input value={workflowStep.name} onChange={(event) => updateStep(workflowStep.id, { name: event.target.value })} disabled={!canEdit} /></Field>
                <Field label="Instructions"><Textarea value={workflowStep.description} onChange={(event) => updateStep(workflowStep.id, { description: event.target.value })} disabled={!canEdit} className="min-h-20" /></Field>
                <div className="grid grid-cols-2 gap-3"><Field label="TAT (hours)"><Input type="number" min="1" value={workflowStep.tatHours} onChange={(event) => updateStep(workflowStep.id, { tatHours: Math.max(1, Number(event.target.value)) })} disabled={!canEdit} /></Field><Field label="Assignment type"><Select value={workflowStep.assignmentType} onValueChange={(assignmentType: InsuranceWorkflowAssignmentType) => updateStep(workflowStep.id, { assignmentType })} disabled={!canEdit}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="User">Selected user</SelectItem><SelectItem value="Role">Role based</SelectItem><SelectItem value="Premium-based">Premium based</SelectItem></SelectContent></Select></Field></div>
                <SettingSwitch label="Document required" description="Assignee must confirm supporting documents before completing this stage." checked={workflowStep.documentRequired} onCheckedChange={(documentRequired) => updateStep(workflowStep.id, { documentRequired })} disabled={!canEdit} />
              </div>
              <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <div className="flex items-center gap-2"><Users className="h-4 w-4 text-indigo-600" /><p className="text-sm font-semibold">Ownership and Actions</p></div>
                {workflowStep.assignmentType === 'User' && <Field label="Primary assignee"><UserSelect users={activeUsers} value={workflowStep.primaryUserId} onChange={(primaryUserId) => updateStep(workflowStep.id, { primaryUserId })} disabled={!canEdit} allowNone /></Field>}
                {workflowStep.assignmentType !== 'User' && <><Field label={workflowStep.assignmentType === 'Premium-based' ? 'Standard approval role' : 'Assigned role'}><RoleSelect roles={roles} value={workflowStep.role} onChange={(role) => updateStep(workflowStep.id, { role })} disabled={!canEdit} /></Field><Field label="Specific user override"><UserSelect users={activeUsers} value={workflowStep.primaryUserId} onChange={(primaryUserId) => updateStep(workflowStep.id, { primaryUserId })} disabled={!canEdit} allowNone /></Field></>}
                {workflowStep.assignmentType === 'Premium-based' && <div className="grid gap-3 sm:grid-cols-2"><Field label="High-value role"><RoleSelect roles={roles} value={workflowStep.highValueRole} onChange={(highValueRole) => updateStep(workflowStep.id, { highValueRole })} disabled={!canEdit} /></Field><Field label="High-value user override"><UserSelect users={activeUsers} value={workflowStep.highValueUserId} onChange={(highValueUserId) => updateStep(workflowStep.id, { highValueUserId })} disabled={!canEdit} allowNone /></Field></div>}
                <Field label="Backup / escalation assignee"><UserSelect users={activeUsers} value={workflowStep.backupUserId} onChange={(backupUserId) => updateStep(workflowStep.id, { backupUserId })} disabled={!canEdit} allowNone /></Field>
                <Field label="Allowed actions"><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{ACTIONS.map((action) => <label key={action} className="flex items-center gap-2 rounded-lg border bg-white px-2.5 py-2 text-xs"><Checkbox checked={workflowStep.actions.includes(action)} onCheckedChange={(checked) => toggleAction(workflowStep, action, checked === true)} disabled={!canEdit} />{action}</label>)}</div></Field>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-emerald-200 bg-emerald-50/70"><CardContent className="flex items-start gap-3 p-4"><ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-700" /><div><p className="text-sm font-semibold text-emerald-900">Configuration safety</p><p className="text-xs text-emerald-800">Existing cases retain their current position. Updated rules apply when a new case starts or a case enters its next stage.</p></div></CardContent></Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs font-semibold">{label}</Label>{children}</div>;
}

function SettingSwitch({ label, description, checked, onCheckedChange, disabled }: { label: string; description: string; checked: boolean; onCheckedChange: (checked: boolean) => void; disabled: boolean }) {
  return <div className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3"><div><p className="text-sm font-semibold text-slate-800">{label}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p></div><Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} /></div>;
}

function UserSelect({ users, value, onChange, disabled, allowNone = false }: { users: ReturnType<typeof useAuth>['users']; value: string; onChange: (value: string) => void; disabled: boolean; allowNone?: boolean }) {
  return <Select value={value || NO_VALUE} onValueChange={(next) => onChange(next === NO_VALUE ? '' : next)} disabled={disabled}><SelectTrigger className="bg-white"><SelectValue placeholder="Select user" /></SelectTrigger><SelectContent>{allowNone && <SelectItem value={NO_VALUE}>Not assigned</SelectItem>}{users.map((user) => <SelectItem key={user.id} value={user.id}>{user.name || user.email} {user.role ? `(${user.role})` : ''}</SelectItem>)}</SelectContent></Select>;
}

function RoleSelect({ roles, value, onChange, disabled }: { roles: string[]; value: string; onChange: (value: string) => void; disabled: boolean }) {
  return <Select value={value || NO_VALUE} onValueChange={(next) => onChange(next === NO_VALUE ? '' : next)} disabled={disabled}><SelectTrigger className="bg-white"><SelectValue placeholder="Select role" /></SelectTrigger><SelectContent><SelectItem value={NO_VALUE}>No role</SelectItem>{roles.map((role) => <SelectItem key={role} value={role}>{role}</SelectItem>)}</SelectContent></Select>;
}
