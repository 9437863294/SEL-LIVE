
'use client';

import { useEffect, useState } from 'react';
import { Building2, Edit, Plus, Search, ShieldAlert, Trash2, X } from 'lucide-react';
import { addDoc, collection, deleteDoc, doc, getDocs, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import type { InsuranceCompany } from '@/lib/types';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogClose,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

const INIT = { name: '', status: 'Active' as 'Active' | 'Inactive' };

export default function ManageInsuranceCompaniesPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();

  const canViewPage = can('View', 'Insurance.Settings.Companies');
  const canAdd      = can('Add',  'Insurance.Settings.Companies');
  const canEdit     = can('Edit', 'Insurance.Settings.Companies');
  const canDelete   = can('Delete','Insurance.Settings.Companies');

  const [companies, setCompanies] = useState<InsuranceCompany[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mode, setMode] = useState<'add' | 'edit'>('add');
  const [form, setForm] = useState(INIT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const fetchCompanies = async () => {
    setIsLoading(true);
    try {
      const snap = await getDocs(collection(db, 'insuranceCompanies'));
      setCompanies(snap.docs.map((d) => ({ id: d.id, ...d.data() } as InsuranceCompany)));
    } catch {
      toast({ title: 'Error', description: 'Failed to load companies.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    if (canViewPage) fetchCompanies(); else setIsLoading(false);
  }, [canViewPage, authLoading]); // eslint-disable-line

  const openAdd = () => { setMode('add'); setForm(INIT); setEditingId(null); setDialogOpen(true); };
  const openEdit = (c: InsuranceCompany) => { setMode('edit'); setForm({ name: c.name, status: c.status || 'Active' }); setEditingId(c.id); setDialogOpen(true); };

  const handleSubmit = async () => {
    if (!form.name.trim()) { toast({ title: 'Validation', description: 'Company name is required.', variant: 'destructive' }); return; }
    setIsSaving(true);
    try {
      if (mode === 'edit' && editingId) {
        await updateDoc(doc(db, 'insuranceCompanies', editingId), form);
        toast({ title: 'Updated', description: 'Company updated successfully.' });
      } else {
        await addDoc(collection(db, 'insuranceCompanies'), form);
        toast({ title: 'Added', description: 'Company added successfully.' });
      }
      setDialogOpen(false);
      fetchCompanies();
    } catch {
      toast({ title: 'Error', description: 'Failed to save.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'insuranceCompanies', id));
      toast({ title: 'Deleted', description: 'Company deleted.' });
      fetchCompanies();
    } catch {
      toast({ title: 'Error', description: 'Failed to delete.', variant: 'destructive' });
    }
  };

  const filtered = search.trim()
    ? companies.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
    : companies;

  const activeCount   = companies.filter((c) => c.status === 'Active').length;
  const inactiveCount = companies.filter((c) => c.status === 'Inactive').length;

  if (authLoading || (isLoading && canViewPage)) {
    return <div className="space-y-4"><Skeleton className="h-24 w-full rounded-xl" /><Skeleton className="h-64 w-full rounded-xl" /></div>;
  }

  if (!canViewPage) {
    return <Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-destructive" /> Access Denied</CardTitle><CardDescription>You do not have permission to view this page.</CardDescription></CardHeader></Card>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="overflow-hidden border-border/60">
        <div className="h-1 w-full bg-gradient-to-r from-blue-500 via-indigo-500 to-violet-500" />
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 ring-1 ring-blue-100">
              <Building2 className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <CardTitle className="tracking-tight">Insurance Companies</CardTitle>
              <CardDescription>Manage the master list of insurance providers</CardDescription>
            </div>
          </div>
          {canAdd && (
            <Button size="sm" onClick={openAdd} className="gap-1.5 w-fit bg-blue-600 hover:bg-blue-700 text-white">
              <Plus className="h-3.5 w-3.5" /> Add Company
            </Button>
          )}
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-2 border-t pt-4">
          {[
            { label: 'Total',    value: companies.length,  color: 'text-slate-700' },
            { label: 'Active',   value: activeCount,       color: 'text-emerald-600' },
            { label: 'Inactive', value: inactiveCount,     color: 'text-slate-400' },
          ].map((s) => (
            <div key={s.label} className="flex flex-col items-center rounded-lg py-2">
              <span className={cn('text-2xl font-bold', s.color)}>{s.value}</span>
              <span className="text-[11px] text-muted-foreground">{s.label}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Search */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search companies…" className="pl-8 h-9 text-sm" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>}
        </div>
        <span className="text-xs text-muted-foreground">{filtered.length} companies</span>
      </div>

      {/* Table */}
      <Card className="overflow-hidden border-border/60">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>Company Name</TableHead>
              <TableHead>Status</TableHead>
              {(canEdit || canDelete) && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow><TableCell colSpan={3} className="h-24 text-center text-muted-foreground">No companies found.</TableCell></TableRow>
            ) : filtered.map((company) => (
              <TableRow key={company.id} className="hover:bg-muted/20 transition-colors">
                <TableCell className="font-medium">{company.name}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={cn('text-[10px]', company.status === 'Active' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200')}>
                    {company.status}
                  </Badge>
                </TableCell>
                {(canEdit || canDelete) && (
                  <TableCell className="text-right space-x-2">
                    {canEdit && (
                      <Button variant="ghost" size="sm" onClick={() => openEdit(company)} className="h-7 gap-1 text-xs">
                        <Edit className="h-3 w-3" /> Edit
                      </Button>
                    )}
                    {canDelete && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-destructive hover:text-destructive hover:bg-red-50">
                            <Trash2 className="h-3 w-3" /> Delete
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="max-w-sm">
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Company</AlertDialogTitle>
                            <AlertDialogDescription>Are you sure you want to delete <strong>{company.name}</strong>? This cannot be undone.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDelete(company.id)} className="bg-red-600 hover:bg-red-700 text-white">Delete</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{mode === 'add' ? 'Add Insurance Company' : 'Edit Insurance Company'}</DialogTitle>
            <DialogDescription>{mode === 'add' ? 'Add a new insurance provider to the master list.' : 'Update the company details.'}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Company Name <span className="text-rose-500">*</span></Label>
              <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. HDFC Ergo" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status</Label>
              <Select value={form.status} onValueChange={(v: 'Active' | 'Inactive') => setForm((p) => ({ ...p, status: v }))}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" size="sm">Cancel</Button></DialogClose>
            <Button size="sm" onClick={handleSubmit} disabled={isSaving}>{isSaving ? 'Saving…' : mode === 'add' ? 'Add Company' : 'Save Changes'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
