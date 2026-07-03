'use client';

import { useEffect, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { DEFAULT_EXPENSE_CATEGORIES, SAS_COLLECTIONS, type SASCategory } from '@/lib/site-account-statement';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Loader2, Pencil, Plus, Sprout, Tags, Trash2 } from 'lucide-react';

const MODULE = 'Site Account Statement';
const RESOURCE = 'Expense Categories';

interface FormState {
  name: string;
  description: string;
  isActive: boolean;
}

const blank = (): FormState => ({ name: '', description: '', isActive: true });

export default function ExpenseCategoriesPage() {
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { log } = useActivityLogger('Site Account Statement');
  const { toast } = useToast();

  const canView   = can('View',   `${MODULE}.${RESOURCE}`) || can('View Module', MODULE);
  const canAdd    = can('Add',    `${MODULE}.${RESOURCE}`);
  const canEdit   = can('Edit',   `${MODULE}.${RESOURCE}`);
  const canDelete = can('Delete', `${MODULE}.${RESOURCE}`);

  const [rows, setRows]       = useState<SASCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<SASCategory | null>(null);
  const [form, setForm]       = useState<FormState>(blank());
  const [search, setSearch]   = useState('');

  useEffect(() => {
    if (!isAuthLoading && canView) void loadRows();
  }, [isAuthLoading, canView]);

  async function loadRows() {
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, SAS_COLLECTIONS.categories), orderBy('name')));
      setRows(snap.docs.map(d => ({ id: d.id, ...d.data() } as SASCategory)));
    } finally {
      setLoading(false);
    }
  }

  function openAdd() {
    setEditingRow(null);
    setForm(blank());
    setDialogOpen(true);
  }

  function openEdit(row: SASCategory) {
    setEditingRow(row);
    setForm({ name: row.name, description: row.description || '', isActive: row.isActive !== false });
    setDialogOpen(true);
  }

  async function handleSubmit() {
    if (!form.name.trim()) {
      toast({ title: 'Validation', description: 'Category name is required.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      if (editingRow) {
        await updateDoc(doc(db, SAS_COLLECTIONS.categories, editingRow.id), {
          name: form.name.trim(),
          description: form.description.trim(),
          isActive: form.isActive,
          updatedAt: serverTimestamp(),
        });
        void log('Edit Expense Category', { name: form.name });
        toast({ title: 'Updated', description: `"${form.name}" updated.` });
      } else {
        await addDoc(collection(db, SAS_COLLECTIONS.categories), {
          name: form.name.trim(),
          description: form.description.trim(),
          isActive: form.isActive,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        void log('Add Expense Category', { name: form.name });
        toast({ title: 'Added', description: `"${form.name}" added.` });
      }
      setDialogOpen(false);
      void loadRows();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(row: SASCategory) {
    try {
      await deleteDoc(doc(db, SAS_COLLECTIONS.categories, row.id));
      void log('Delete Expense Category', { name: row.name });
      toast({ title: 'Deleted', description: `"${row.name}" deleted.` });
      void loadRows();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  }

  async function seedDefaults() {
    setSeeding(true);
    try {
      const existing = rows.map(r => r.name.toLowerCase());
      const toAdd = DEFAULT_EXPENSE_CATEGORIES.filter(c => !existing.includes(c.toLowerCase()));
      await Promise.all(
        toAdd.map(name =>
          addDoc(collection(db, SAS_COLLECTIONS.categories), {
            name,
            description: '',
            isActive: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        )
      );
      toast({ title: 'Seeded', description: `${toAdd.length} default categories added.` });
      void loadRows();
    } finally {
      setSeeding(false);
    }
  }

  const filtered = rows.filter(r => r.name.toLowerCase().includes(search.toLowerCase()));

  if (isAuthLoading || loading) {
    return <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-slate-800">Expense Categories</h1>
          <p className="text-sm text-muted-foreground">{rows.length} categories configured</p>
        </div>
        <div className="flex gap-2">
          {canAdd && rows.length === 0 && (
            <Button variant="outline" size="sm" onClick={seedDefaults} disabled={seeding} className="gap-2">
              {seeding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sprout className="h-4 w-4" />}
              Seed Defaults
            </Button>
          )}
          {canAdd && (
            <Button size="sm" onClick={openAdd} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
              <Plus className="h-4 w-4" /> Add Category
            </Button>
          )}
        </div>
      </div>

      <Input
        placeholder="Search categories..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="max-w-xs"
      />

      <Card className="bg-white/80 backdrop-blur-sm">
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Tags className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {rows.length === 0 ? 'No categories yet. Seed defaults or add manually.' : 'No matching categories.'}
              </p>
              {canAdd && rows.length === 0 && (
                <Button variant="outline" size="sm" onClick={seedDefaults} disabled={seeding}>
                  {seeding ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sprout className="h-4 w-4 mr-2" />}
                  Seed Default Categories
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="px-4 py-2.5 text-left font-medium">#</th>
                    <th className="px-4 py-2.5 text-left font-medium">Category Name</th>
                    <th className="px-4 py-2.5 text-left font-medium">Description</th>
                    <th className="px-4 py-2.5 text-center font-medium">Status</th>
                    {(canEdit || canDelete) && <th className="px-4 py-2.5 text-right font-medium">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row, idx) => (
                    <tr key={row.id} className="border-b hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5 text-muted-foreground">{idx + 1}</td>
                      <td className="px-4 py-2.5 font-medium">{row.name}</td>
                      <td className="px-4 py-2.5 text-muted-foreground max-w-xs truncate">{row.description || '—'}</td>
                      <td className="px-4 py-2.5 text-center">
                        <Badge variant={row.isActive !== false ? 'default' : 'secondary'} className={row.isActive !== false ? 'bg-emerald-100 text-emerald-700' : ''}>
                          {row.isActive !== false ? 'Active' : 'Inactive'}
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
                                    <AlertDialogTitle>Delete Category</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Delete &quot;{row.name}&quot;? Existing expenses using this category will not be affected.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleDelete(row)} className="bg-destructive hover:bg-destructive/90">Delete</AlertDialogAction>
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingRow ? 'Edit Category' : 'Add Expense Category'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Category Name <span className="text-destructive">*</span></Label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Labour Payment"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Optional description"
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={form.isActive}
                onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))}
                id="cat-active"
              />
              <Label htmlFor="cat-active">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700">
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editingRow ? 'Save Changes' : 'Add Category'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
