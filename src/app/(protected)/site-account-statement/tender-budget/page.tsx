'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  addDoc, collection, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  formatINR, SAS_COLLECTIONS,
  type SASProject, type SASTenderBudget,
} from '@/lib/site-account-statement';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ChevronLeft, ChevronRight, Loader2, Pencil, Plus, Settings, ShieldAlert, Target, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const MODULE   = 'Site Account Statement';
const RESOURCE = 'Tender Budget';

function shiftMonth(m: string, delta: number): string {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}
function monthDiff(a: string, b: string): number {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}
function currentMonthStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default function TenderBudgetSetupPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { log } = useActivityLogger(MODULE);
  const { toast } = useToast();
  const { user } = useAuth();

  const canViewAll = can('View',   `${MODULE}.All Projects`);
  const canView    = can('View', `${MODULE}.${RESOURCE}`);
  const canAdd     = can('Add',    `${MODULE}.${RESOURCE}`);
  const canEdit    = can('Edit',   `${MODULE}.${RESOURCE}`);
  const canDelete  = can('Delete', `${MODULE}.${RESOURCE}`);

  const [projects,      setProjects]      = useState<SASProject[]>([]);
  const [tenderBudgets, setTenderBudgets] = useState<SASTenderBudget[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);

  const [dialogOpen,      setDialogOpen]      = useState(false);
  const [editingBudget,   setEditingBudget]   = useState<SASTenderBudget | null>(null);
  const [dialogProjectId, setDialogProjectId] = useState('');
  const [dialogAmount,    setDialogAmount]    = useState('');
  const [dialogStart,     setDialogStart]     = useState(() => currentMonthStr());
  const [dialogEnd,       setDialogEnd]       = useState(() => shiftMonth(currentMonthStr(), 11));
  const [dialogNotes,     setDialogNotes]     = useState('');

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!isAuthLoading) void loadAll(); }, [isAuthLoading]);

  async function loadAll() {
    setLoading(true);
    try {
      const [pSnap, tbSnap] = await Promise.all([
        getDocs(query(collection(db, SAS_COLLECTIONS.projects), orderBy('projectName'))),
        getDocs(collection(db, SAS_COLLECTIONS.tenderBudgets)),
      ]);
      setProjects(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASProject)).filter(p => p.enabledForSiteAccount && p.status === 'Active'));
      setTenderBudgets(tbSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASTenderBudget)));
    } finally {
      setLoading(false);
    }
  }

  const visibleProjects = useMemo(
    () => canViewAll ? projects : projects.filter(p =>
      p.assignedPersonId === user?.id || p.altUserId === user?.id || p.viewerId === user?.id),
    [projects, user?.id, canViewAll],
  );

  const isAltUser       = useMemo(() => !canViewAll && visibleProjects.some(p => p.altUserId === user?.id), [canViewAll, visibleProjects, user?.id]);
  const effectiveCanAdd  = canAdd  || isAltUser;
  const effectiveCanEdit = canEdit || isAltUser;

  const configuredProjects   = visibleProjects.filter(p =>  tenderBudgets.find(tb => tb.projectId === p.id));
  const unconfiguredProjects = visibleProjects.filter(p => !tenderBudgets.find(tb => tb.projectId === p.id));

  function openAdd(projectId?: string) {
    setEditingBudget(null);
    setDialogProjectId(projectId ?? '');
    setDialogAmount('');
    setDialogStart(currentMonthStr());
    setDialogEnd(shiftMonth(currentMonthStr(), 11));
    setDialogNotes('');
    setDialogOpen(true);
  }

  function openEdit(tb: SASTenderBudget) {
    setEditingBudget(tb);
    setDialogProjectId(tb.projectId);
    setDialogAmount(String(tb.tenderAmount));
    setDialogStart(tb.startMonth);
    setDialogEnd(tb.endMonth);
    setDialogNotes(tb.notes ?? '');
    setDialogOpen(true);
  }

  async function handleSave() {
    const amount = parseFloat(dialogAmount);
    if (!dialogProjectId) { toast({ title: 'Select a project', variant: 'destructive' }); return; }
    if (!amount || amount <= 0) { toast({ title: 'Enter a valid tender amount', variant: 'destructive' }); return; }
    if (dialogStart > dialogEnd) { toast({ title: 'Start month must be before end month', variant: 'destructive' }); return; }
    const project = projects.find(p => p.id === dialogProjectId);
    if (!project) return;

    setSaving(true);
    try {
      if (editingBudget) {
        await updateDoc(doc(db, SAS_COLLECTIONS.tenderBudgets, editingBudget.id), {
          tenderAmount: amount, startMonth: dialogStart, endMonth: dialogEnd,
          notes: dialogNotes.trim() || null, updatedAt: serverTimestamp(),
        });
        setTenderBudgets(prev => prev.map(tb => tb.id === editingBudget.id
          ? { ...tb, tenderAmount: amount, startMonth: dialogStart, endMonth: dialogEnd, notes: dialogNotes.trim() || undefined }
          : tb));
        void log('Edit Tender Budget', { projectId: dialogProjectId, projectName: project.projectName });
        toast({ title: 'Tender budget updated' });
      } else {
        const ref = await addDoc(collection(db, SAS_COLLECTIONS.tenderBudgets), {
          projectId: dialogProjectId, projectName: project.projectName,
          tenderAmount: amount, startMonth: dialogStart, endMonth: dialogEnd,
          notes: dialogNotes.trim() || null,
          createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
        setTenderBudgets(prev => [...prev, {
          id: ref.id, projectId: dialogProjectId, projectName: project.projectName,
          tenderAmount: amount, startMonth: dialogStart, endMonth: dialogEnd,
          notes: dialogNotes.trim() || undefined, createdAt: new Date(), updatedAt: new Date(),
        }]);
        void log('Add Tender Budget', { projectId: dialogProjectId, projectName: project.projectName });
        toast({ title: 'Tender budget created' });
      }
      setDialogOpen(false);
    } catch (err) {
      toast({ title: 'Save failed', description: String(err), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(tb: SASTenderBudget) {
    try {
      await deleteDoc(doc(db, SAS_COLLECTIONS.tenderBudgets, tb.id));
      setTenderBudgets(prev => prev.filter(x => x.id !== tb.id));
      void log('Delete Tender Budget', { projectId: tb.projectId, projectName: tb.projectName });
      toast({ title: 'Tender budget deleted' });
    } catch (err) {
      toast({ title: 'Delete failed', description: String(err), variant: 'destructive' });
    }
  }

  const dialogTotalMonths = monthDiff(dialogStart, dialogEnd) + 1;
  const dialogPerMonth    = dialogTotalMonths > 0 && parseFloat(dialogAmount) > 0
    ? parseFloat(dialogAmount) / dialogTotalMonths : 0;

  const dialogProjectOptions = editingBudget
    ? visibleProjects.filter(p => p.id === editingBudget.projectId)
    : unconfiguredProjects;

  if (loading || isAuthLoading) {
    return <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>;
  }

  if (!canView && !canAdd && !canEdit) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border bg-card py-20 gap-3 text-center">
        <ShieldAlert className="h-11 w-11 text-destructive" />
        <p className="font-semibold text-slate-800">Access Denied</p>
        <p className="text-sm text-muted-foreground">You don&apos;t have permission to access Tender Setup.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-base sm:text-lg font-bold text-slate-800 flex items-center gap-2">
            <Settings className="h-5 w-5 text-teal-600" /> Tender Budget Setup
          </h1>
          <p className="text-sm text-muted-foreground">Configure tender budget, start and end month per project</p>
        </div>
        {effectiveCanAdd && unconfiguredProjects.length > 0 && (
          <Button size="sm" onClick={() => openAdd()} className="gap-1.5 bg-emerald-700 hover:bg-emerald-800">
            <Plus className="h-4 w-4" /> Add Setup
          </Button>
        )}
      </div>

      {/* Configured projects table */}
      {configuredProjects.length > 0 && (
        <Card>
          <div className="px-4 py-2.5 border-b bg-slate-50/60">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Configured Projects</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="px-4 py-2.5 text-left font-medium text-slate-600">Project</th>
                  <th className="px-4 py-2.5 text-right font-medium text-slate-600">Tender Budget (₹)</th>
                  <th className="px-4 py-2.5 text-center font-medium text-slate-600">Start</th>
                  <th className="px-4 py-2.5 text-center font-medium text-slate-600">End</th>
                  <th className="px-4 py-2.5 text-center font-medium text-slate-600">Duration</th>
                  <th className="px-4 py-2.5 text-right font-medium text-slate-600">Per Month (₹)</th>
                  {(effectiveCanEdit || canDelete) && <th className="px-4 py-2.5 text-right font-medium text-slate-600">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {configuredProjects.map(project => {
                  const tb = tenderBudgets.find(t => t.projectId === project.id)!;
                  const months = monthDiff(tb.startMonth, tb.endMonth) + 1;
                  const perMonth = months > 0 ? tb.tenderAmount / months : 0;
                  const isActive = currentMonthStr() >= tb.startMonth && currentMonthStr() <= tb.endMonth;
                  const isEnded  = currentMonthStr() > tb.endMonth;
                  return (
                    <tr key={project.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-800">{project.projectName}</span>
                          {project.projectCode && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-slate-200 text-slate-500">{project.projectCode}</Badge>
                          )}
                          {isActive && <Badge className="text-[9px] px-1.5 py-0 bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Active</Badge>}
                          {isEnded  && <Badge className="text-[9px] px-1.5 py-0 bg-slate-100 text-slate-500 hover:bg-slate-100">Ended</Badge>}
                        </div>
                        {tb.notes && <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{tb.notes}</p>}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-emerald-700">{formatINR(tb.tenderAmount)}</td>
                      <td className="px-4 py-3 text-center text-slate-600">{monthLabel(tb.startMonth)}</td>
                      <td className="px-4 py-3 text-center text-slate-600">{monthLabel(tb.endMonth)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-slate-700 font-medium">{months}</span>
                        <span className="text-muted-foreground text-xs ml-0.5">mo</span>
                      </td>
                      <td className="px-4 py-3 text-right text-blue-700 font-medium">{formatINR(Math.round(perMonth))}</td>
                      {(effectiveCanEdit || canDelete) && (
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-1">
                            {effectiveCanEdit && (
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(tb)}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {canDelete && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10">
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete Tender Budget</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Remove tender budget setup for {project.projectName}?
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleDelete(tb)} className="bg-destructive hover:bg-destructive/90">Delete</AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Unconfigured projects */}
      {unconfiguredProjects.length > 0 && (
        <Card>
          <div className="px-4 py-2.5 border-b bg-amber-50/60">
            <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
              Projects without Setup ({unconfiguredProjects.length})
            </p>
          </div>
          <CardContent className="p-0">
            {unconfiguredProjects.map((project, idx) => (
              <div key={project.id} className={cn('flex items-center justify-between px-4 py-3 gap-3', idx < unconfiguredProjects.length - 1 && 'border-b')}>
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-slate-400 shrink-0" />
                  <span className="text-sm text-slate-700">{project.projectName}</span>
                  {project.projectCode && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">{project.projectCode}</Badge>
                  )}
                </div>
                {effectiveCanAdd && (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-emerald-700 border-emerald-200 hover:bg-emerald-50 shrink-0" onClick={() => openAdd(project.id)}>
                    <Plus className="h-3 w-3" /> Set Up
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {visibleProjects.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground text-sm">No active projects found.</CardContent>
        </Card>
      )}

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={open => { if (!open && !saving) setDialogOpen(false); }}>
        <DialogContent className="max-w-md overflow-y-auto max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>{editingBudget ? 'Edit Tender Budget' : 'Set Up Tender Budget'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">

            <div className="space-y-1.5">
              <Label>Project <span className="text-destructive">*</span></Label>
              {editingBudget ? (
                <Input value={visibleProjects.find(p => p.id === dialogProjectId)?.projectName ?? dialogProjectId} disabled />
              ) : (
                <Select value={dialogProjectId} onValueChange={setDialogProjectId}>
                  <SelectTrigger><SelectValue placeholder="Select project…" /></SelectTrigger>
                  <SelectContent>
                    {dialogProjectOptions.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Tender Amount (₹) <span className="text-destructive">*</span></Label>
              <Input type="number" min={0} step={1000} placeholder="e.g. 5000000"
                value={dialogAmount} onChange={e => setDialogAmount(e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Start Month</Label>
                <div className="flex items-center gap-1.5">
                  <Button size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={() => setDialogStart(s => shiftMonth(s, -1))}><ChevronLeft className="h-4 w-4" /></Button>
                  <span className="flex-1 text-center text-sm font-medium">{monthLabel(dialogStart)}</span>
                  <Button size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={() => setDialogStart(s => shiftMonth(s, 1))}><ChevronRight className="h-4 w-4" /></Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>End Month</Label>
                <div className="flex items-center gap-1.5">
                  <Button size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={() => setDialogEnd(e => shiftMonth(e, -1))}><ChevronLeft className="h-4 w-4" /></Button>
                  <span className="flex-1 text-center text-sm font-medium">{monthLabel(dialogEnd)}</span>
                  <Button size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={() => setDialogEnd(e => shiftMonth(e, 1))}><ChevronRight className="h-4 w-4" /></Button>
                </div>
              </div>
            </div>

            {dialogStart > dialogEnd && (
              <p className="text-xs text-destructive">Start month must be before end month.</p>
            )}

            {dialogTotalMonths > 0 && parseFloat(dialogAmount) > 0 && (
              <div className="rounded-md bg-emerald-50 border border-emerald-100 px-3 py-2 text-sm">
                <span className="text-emerald-700 font-medium">{dialogTotalMonths} months</span>
                <span className="text-muted-foreground"> · </span>
                <span className="text-emerald-800 font-semibold">{formatINR(Math.round(dialogPerMonth))}/month</span>
                <span className="text-muted-foreground text-xs"> planned</span>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea rows={2} placeholder="Any notes about this tender…"
                value={dialogNotes} onChange={e => setDialogNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="bg-emerald-700 hover:bg-emerald-800 min-w-[80px]">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (editingBudget ? 'Save Changes' : 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
