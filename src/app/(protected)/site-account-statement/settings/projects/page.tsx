'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  addDoc, collection, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { SAS_COLLECTIONS, type SASProject } from '@/lib/site-account-statement';
import type { Project, User } from '@/lib/types';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ExternalLink, Loader2, Pencil, Plus, Settings, Trash2, User2 } from 'lucide-react';
import Link from 'next/link';

const MODULE   = 'Site Account Statement';
const RESOURCE = 'Project Settings';

interface FormState {
  centralProjectId: string;
  projectName: string;
  projectCode: string;
  enabledForSiteAccount: boolean;
  assignedPersonId: string;
  assignedPersonName: string;
  assignedPersonEmail: string;
  altUserId: string;
  altUserName: string;
  altUserEmail: string;
  viewerId: string;
  viewerName: string;
  viewerEmail: string;
  status: 'Active' | 'Inactive';
}

const blank = (): FormState => ({
  centralProjectId: '',
  projectName: '',
  projectCode: '',
  enabledForSiteAccount: true,
  assignedPersonId: '',
  assignedPersonName: '',
  assignedPersonEmail: '',
  altUserId: '', altUserName: '', altUserEmail: '',
  viewerId: '', viewerName: '', viewerEmail: '',
  status: 'Active',
});

export default function ProjectSettingsPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { log } = useActivityLogger('Site Account Statement');
  const { toast } = useToast();

  const canView   = can('View',   `${MODULE}.${RESOURCE}`) || can('View Module', MODULE);
  const canAdd    = can('Add',    `${MODULE}.${RESOURCE}`);
  const canEdit   = can('Edit',   `${MODULE}.${RESOURCE}`);
  const canDelete = can('Delete', `${MODULE}.${RESOURCE}`);

  const [rows,           setRows]           = useState<SASProject[]>([]);
  const [centralProjects, setCentralProjects] = useState<Project[]>([]);
  const [users,          setUsers]          = useState<User[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [saving,         setSaving]         = useState(false);
  const [dialogOpen,     setDialogOpen]     = useState(false);
  const [editingRow,     setEditingRow]     = useState<SASProject | null>(null);
  const [form,           setForm]           = useState<FormState>(blank());
  const [search,         setSearch]         = useState('');

  useEffect(() => {
    if (!isAuthLoading && canView) void loadAll();
  }, [isAuthLoading, canView]);

  async function loadAll() {
    setLoading(true);
    try {
      const [sasSnap, projSnap, userSnap] = await Promise.all([
        getDocs(query(collection(db, SAS_COLLECTIONS.projects), orderBy('projectName'))),
        getDocs(query(collection(db, 'projects'), orderBy('projectName'))),
        getDocs(collection(db, 'users')),
      ]);
      setRows(sasSnap.docs.map(d => ({ id: d.id, ...d.data() } as SASProject)));
      setCentralProjects(projSnap.docs.map(d => ({ id: d.id, ...d.data() } as Project)).filter(p => p.status === 'Active'));
      setUsers(userSnap.docs.map(d => ({ id: d.id, ...d.data() } as User)).filter(u => u.status === 'Active').sort((a, b) => a.name.localeCompare(b.name)));
    } finally {
      setLoading(false);
    }
  }

  const availableCentralProjects = useMemo(() => {
    const usedIds = new Set(rows.map(r => r.centralProjectId).filter(Boolean));
    return centralProjects.filter(p => !usedIds.has(p.id));
  }, [centralProjects, rows]);

  function openAdd() {
    setEditingRow(null);
    setForm(blank());
    setDialogOpen(true);
  }

  function openEdit(row: SASProject) {
    setEditingRow(row);
    setForm({
      centralProjectId:    row.centralProjectId || '',
      projectName:         row.projectName,
      projectCode:         row.projectCode || '',
      enabledForSiteAccount: row.enabledForSiteAccount !== false,
      assignedPersonId:    row.assignedPersonId || '',
      assignedPersonName:  row.assignedPersonName || '',
      assignedPersonEmail: row.assignedPersonEmail || '',
      altUserId:           row.altUserId    || '',
      altUserName:         row.altUserName  || '',
      altUserEmail:        row.altUserEmail || '',
      viewerId:            row.viewerId     || '',
      viewerName:          row.viewerName   || '',
      viewerEmail:         row.viewerEmail  || '',
      status:              row.status || 'Active',
    });
    setDialogOpen(true);
  }

  function selectCentralProject(id: string) {
    const proj = centralProjects.find(p => p.id === id);
    if (!proj) return;
    setForm(f => ({
      ...f,
      centralProjectId: id,
      projectName: proj.projectName,
      projectCode: proj.siteCode || '',
    }));
  }

  function selectUser(id: string) {
    const user = users.find(u => u.id === id);
    if (!user) return;
    setForm(f => ({
      ...f,
      assignedPersonId:    id,
      assignedPersonName:  user.name,
      assignedPersonEmail: user.email,
    }));
  }

  function selectAltUser(id: string) {
    if (id === '_none_') { setForm(f => ({ ...f, altUserId: '', altUserName: '', altUserEmail: '' })); return; }
    const user = users.find(u => u.id === id);
    if (!user) return;
    setForm(f => ({ ...f, altUserId: id, altUserName: user.name, altUserEmail: user.email }));
  }

  function selectViewer(id: string) {
    if (id === '_none_') { setForm(f => ({ ...f, viewerId: '', viewerName: '', viewerEmail: '' })); return; }
    const user = users.find(u => u.id === id);
    if (!user) return;
    setForm(f => ({ ...f, viewerId: id, viewerName: user.name, viewerEmail: user.email }));
  }

  function setField(key: keyof FormState, value: any) {
    setForm(f => ({ ...f, [key]: value }));
  }

  async function handleSubmit() {
    if (!form.centralProjectId && !editingRow) {
      toast({ title: 'Validation', description: 'Select a project from the central hub.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const data = {
        centralProjectId:    form.centralProjectId,
        projectName:         form.projectName,
        projectCode:         form.projectCode,
        enabledForSiteAccount: form.enabledForSiteAccount,
        assignedPersonId:    form.assignedPersonId,
        assignedPersonName:  form.assignedPersonName,
        assignedPersonEmail: form.assignedPersonEmail,
        altUserId:           form.altUserId,
        altUserName:         form.altUserName,
        altUserEmail:        form.altUserEmail,
        viewerId:            form.viewerId,
        viewerName:          form.viewerName,
        viewerEmail:         form.viewerEmail,
        status:              form.status,
        updatedAt:           serverTimestamp(),
      };
      if (editingRow) {
        await updateDoc(doc(db, SAS_COLLECTIONS.projects, editingRow.id), data);
        void log('Edit SAS Project', { name: form.projectName });
        toast({ title: 'Updated', description: `"${form.projectName}" updated.` });
      } else {
        await addDoc(collection(db, SAS_COLLECTIONS.projects), { ...data, createdAt: serverTimestamp() });
        void log('Add SAS Project', { name: form.projectName });
        toast({ title: 'Added', description: `"${form.projectName}" added.` });
      }
      setDialogOpen(false);
      void loadAll();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(row: SASProject) {
    try {
      await deleteDoc(doc(db, SAS_COLLECTIONS.projects, row.id));
      void log('Delete SAS Project', { name: row.projectName });
      toast({ title: 'Deleted', description: `"${row.projectName}" deleted.` });
      void loadAll();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  }

  const filtered = rows.filter(r =>
    r.projectName.toLowerCase().includes(search.toLowerCase()) ||
    (r.projectCode || '').toLowerCase().includes(search.toLowerCase()) ||
    (r.assignedPersonName || '').toLowerCase().includes(search.toLowerCase()) ||
    (r.altUserName  || '').toLowerCase().includes(search.toLowerCase()) ||
    (r.viewerName   || '').toLowerCase().includes(search.toLowerCase())
  );

  const editDialogProjects = useMemo(() => {
    if (!editingRow) return availableCentralProjects;
    const current = centralProjects.find(p => p.id === editingRow.centralProjectId);
    if (!current) return availableCentralProjects;
    return [current, ...availableCentralProjects.filter(p => p.id !== current.id)];
  }, [editingRow, availableCentralProjects, centralProjects]);

  if (isAuthLoading || loading) {
    return <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-slate-800">Project Setup</h1>
          <p className="text-sm text-muted-foreground">
            Enable projects for Site Account Statement and assign responsible persons
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/settings/project" target="_blank">
            <Button variant="outline" size="sm" className="gap-2 text-xs">
              <ExternalLink className="h-3.5 w-3.5" /> Manage Projects
            </Button>
          </Link>
          {canAdd && (
            <Button size="sm" onClick={openAdd} className="gap-2 bg-emerald-600 hover:bg-emerald-700"
              disabled={availableCentralProjects.length === 0}>
              <Plus className="h-4 w-4" /> Add Project
            </Button>
          )}
        </div>
      </div>

      {canAdd && availableCentralProjects.length === 0 && rows.length === 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No active projects found in the central project hub.{' '}
          <Link href="/settings/project" className="font-medium underline underline-offset-2">Add projects here</Link>{' '}
          first, then return to enable them for Site Account Statement.
        </div>
      )}

      <Input
        placeholder="Search by project name, code or person..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="max-w-sm"
      />

      <Card className="bg-white/80 backdrop-blur-sm">
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Settings className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {rows.length === 0 ? 'No projects configured yet.' : 'No matching projects.'}
              </p>
              {canAdd && rows.length === 0 && availableCentralProjects.length > 0 && (
                <Button size="sm" onClick={openAdd} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
                  <Plus className="h-4 w-4" /> Add First Project
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto overflow-y-auto max-h-[60vh]">
              <table className="w-full min-w-[700px] text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b bg-slate-100">
                    <th className="px-4 py-2.5 text-left font-medium">Project Name</th>
                    <th className="px-4 py-2.5 text-left font-medium">Site Code</th>
                    <th className="px-4 py-2.5 text-center font-medium">Enabled</th>
                    <th className="px-4 py-2.5 text-left font-medium">Assigned / Alt. User / Viewer</th>
                    <th className="px-4 py-2.5 text-center font-medium">Status</th>
                    {(canEdit || canDelete) && <th className="px-4 py-2.5 text-right font-medium">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(row => (
                    <tr key={row.id} className="border-b hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5 font-medium">{row.projectName}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{row.projectCode || '—'}</td>
                      <td className="px-4 py-2.5 text-center">
                        <Badge className={row.enabledForSiteAccount ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' : 'bg-slate-100 text-slate-600'}>
                          {row.enabledForSiteAccount ? 'Yes' : 'No'}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-col gap-0.5">
                          {row.assignedPersonName ? (
                            <div className="flex items-center gap-1.5">
                              <User2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                              <span className="text-xs font-medium">{row.assignedPersonName}</span>
                            </div>
                          ) : <span className="text-muted-foreground text-xs">— no primary —</span>}
                          {row.altUserName && (
                            <div className="flex items-center gap-1.5">
                              <User2 className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                              <span className="text-xs text-blue-700">{row.altUserName}</span>
                              <span className="text-[10px] text-muted-foreground">(alt)</span>
                            </div>
                          )}
                          {row.viewerName && (
                            <div className="flex items-center gap-1.5">
                              <User2 className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                              <span className="text-xs text-slate-600">{row.viewerName}</span>
                              <span className="text-[10px] text-muted-foreground">(view only)</span>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <Badge variant={row.status === 'Active' ? 'default' : 'secondary'}>
                          {row.status}
                        </Badge>
                      </td>
                      {(canEdit || canDelete) && (
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex justify-end gap-1">
                            {canEdit && (
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(row)}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {canDelete && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10">
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Remove Project</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Remove &quot;{row.projectName}&quot; from Site Account Statement? Existing transactions will not be deleted.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleDelete(row)} className="bg-destructive hover:bg-destructive/90">Remove</AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-lg overflow-y-auto max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>{editingRow ? 'Edit Project Settings' : 'Add Project'}</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2 space-y-1.5">
              <Label>
                Project <span className="text-destructive">*</span>
                <span className="ml-2 text-xs font-normal text-muted-foreground">(from central project hub)</span>
              </Label>
              <Select
                value={form.centralProjectId || '_none_'}
                onValueChange={v => v !== '_none_' && selectCentralProject(v)}
                disabled={!!editingRow}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a project" />
                </SelectTrigger>
                <SelectContent>
                  {(editingRow ? editDialogProjects : availableCentralProjects).length === 0 ? (
                    <SelectItem value="_none_" disabled>All projects already added</SelectItem>
                  ) : (
                    (editingRow ? editDialogProjects : availableCentralProjects).map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.projectName}{p.siteCode ? ` (${p.siteCode})` : ''}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {editingRow && (
                <p className="text-xs text-muted-foreground">Project cannot be changed after creation. Remove and re-add to change.</p>
              )}
            </div>

            {form.projectName && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground text-xs">Project Name (auto-filled)</Label>
                  <Input value={form.projectName} readOnly className="bg-muted/40 text-muted-foreground" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground text-xs">Site Code (auto-filled)</Label>
                  <Input value={form.projectCode || '—'} readOnly className="bg-muted/40 text-muted-foreground" />
                </div>
              </>
            )}

            <div className="col-span-2 space-y-1.5">
              <Label>Assigned Person</Label>
              <Select
                value={form.assignedPersonId || '_none_'}
                onValueChange={v => v === '_none_' ? setForm(f => ({ ...f, assignedPersonId: '', assignedPersonName: '', assignedPersonEmail: '' })) : selectUser(v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select responsible user" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none_">— No assignment —</SelectItem>
                  {users.map(u => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}{u.email ? ` (${u.email})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label className="flex items-center gap-1.5">
                Alternative User
                <span className="text-xs font-normal text-muted-foreground">(same access as assigned person)</span>
              </Label>
              <Select value={form.altUserId || '_none_'} onValueChange={selectAltUser}>
                <SelectTrigger>
                  <SelectValue placeholder="Select alternative user (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none_">— None —</SelectItem>
                  {users.filter(u => u.id !== form.assignedPersonId).map(u => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}{u.email ? ` (${u.email})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label className="flex items-center gap-1.5">
                Viewer
                <span className="text-xs font-normal text-muted-foreground">(read-only, can view reports & statement)</span>
              </Label>
              <Select value={form.viewerId || '_none_'} onValueChange={selectViewer}>
                <SelectTrigger>
                  <SelectValue placeholder="Select viewer (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none_">— None —</SelectItem>
                  {users.filter(u => u.id !== form.assignedPersonId && u.id !== form.altUserId).map(u => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}{u.email ? ` (${u.email})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => setField('status', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-3 pt-5">
              <Switch
                checked={form.enabledForSiteAccount}
                onCheckedChange={v => setField('enabledForSiteAccount', v)}
                id="proj-enabled"
              />
              <Label htmlFor="proj-enabled">Enable for Site Account Statement</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700">
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editingRow ? 'Save Changes' : 'Add Project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
