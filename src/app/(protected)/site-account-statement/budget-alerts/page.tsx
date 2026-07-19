'use client';

import { useEffect, useState } from 'react';
import {
  collection, doc, getDocs, query, serverTimestamp, setDoc, where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  SAS_COLLECTIONS,
  type SASBudgetAlertConfig,
  type SASBudgetAlertRecipient,
  type SASProject,
} from '@/lib/site-account-statement';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Bell,
  BellOff,
  FlaskConical,
  Globe,
  Loader2,
  Mail,
  Plus,
  ShieldAlert,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { MODULE_ALERT_DOC_ID } from '@/lib/sas-budget-alerts';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AlertConfigState {
  [projectId: string]: SASBudgetAlertConfig;
}

interface DialogState {
  open: boolean;
  isModuleWide: boolean;       // true = editing the module-wide (_module_wide_) config
  project: SASProject | null;  // null when isModuleWide = true
  enabled: boolean;
  thresholds: number[];
  recipients: { name: string; email: string }[];
  newName: string;
  newEmail: string;
  saving: boolean;
}

const THRESHOLD_OPTIONS = [80, 90, 100, 110, 120, 130, 150, 200] as const;

const blankDialog = (): DialogState => ({
  open: false,
  isModuleWide: false,
  project: null,
  enabled: false,
  thresholds: [80, 90, 100],
  recipients: [],
  newName: '',
  newEmail: '',
  saving: false,
});

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BudgetAlertsPage() {
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { toast } = useToast();

  const canEdit    = can('Edit',   'Site Account Statement.Budget Alerts')
                  || can('Edit',   'Site Account Statement.Project Settings');
  const canView    = canEdit
                  || can('View',   'Site Account Statement.Budget Alerts');
  const canViewAll = can('View',   'Site Account Statement.All Projects');
  const canAccess  = canView || canViewAll;

  const [projects,      setProjects]      = useState<SASProject[]>([]);
  const [configs,       setConfigs]       = useState<AlertConfigState>({});
  const [moduleConfig,  setModuleConfig]  = useState<SASBudgetAlertConfig | null>(null);
  const [loading,       setLoading]       = useState(true);
  const [dialog,        setDialog]        = useState<DialogState>(blankDialog());
  const [testingId,     setTestingId]     = useState<string | null>(null);

  // ── Data loading ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isAuthLoading && canAccess) void loadAll();
  }, [isAuthLoading, canAccess]);

  async function loadAll() {
    setLoading(true);
    try {
      const [projSnap, configSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, SAS_COLLECTIONS.projects),
            where('enabledForSiteAccount', '==', true),
            where('status', '==', 'Active'),
          ),
        ),
        getDocs(collection(db, SAS_COLLECTIONS.budgetAlertConfigs)),
      ]);

      const projectList = projSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as SASProject))
        .sort((a, b) => a.projectName.localeCompare(b.projectName));

      const configMap: AlertConfigState = {};
      configSnap.docs.forEach(d => {
        if (d.id === MODULE_ALERT_DOC_ID) {
          setModuleConfig({ id: d.id, ...d.data() } as SASBudgetAlertConfig);
        } else {
          configMap[d.id] = { id: d.id, ...d.data() } as SASBudgetAlertConfig;
        }
      });

      setProjects(projectList);
      setConfigs(configMap);
    } catch (e: any) {
      toast({ title: 'Load Error', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }

  // ── Dialog helpers ──────────────────────────────────────────────────────────

  function openConfigure(project: SASProject) {
    const existing = configs[project.id];
    setDialog({
      open: true,
      isModuleWide: false,
      project,
      enabled: existing?.enabled ?? false,
      thresholds: existing?.thresholds?.length ? [...existing.thresholds] : [80, 100],
      recipients: existing?.recipients
        ? existing.recipients.map(r => ({ name: r.name, email: r.email }))
        : [],
      newName: '',
      newEmail: '',
      saving: false,
    });
  }

  function openConfigureModule() {
    setDialog({
      open: true,
      isModuleWide: true,
      project: null,
      enabled: moduleConfig?.enabled ?? false,
      thresholds: moduleConfig?.thresholds?.length ? [...moduleConfig.thresholds] : [80, 100],
      recipients: moduleConfig?.recipients
        ? moduleConfig.recipients.map(r => ({ name: r.name, email: r.email }))
        : [],
      newName: '',
      newEmail: '',
      saving: false,
    });
  }

  function closeDialog() {
    setDialog(blankDialog());
  }

  function toggleThreshold(value: number) {
    setDialog(prev => {
      const has = prev.thresholds.includes(value);
      return {
        ...prev,
        thresholds: has
          ? prev.thresholds.filter(t => t !== value)
          : [...prev.thresholds, value].sort((a, b) => a - b),
      };
    });
  }

  function addRecipient() {
    const name  = dialog.newName.trim();
    const email = dialog.newEmail.trim().toLowerCase();

    if (!name) {
      toast({ title: 'Validation', description: 'Recipient name is required.', variant: 'destructive' });
      return;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({ title: 'Validation', description: 'Enter a valid email address.', variant: 'destructive' });
      return;
    }
    if (dialog.recipients.some(r => r.email === email)) {
      toast({ title: 'Duplicate', description: 'This email is already in the list.', variant: 'destructive' });
      return;
    }

    setDialog(prev => ({
      ...prev,
      recipients: [...prev.recipients, { name, email }],
      newName: '',
      newEmail: '',
    }));
  }

  function removeRecipient(index: number) {
    setDialog(prev => ({
      ...prev,
      recipients: prev.recipients.filter((_, i) => i !== index),
    }));
  }

  // ── Save ────────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (dialog.enabled && dialog.thresholds.length === 0) {
      toast({ title: 'Validation', description: 'Select at least one threshold to enable alerts.', variant: 'destructive' });
      return;
    }
    if (dialog.enabled && dialog.recipients.length === 0) {
      toast({ title: 'Validation', description: 'Add at least one recipient to enable alerts.', variant: 'destructive' });
      return;
    }

    setDialog(prev => ({ ...prev, saving: true }));
    try {
      if (dialog.isModuleWide) {
        // ── Save module-wide config ────────────────────────────────────────
        const docData = {
          projectId:     MODULE_ALERT_DOC_ID,
          projectName:   'All Projects',
          enabled:       dialog.enabled,
          thresholds:    [...dialog.thresholds].sort((a, b) => a - b),
          recipients:    dialog.recipients as SASBudgetAlertRecipient[],
          updatedAt:     serverTimestamp(),
          updatedBy:     user?.id ?? '',
          updatedByName: user?.name ?? '',
        };
        await setDoc(doc(db, SAS_COLLECTIONS.budgetAlertConfigs, MODULE_ALERT_DOC_ID), docData, { merge: true });
        setModuleConfig({ id: MODULE_ALERT_DOC_ID, ...docData } as SASBudgetAlertConfig);
        toast({ title: 'Saved', description: 'Module-wide budget alert settings updated.' });
      } else {
        // ── Save per-project config ────────────────────────────────────────
        if (!dialog.project) return;
        const { project } = dialog;
        const docData: Omit<SASBudgetAlertConfig, 'id'> = {
          projectId:     project.id,
          projectName:   project.projectName,
          enabled:       dialog.enabled,
          thresholds:    [...dialog.thresholds].sort((a, b) => a - b),
          recipients:    dialog.recipients as SASBudgetAlertRecipient[],
          updatedAt:     serverTimestamp(),
          updatedBy:     user?.id ?? '',
          updatedByName: user?.name ?? '',
        };
        await setDoc(doc(db, SAS_COLLECTIONS.budgetAlertConfigs, project.id), docData, { merge: true });
        setConfigs(prev => ({ ...prev, [project.id]: { id: project.id, ...docData } as SASBudgetAlertConfig }));
        toast({ title: 'Saved', description: `Alert settings updated for "${project.projectName}".` });
      }
      closeDialog();
    } catch (e: any) {
      toast({ title: 'Save Error', description: e.message, variant: 'destructive' });
      setDialog(prev => ({ ...prev, saving: false }));
    }
  }

  // ── Send test alert ─────────────────────────────────────────────────────────

  async function sendTestAlert(configId: string, cfg: SASBudgetAlertConfig) {
    if (!cfg.enabled) {
      toast({ title: 'Alerts disabled', description: 'Enable alerts on this config before sending a test.', variant: 'destructive' });
      return;
    }
    if (!cfg.recipients?.length) {
      toast({ title: 'No recipients', description: 'Add at least one recipient before sending a test.', variant: 'destructive' });
      return;
    }
    setTestingId(configId);
    try {
      const now   = new Date();
      const month = now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
      const res   = await fetch('/api/sas/budget-alert-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName:  cfg.projectName,
          monthLabel:   month,
          budgetAmount: 500000,
          spentAmount:  425000,
          pctUsed:      85,
          thresholdPct: cfg.thresholds[0] ?? 80,
          recipients:   cfg.recipients,
          link:         window.location.origin + '/site-account-statement/reports/budget',
          isTest:       true,
        }),
      });
      if (res.ok) {
        toast({ title: 'Test email sent!', description: `Sent to ${cfg.recipients.map(r => r.email).join(', ')}` });
      } else {
        const body = await res.json().catch(() => ({}));
        toast({ title: 'Failed', description: body.error ?? `HTTP ${res.status}`, variant: 'destructive' });
      }
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setTestingId(null);
    }
  }

  // ── Render helpers ──────────────────────────────────────────────────────────

  function formatThresholds(projectId: string): string {
    const cfg = configs[projectId];
    if (!cfg?.thresholds?.length) return '—';
    return cfg.thresholds.map(t => `${t}%`).join(', ');
  }

  function recipientCount(projectId: string): string {
    const cfg = configs[projectId];
    const count = cfg?.recipients?.length ?? 0;
    if (count === 0) return 'None';
    return `${count} recipient${count !== 1 ? 's' : ''}`;
  }

  // ── Guards ──────────────────────────────────────────────────────────────────

  if (isAuthLoading || loading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-14 rounded-lg bg-slate-100 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!canAccess) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-700">
            <ShieldAlert className="h-5 w-5" />
            Access Denied
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-600">
            You do not have permission to manage budget alert settings. Contact your administrator to
            request access to <strong>Site Account Statement — Budget Alerts</strong>.
          </p>
        </CardContent>
      </Card>
    );
  }

  // ── UI ─────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* Page header */}
      <div>
        <h1 className="flex items-center gap-2 text-lg font-bold text-slate-800">
          <ShieldAlert className="h-5 w-5 text-red-500" />
          Budget Alert Settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Configure who gets notified when project budgets are exceeded
        </p>
      </div>

      {/* ── Module-wide (All Projects) alert card ── */}
      <Card className={`border-2 ${moduleConfig?.enabled ? 'border-red-200 bg-red-50/40' : 'border-slate-200 bg-white/80'} backdrop-blur-sm`}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-red-500 shrink-0" />
              <div>
                <CardTitle className="text-sm font-bold">Module-Wide Alerts — All Projects</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Recipients here receive alerts for <strong>every</strong> project when budgets are crossed.
                  Ideal for HO managers who oversee all sites.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {moduleConfig?.enabled ? (
                <Badge className="bg-emerald-100 text-emerald-700 gap-1 hover:bg-emerald-100">
                  <Bell className="h-3 w-3" /> Active
                </Badge>
              ) : (
                <Badge variant="secondary" className="gap-1 text-slate-500">
                  <BellOff className="h-3 w-3" /> Disabled
                </Badge>
              )}
              {moduleConfig && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5 border-amber-200 text-amber-700 hover:bg-amber-50"
                  disabled={testingId === MODULE_ALERT_DOC_ID}
                  onClick={() => sendTestAlert(MODULE_ALERT_DOC_ID, moduleConfig)}
                >
                  {testingId === MODULE_ALERT_DOC_ID
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <FlaskConical className="h-3.5 w-3.5" />}
                  Test Email
                </Button>
              )}
              {canEdit && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5 border-red-200 text-red-700 hover:bg-red-50 hover:border-red-300"
                  onClick={openConfigureModule}
                >
                  <Globe className="h-3.5 w-3.5" />
                  Configure
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        {moduleConfig?.enabled && (
          <CardContent className="pt-0">
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground border-t border-red-100 pt-3">
              <span className="flex items-center gap-1">
                <ShieldAlert className="h-3.5 w-3.5 text-red-400" />
                Thresholds: <strong className="text-slate-700 ml-1">{moduleConfig.thresholds.map(t => `${t}%`).join(', ') || '—'}</strong>
              </span>
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                Recipients: <strong className="text-slate-700 ml-1">{moduleConfig.recipients?.length ?? 0}</strong>
                {moduleConfig.recipients?.length > 0 && (
                  <span className="text-muted-foreground ml-1">
                    ({moduleConfig.recipients.map(r => r.name).join(', ')})
                  </span>
                )}
              </span>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ── Per-project table card ── */}
      <Card className="bg-white/80 backdrop-blur-sm">
        <CardContent className="p-0">
          {projects.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Bell className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">
                No active SAS projects found. Enable projects in Project Settings first.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto overflow-y-auto max-h-[65vh]">
              <Table className="min-w-[680px]">
                <TableHeader className="sticky top-0 z-10 bg-slate-100">
                  <TableRow className="border-b hover:bg-transparent">
                    <TableHead className="font-medium text-slate-700 w-[260px]">Project</TableHead>
                    <TableHead className="font-medium text-slate-700 text-center">Alerts</TableHead>
                    <TableHead className="font-medium text-slate-700">Thresholds</TableHead>
                    <TableHead className="font-medium text-slate-700">Recipients</TableHead>
                    <TableHead className="font-medium text-slate-700 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projects.map(project => {
                    const cfg     = configs[project.id];
                    const isActive = cfg?.enabled === true;

                    return (
                      <TableRow key={project.id} className="hover:bg-muted/20 transition-colors">

                        {/* Project name + code */}
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <span className="font-medium text-slate-800 text-sm leading-tight">
                              {project.projectName}
                            </span>
                            {project.projectCode && (
                              <span className="text-xs text-muted-foreground">
                                {project.projectCode}
                              </span>
                            )}
                          </div>
                        </TableCell>

                        {/* Alert enabled badge */}
                        <TableCell className="text-center">
                          {isActive ? (
                            <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 gap-1">
                              <Bell className="h-3 w-3" />
                              Active
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="gap-1 text-slate-500">
                              <BellOff className="h-3 w-3" />
                              Disabled
                            </Badge>
                          )}
                        </TableCell>

                        {/* Thresholds */}
                        <TableCell>
                          <span className="text-sm text-slate-600">
                            {formatThresholds(project.id)}
                          </span>
                        </TableCell>

                        {/* Recipients count */}
                        <TableCell>
                          <div className="flex items-center gap-1.5 text-sm text-slate-600">
                            <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span>{recipientCount(project.id)}</span>
                          </div>
                        </TableCell>

                        {/* Actions */}
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {configs[project.id] && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs gap-1.5 border-amber-200 text-amber-700 hover:bg-amber-50"
                                disabled={testingId === project.id}
                                onClick={() => sendTestAlert(project.id, configs[project.id])}
                              >
                                {testingId === project.id
                                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  : <FlaskConical className="h-3.5 w-3.5" />}
                                Test
                              </Button>
                            )}
                            {canEdit && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs gap-1.5 border-red-200 text-red-700 hover:bg-red-50 hover:border-red-300"
                                onClick={() => openConfigure(project)}
                              >
                                <ShieldAlert className="h-3.5 w-3.5" />
                                Configure
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Configure Dialog ────────────────────────────────────────────────────── */}
      <Dialog open={dialog.open} onOpenChange={open => !open && closeDialog()}>
        <DialogContent className="max-w-[95vw] sm:max-w-xl overflow-y-auto max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              {dialog.isModuleWide
                ? <Globe className="h-4 w-4 text-red-500" />
                : <ShieldAlert className="h-4 w-4 text-red-500" />}
              {dialog.isModuleWide ? 'All Projects — Module-Wide Alert Config' : (dialog.project?.projectName ?? 'Configure Alerts')}
            </DialogTitle>
            {dialog.isModuleWide && (
              <p className="text-xs text-muted-foreground mt-1">
                These recipients and thresholds apply to every project in the SAS module.
              </p>
            )}
          </DialogHeader>

          <div className="space-y-6 py-1">

            {/* Enable toggle */}
            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="space-y-0.5">
                <Label htmlFor="alert-enabled" className="text-sm font-medium">
                  Enable Alerts
                </Label>
                <p className="text-xs text-muted-foreground">
                  Send email notifications when budget thresholds are reached
                </p>
              </div>
              <Switch
                id="alert-enabled"
                checked={dialog.enabled}
                onCheckedChange={v => setDialog(prev => ({ ...prev, enabled: v }))}
              />
            </div>

            {/* Thresholds */}
            <div className="space-y-2.5">
              <Label className="text-sm font-medium">
                Alert Thresholds
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  (select one or more)
                </span>
              </Label>
              <div className="flex flex-wrap gap-2">
                {THRESHOLD_OPTIONS.map(t => {
                  const selected = dialog.thresholds.includes(t);
                  const isOver   = t >= 100;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleThreshold(t)}
                      className={[
                        'flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                        selected
                          ? isOver
                            ? 'border-red-500 bg-red-50 text-red-700'
                            : 'border-amber-400 bg-amber-50 text-amber-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
                      ].join(' ')}
                    >
                      <span
                        className={[
                          'flex h-3.5 w-3.5 items-center justify-center rounded border text-[9px] font-bold',
                          selected
                            ? isOver
                              ? 'border-red-500 bg-red-500 text-white'
                              : 'border-amber-500 bg-amber-500 text-white'
                            : 'border-slate-300 bg-white',
                        ].join(' ')}
                      >
                        {selected && '✓'}
                      </span>
                      {t}%
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Recipients section */}
            <div className="space-y-3">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                Recipients
              </Label>

              {/* Existing recipients table */}
              {dialog.recipients.length > 0 ? (
                <div className="rounded-lg border border-slate-200 overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50 hover:bg-slate-50">
                        <TableHead className="text-xs font-medium py-2 h-auto">Name</TableHead>
                        <TableHead className="text-xs font-medium py-2 h-auto">Email</TableHead>
                        <TableHead className="text-xs font-medium py-2 h-auto text-right w-[60px]">
                          Remove
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dialog.recipients.map((r, idx) => (
                        <TableRow key={idx} className="hover:bg-muted/10">
                          <TableCell className="py-2 text-sm font-medium">{r.name}</TableCell>
                          <TableCell className="py-2 text-sm text-muted-foreground">{r.email}</TableCell>
                          <TableCell className="py-2 text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-red-500 hover:bg-red-50 hover:text-red-700"
                              onClick={() => removeRecipient(idx)}
                              title="Remove recipient"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-muted-foreground">
                  <Users className="h-4 w-4 shrink-0" />
                  No recipients configured yet. Add at least one below.
                </div>
              )}

              {/* Add recipient form */}
              <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 space-y-2.5">
                <p className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  Add Recipient
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="rec-name" className="text-xs text-muted-foreground">Name</Label>
                    <Input
                      id="rec-name"
                      value={dialog.newName}
                      onChange={e => setDialog(prev => ({ ...prev, newName: e.target.value }))}
                      placeholder="Full name"
                      className="h-8 text-sm"
                      onKeyDown={e => e.key === 'Enter' && addRecipient()}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="rec-email" className="text-xs text-muted-foreground">Email</Label>
                    <Input
                      id="rec-email"
                      type="email"
                      value={dialog.newEmail}
                      onChange={e => setDialog(prev => ({ ...prev, newEmail: e.target.value }))}
                      placeholder="email@example.com"
                      className="h-8 text-sm"
                      onKeyDown={e => e.key === 'Enter' && addRecipient()}
                    />
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1.5 h-7 text-xs border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                  onClick={addRecipient}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </Button>
              </div>
            </div>

            {/* Helper text when alerts enabled but missing config */}
            {dialog.enabled && dialog.thresholds.length === 0 && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Select at least one threshold to save with alerts enabled.
              </p>
            )}
            {dialog.enabled && dialog.recipients.length === 0 && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Add at least one recipient to save with alerts enabled.
              </p>
            )}
          </div>

          <DialogFooter className="gap-2 flex-row justify-end">
            <Button variant="outline" onClick={closeDialog} disabled={dialog.saving}>
              <X className="h-4 w-4 mr-1.5" />
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={dialog.saving}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {dialog.saving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <ShieldAlert className="h-4 w-4 mr-1.5" />
              )}
              Save Alert Config
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
