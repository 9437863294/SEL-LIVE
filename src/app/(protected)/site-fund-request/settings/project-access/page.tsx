'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  addDoc, collection, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { SFR_COLLECTIONS, type SFRProject } from '@/lib/site-fund-request';
import type { Project, User } from '@/lib/types';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
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
import { ArrowLeft, Loader2, Pencil, Plus, Trash2, User2, Users2 } from 'lucide-react';
import Link from 'next/link';

const MODULE   = 'Site Fund Request';
const RESOURCE = 'Settings';

interface FormState {
  centralProjectId: string;
  projectName: string;
  projectCode: string;
  assignedPersonId: string;
  assignedPersonName: string;
  altUserId: string;
  altUserName: string;
  viewerId: string;
  viewerName: string;
  status: 'Active' | 'Inactive';
}

const blank = (): FormState => ({
  centralProjectId: '',
  projectName: '',
  projectCode: '',
  assignedPersonId: '',
  assignedPersonName: '',
  altUserId: '',
  altUserName: '',
  viewerId: '',
  viewerName: '',
  status: 'Active',
});

export default function SFRProjectAccessPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { toast } = useToast();

  const canView   = can('View',   `${MODULE}.${RESOURCE}`) || can('View Module', MODULE);
  const canAdd    = can('Edit',   `${MODULE}.${RESOURCE}`);
  const canEdit   = can('Edit',   `${MODULE}.${RESOURCE}`);
  const canDelete = can('Edit',   `${MODULE}.${RESOURCE}`);

  const [rows,            setRows]            = useState<SFRProject[]>([]);
  const [centralProjects, setCentralProjects] = useState<Project[]>([]);
  const [users,           setUsers]           = useState<User[]>([]);
  const [loading,         setLoading]         = useState(true);
  const [saving,          setSaving]          = useState(false);
  const [dialogOpen,      setDialogOpen]      = useState(false);
  const [editingRow,      setEditingRow]      = useState<SFRProject | null>(null);
  const [form,            setForm]            = useState<FormState>(blank());
  const [search,          setSearch]          = useState('');

  useEffect(() => {
    if (!isAuthLoading && canView) void loadAll();
  }, [isAuthLoading, canView]);

  async function loadAll() {
    setLoading(true);
    try {
      const [sasSnap, projSnap, userSnap] = await Promise.all([
        getDocs(query(collection(db, SFR_COLLECTIONS.projects), orderBy('projectName'))),
        getDocs(query(collection(db, 'projects'), orderBy('projectName'))),
        getDocs(collection(db, 'users')),
      ]);
      setRows(sasSnap.docs.map(d => ({ id: d.id, ...d.data() } as SFRProject)));
      setCentralProjects(
        projSnap.docs
          .map(d => ({ id: d.id, ...d.data() } as Project))
          .filter(p => p.status === 'Active'),
      );
      setUsers(
        userSnap.docs
          .map(d => ({ id: d.id, ...d.data() } as User))
          .filter(u => u.status === 'Active')
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    } finally {
      setLoading(false);
    }
  }

  // Projects not yet added (for add dialog)
  const availableCentralProjects = useMemo(() => {
    const usedIds = new Set(rows.map(r => r.centralProjectId).filter(Boolean));
    return centralProjects.filter(p => !usedIds.has(p.id));
  }, [centralProjects, rows]);

  // In edit mode, ensure the current project always appears first
  const editDialogProjects = useMemo(() => {
    if (!editingRow) return availableCentralProjects;
    const current = centralProjects.find(p => p.id === editingRow.centralProjectId);
    if (!current) return availableCentralProjects;
    return [current, ...availableCentralProjects.filter(p => p.id !== current.id)];
  }, [editingRow, availableCentralProjects, centralProjects]);

  function openAdd() {
    setEditingRow(null);
    setForm(blank());
    setDialogOpen(true);
  }

  function openEdit(row: SFRProject) {
    setEditingRow(row);
    setForm({
      centralProjectId:  row.centralProjectId || '',
      projectName:       row.projectName,
      projectCode:       row.projectCode || '',
      assignedPersonId:  row.assignedPersonId || '',
      assignedPersonName: row.assignedPersonName || '',
      altUserId:         row.altUserId   || '',
      altUserName:       row.altUserName || '',
      viewerId:          row.viewerId    || '',
      viewerName:        row.viewerName  || '',
      status:            row.status || 'Active',
    });
    setDialogOpen(true);
  }

  function selectCentralProject(id: string) {
    const proj = centralProjects.find(p => p.id === id);
    if (!proj) return;
    setForm(f => ({
      ...f,
      centralProjectId: id,
      projectName:      proj.projectName,
      projectCode:      proj.siteCode || '',
    }));
  }

  function selectAssignedPerson(id: string) {
    if (id === '_none_') {
      setForm(f => ({ ...f, assignedPersonId: '', assignedPersonName: '' }));
      return;
    }
    const user = users.find(u => u.id === id);
    if (!user) return;
    setForm(f => ({ ...f, assignedPersonId: id, assignedPersonName: user.name }));
  }

  function selectAltUser(id: string) {
    if (id === '_none_') {
      setForm(f => ({ ...f, altUserId: '', altUserName: '' }));
      return;
    }
    const user = users.find(u => u.id === id);
    if (!user) return;
    setForm(f => ({ ...f, altUserId: id, altUserName: user.name }));
  }

  function selectViewer(id: string) {
    if (id === '_none_') {
      setForm(f => ({ ...f, viewerId: '', viewerName: '' }));
      return;
    }
    const user = users.find(u => u.id === id);
    if (!user) return;
    setForm(f => ({ ...f, viewerId: id, viewerName: user.name }));
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(f => ({ ...f, [key]: value }));
  }

  async function handleSubmit() {
    if (!form.centralProjectId && !editingRow) {
      toast({ title: 'Validation', description: 'Select a project from the central hub.', variant: 'destructive' });
      return;
    }
    if (!form.assignedPersonId) {
      toast({ title: 'Validation', description: 'Assigned Person is required.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const data = {
        centralProjectId:   form.centralProjectId,
        projectName:        form.projectName,
        projectCode:        form.projectCode,
        assignedPersonId:   form.assignedPersonId,
        assignedPersonName: form.assignedPersonName,
        altUserId:          form.altUserId,
        altUserName:        form.altUserName,
        viewerId:           form.viewerId,
        viewerName:         form.viewerName,
        status:             form.status,
        updatedAt:          serverTimestamp(),
      };
      if (editingRow) {
        await updateDoc(doc(db, SFR_COLLECTIONS.projects, editingRow.id), data);
        toast({ title: 'Updated', description: `"${form.projectName}" updated.` });
      } else {
        await addDoc(collection(db, SFR_COLLECTIONS.projects), { ...data, createdAt: serverTimestamp() });
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

  async function handleDelete(row: SFRProject) {
    try {
      await deleteDoc(doc(db, SFR_COLLECTIONS.projects, row.id));
      toast({ title: 'Deleted', description: `"${row.projectName}" removed.` });
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
    (r.viewerName   || '').toLowerCase().includes(search.toLowerCase()),
  );

  if (isAuthLoading || loading) {
    return (
      <div className="w-full space-y-6 p-4 sm:p-6">
        <div className="space-y-2">
          <Skeleton className="h-4 w-32 rounded" />
          <Skeleton className="h-8 w-56 rounded" />
          <Skeleton className="h-4 w-80 rounded" />
        </div>
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6 p-4 sm:p-6">
      {/* Page header */}
      <div className="flex items-start gap-3">
        <Link href="/site-fund-request/settings">
          <Button variant="ghost" size="icon" className="mt-0.5 h-8 w-8 shrink-0 text-slate-500 hover:text-slate-800">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
            Site Fund Request / Settings
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Project Access</h1>
          <p className="mt-0.5 text-sm text-slate-600">
            Assign users to projects for the fund request module.
          </p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search by project name, code or person..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-sm"
        />
        {canAdd && (
          <Button
            size="sm"
            onClick={openAdd}
            disabled={availableCentralProjects.length === 0}
            className="ml-auto gap-2 bg-teal-600 hover:bg-teal-700 text-white"
          >
            <Plus className="h-4 w-4" />
            Add Project
          </Button>
        )}
      </div>

      {/* No projects in hub warning */}
      {canAdd && availableCentralProjects.length === 0 && rows.length === 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No active projects found in the central project hub.{' '}
          <Link href="/settings/project" className="font-medium underline underline-offset-2">
            Add projects here
          </Link>{' '}
          first, then return to assign them.
        </div>
      )}

      {/* Card list */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/70 bg-white/65 py-16 text-center shadow-[0_18px_60px_-45px_rgba(2,6,23,0.35)] backdrop-blur">
          <Users2 className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            {rows.length === 0 ? 'No projects configured yet.' : 'No matching projects.'}
          </p>
          {canAdd && rows.length === 0 && availableCentralProjects.length > 0 && (
            <Button size="sm" onClick={openAdd} className="gap-2 bg-teal-600 hover:bg-teal-700 text-white">
              <Plus className="h-4 w-4" />
              Add First Project
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(row => (
            <Card
              key={row.id}
              className="overflow-hidden rounded-2xl border border-white/70 bg-white/65 shadow-[0_18px_60px_-45px_rgba(2,6,23,0.35)] backdrop-blur"
            >
              {/* Accent bar */}
              <div className="h-1.5 w-full bg-gradient-to-r from-teal-400 via-emerald-400 to-cyan-400 opacity-70" />

              <CardContent className="p-5">
                {/* Project name + badges */}
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900 leading-tight">
                      {row.projectName}
                    </p>
                    <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                      {row.projectCode && (
                        <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">
                          {row.projectCode}
                        </Badge>
                      )}
                      <Badge
                        className={
                          row.status === 'Active'
                            ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100 text-[10px] px-1.5 py-0'
                            : 'bg-red-100 text-red-600 hover:bg-red-100 text-[10px] px-1.5 py-0'
                        }
                      >
                        {row.status}
                      </Badge>
                    </div>
                  </div>

                  {/* Action buttons */}
                  {(canEdit || canDelete) && (
                    <div className="flex shrink-0 items-center gap-1">
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-slate-500 hover:text-teal-700"
                          onClick={() => openEdit(row)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {canDelete && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-slate-500 hover:text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove Project</AlertDialogTitle>
                              <AlertDialogDescription>
                                Remove &quot;{row.projectName}&quot; from Site Fund Request access settings?
                                Existing requests will not be deleted.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDelete(row)}
                                className="bg-destructive hover:bg-destructive/90"
                              >
                                Remove
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  )}
                </div>

                {/* User rows */}
                <div className="space-y-1.5 border-t border-slate-100 pt-3">
                  {/* Assigned Person */}
                  <div className="flex items-center gap-2">
                    <User2 className="h-3.5 w-3.5 shrink-0 text-teal-600" />
                    <span className="text-[11px] font-medium text-slate-500 w-28 shrink-0">Assigned Person</span>
                    <span className="text-xs text-slate-800 truncate">
                      {row.assignedPersonName || '—'}
                    </span>
                  </div>
                  {/* Alternative User */}
                  <div className="flex items-center gap-2">
                    <User2 className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                    <span className="text-[11px] font-medium text-slate-500 w-28 shrink-0">Alternative User</span>
                    <span className="text-xs text-slate-600 truncate">
                      {row.altUserName || '—'}
                    </span>
                  </div>
                  {/* Viewer */}
                  <div className="flex items-center gap-2">
                    <User2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="text-[11px] font-medium text-slate-500 w-28 shrink-0">Viewer</span>
                    <span className="text-xs text-slate-500 truncate">
                      {row.viewerName || '—'}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingRow ? 'Edit Project Access' : 'Add Project Access'}
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4 py-2">
            {/* Project picker */}
            <div className="col-span-2 space-y-1.5">
              <Label>
                Project <span className="text-destructive">*</span>
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  (from central project hub)
                </span>
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
                <p className="text-xs text-muted-foreground">
                  Project cannot be changed after creation. Remove and re-add to change.
                </p>
              )}
            </div>

            {/* Auto-filled read-only fields */}
            {form.projectName && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground text-xs">Project Name (auto-filled)</Label>
                  <Input value={form.projectName} readOnly className="bg-muted/40 text-muted-foreground" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground text-xs">Project Code (auto-filled)</Label>
                  <Input value={form.projectCode || '—'} readOnly className="bg-muted/40 text-muted-foreground" />
                </div>
              </>
            )}

            {/* Assigned Person (required) */}
            <div className="col-span-2 space-y-1.5">
              <Label>
                Assigned Person <span className="text-destructive">*</span>
              </Label>
              <Select
                value={form.assignedPersonId || '_none_'}
                onValueChange={selectAssignedPerson}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select assigned person" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none_">— Select a person —</SelectItem>
                  {users.map(u => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Alternative User (optional) */}
            <div className="col-span-2 space-y-1.5">
              <Label className="flex items-center gap-1.5">
                Alternative User
                <span className="text-xs font-normal text-muted-foreground">
                  (same access as assigned person, optional)
                </span>
              </Label>
              <Select
                value={form.altUserId || '_none_'}
                onValueChange={selectAltUser}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select alternative user (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none_">— None —</SelectItem>
                  {users
                    .filter(u => u.id !== form.assignedPersonId)
                    .map(u => (
                      <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {/* Viewer (optional) */}
            <div className="col-span-2 space-y-1.5">
              <Label className="flex items-center gap-1.5">
                Viewer
                <span className="text-xs font-normal text-muted-foreground">
                  (read-only access to requests and reports, optional)
                </span>
              </Label>
              <Select
                value={form.viewerId || '_none_'}
                onValueChange={selectViewer}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select viewer (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none_">— None —</SelectItem>
                  {users
                    .filter(u => u.id !== form.assignedPersonId && u.id !== form.altUserId)
                    .map(u => (
                      <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {/* Status */}
            <div className="col-span-2 space-y-1.5">
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={v => setField('status', v as 'Active' | 'Inactive')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={saving}
              className="bg-teal-600 hover:bg-teal-700 text-white"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editingRow ? 'Save Changes' : 'Add Project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
