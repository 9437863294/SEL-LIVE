'use client';

import { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { DEFAULT_EXPENSE_CATEGORIES, SAS_COLLECTIONS, type SASCategory } from '@/lib/site-account-statement';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { CornerDownRight, Loader2, Pencil, Plus, Sprout, Tags, Trash2 } from 'lucide-react';

const MODULE = 'Site Account Statement';
const RESOURCE = 'Expense Categories';

interface FormState {
  name: string;
  description: string;
  isActive: boolean;
  parentId: string;
}

const blank = (): FormState => ({ name: '', description: '', isActive: true, parentId: '' });

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

  const mainCategories = useMemo(() => rows.filter(r => !r.parentId), [rows]);
  const subCategories  = useMemo(() => rows.filter(r => !!r.parentId),  [rows]);

  // Build display list: main cat → its sub-cats, sorted
  const displayRows = useMemo(() => {
    const result: Array<SASCategory & { isSubDisplay: boolean }> = [];
    const sorted = [...mainCategories].sort((a, b) => a.name.localeCompare(b.name));
    sorted.forEach(main => {
      if (search && !main.name.toLowerCase().includes(search.toLowerCase())) {
        // include if any sub-cat matches search
        const subs = subCategories.filter(s => s.parentId === main.id && s.name.toLowerCase().includes(search.toLowerCase()));
        if (subs.length > 0) {
          result.push({ ...main, isSubDisplay: false });
          subs.forEach(s => result.push({ ...s, isSubDisplay: true }));
        }
        return;
      }
      result.push({ ...main, isSubDisplay: false });
      const subs = subCategories
        .filter(s => s.parentId === main.id)
        .sort((a, b) => a.name.localeCompare(b.name));
      subs.forEach(s => result.push({ ...s, isSubDisplay: true }));
    });
    // Orphaned sub-cats (parent deleted) — show at bottom
    const displayedIds = new Set(result.map(r => r.id));
    subCategories.filter(s => !displayedIds.has(s.id)).forEach(s => result.push({ ...s, isSubDisplay: true }));
    return result;
  }, [mainCategories, subCategories, search]);

  function openAdd() {
    setEditingRow(null);
    setForm(blank());
    setDialogOpen(true);
  }

  function openEdit(row: SASCategory) {
    setEditingRow(row);
    setForm({
      name: row.name,
      description: row.description || '',
      isActive: row.isActive !== false,
      parentId: row.parentId || '',
    });
    setDialogOpen(true);
  }

  async function handleSubmit() {
    if (!form.name.trim()) {
      toast({ title: 'Validation', description: 'Category name is required.', variant: 'destructive' });
      return;
    }
    const parentCat = form.parentId ? mainCategories.find(c => c.id === form.parentId) : null;
    setSaving(true);
    try {
      const payload: Record<string, any> = {
        name: form.name.trim(),
        description: form.description.trim(),
        isActive: form.isActive,
        parentId: form.parentId || null,
        parentName: parentCat?.name || null,
        updatedAt: serverTimestamp(),
      };
      if (editingRow) {
        await updateDoc(doc(db, SAS_COLLECTIONS.categories, editingRow.id), payload);
        void log('Edit Expense Category', { name: form.name });
        toast({ title: 'Updated', description: `"${form.name}" updated.` });
      } else {
        await addDoc(collection(db, SAS_COLLECTIONS.categories), { ...payload, createdAt: serverTimestamp() });
        void log('Add Expense Category', { name: form.name, parent: parentCat?.name });
        toast({ title: 'Added', description: `"${form.name}" added${parentCat ? ` under "${parentCat.name}"` : ''}.` });
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
    // Prevent deleting a main category that still has sub-categories
    if (!row.parentId) {
      const children = subCategories.filter(s => s.parentId === row.id);
      if (children.length > 0) {
        toast({
          title: 'Cannot Delete',
          description: `"${row.name}" has ${children.length} sub-categor${children.length === 1 ? 'y' : 'ies'}. Delete them first.`,
          variant: 'destructive',
        });
        return;
      }
    }
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
      const existing = mainCategories.map(r => r.name.toLowerCase());
      const toAdd = DEFAULT_EXPENSE_CATEGORIES.filter(c => !existing.includes(c.toLowerCase()));
      await Promise.all(
        toAdd.map(name =>
          addDoc(collection(db, SAS_COLLECTIONS.categories), {
            name, description: '', isActive: true,
            parentId: null, parentName: null,
            createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
          })
        )
      );
      toast({ title: 'Seeded', description: `${toAdd.length} default categories added.` });
      void loadRows();
    } finally {
      setSeeding(false);
    }
  }

  if (isAuthLoading || loading) {
    return <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-slate-800">Expense Categories</h1>
          <p className="text-sm text-muted-foreground">
            {mainCategories.length} main {mainCategories.length === 1 ? 'category' : 'categories'} · {subCategories.length} sub-{subCategories.length === 1 ? 'category' : 'categories'}
          </p>
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
          {displayRows.length === 0 ? (
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
            <div className="overflow-auto max-h-[60vh]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b bg-slate-100">
                    <th className="px-4 py-2.5 text-left font-medium">#</th>
                    <th className="px-4 py-2.5 text-left font-medium">Category Name</th>
                    <th className="px-4 py-2.5 text-left font-medium">Type</th>
                    <th className="px-4 py-2.5 text-left font-medium">Description</th>
                    <th className="px-4 py-2.5 text-center font-medium">Status</th>
                    {(canEdit || canDelete) && <th className="px-4 py-2.5 text-right font-medium">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((row, idx) => (
                    <tr
                      key={row.id}
                      className={`border-b transition-colors ${row.isSubDisplay ? 'bg-slate-50/60 hover:bg-slate-100/60' : 'hover:bg-muted/20'}`}
                    >
                      <td className="px-4 py-2.5 text-muted-foreground">{idx + 1}</td>
                      <td className="px-4 py-2.5">
                        {row.isSubDisplay ? (
                          <span className="flex items-center gap-1.5 pl-4 text-slate-600">
                            <CornerDownRight className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                            {row.name}
                          </span>
                        ) : (
                          <span className="font-semibold text-slate-800">{row.name}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {row.isSubDisplay ? (
                          <Badge variant="outline" className="text-xs text-purple-700 border-purple-300 bg-purple-50">
                            Sub-category of {row.parentName || '—'}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs text-emerald-700 border-emerald-300 bg-emerald-50">
                            Main Category
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground max-w-xs truncate">{row.description || '—'}</td>
                      <td className="px-4 py-2.5 text-center">
                        <Badge
                          variant={row.isActive !== false ? 'default' : 'secondary'}
                          className={row.isActive !== false ? 'bg-emerald-100 text-emerald-700' : ''}
                        >
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
                                      Delete &quot;{row.name}&quot;?
                                      {!row.parentId && subCategories.filter(s => s.parentId === row.id).length > 0
                                        ? ` This main category has sub-categories — delete them first.`
                                        : ' Existing expenses using this category will not be affected.'}
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleDelete(row)} className="bg-destructive hover:bg-destructive/90">
                                      Delete
                                    </AlertDialogAction>
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
              <Label>Parent Category <span className="text-muted-foreground text-xs">(optional — leave blank for main category)</span></Label>
              <Select
                value={form.parentId || '_none_'}
                onValueChange={v => setForm(f => ({ ...f, parentId: v === '_none_' ? '' : v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Main Category (no parent)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none_">Main Category (no parent)</SelectItem>
                  {mainCategories
                    .filter(c => c.id !== editingRow?.id)
                    .map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)
                  }
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>
                {form.parentId ? 'Sub-Category Name' : 'Category Name'} <span className="text-destructive">*</span>
              </Label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder={form.parentId ? 'e.g. Cement, Steel Rods' : 'e.g. Material Purchase'}
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
