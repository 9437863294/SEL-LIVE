
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Edit, Trash2, Component } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import type { MainItem, SubItem } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BomDialog } from '@/components/BomDialog';

const initialMainItemState = { name: '' };
const initialSubItemState = { name: '', unit: '' };

export default function ManageItemsPage() {
  const { toast } = useToast();
  const [mainItems, setMainItems] = useState<MainItem[]>([]);
  const [subItems, setSubItems] = useState<SubItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Dialog state
  const [isMainItemDialogOpen, setIsMainItemDialogOpen] = useState(false);
  const [isSubItemDialogOpen, setIsSubItemDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'add' | 'edit'>('add');
  const [mainItemFormData, setMainItemFormData] = useState(initialMainItemState);
  const [subItemFormData, setSubItemFormData] = useState(initialSubItemState);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // BOM Dialog State
  const [isBomDialogOpen, setIsBomDialogOpen] = useState(false);
  const [selectedMainItem, setSelectedMainItem] = useState<MainItem | null>(null);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [mainItemsSnap, subItemsSnap] = await Promise.all([
        getDocs(collection(db, 'main_items')),
        getDocs(collection(db, 'sub_items')),
      ]);
      setMainItems(mainItemsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as MainItem)));
      setSubItems(subItemsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as SubItem)));
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to fetch items.', variant: 'destructive' });
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [toast]);
  
  // --- Main Item Handlers ---
  const openMainItemDialog = (mode: 'add' | 'edit', item?: MainItem) => {
    setDialogMode(mode);
    if (mode === 'edit' && item) {
      setMainItemFormData({ name: item.name });
      setEditingId(item.id);
    } else {
      setMainItemFormData(initialMainItemState);
      setEditingId(null);
    }
    setIsMainItemDialogOpen(true);
  };

  const handleMainItemSubmit = async () => {
    if (!mainItemFormData.name.trim()) {
      toast({ title: 'Validation Error', description: 'Main item name is required.', variant: 'destructive' });
      return;
    }
    try {
      if (dialogMode === 'edit' && editingId) {
        await updateDoc(doc(db, 'main_items', editingId), mainItemFormData);
        toast({ title: 'Success', description: 'Main item updated.' });
      } else {
        await addDoc(collection(db, 'main_items'), mainItemFormData);
        toast({ title: 'Success', description: 'New main item added.' });
      }
      setIsMainItemDialogOpen(false);
      fetchData();
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to save main item.', variant: 'destructive' });
    }
  };
  
  const handleDeleteMainItem = async (id: string) => {
      await deleteDoc(doc(db, 'main_items', id));
      toast({title: 'Success', description: 'Main item deleted.'});
      fetchData();
  }

  // --- Sub Item Handlers ---
  const openSubItemDialog = (mode: 'add' | 'edit', item?: SubItem) => {
    setDialogMode(mode);
    if (mode === 'edit' && item) {
      setSubItemFormData({ name: item.name, unit: item.unit });
      setEditingId(item.id);
    } else {
      setSubItemFormData(initialSubItemState);
      setEditingId(null);
    }
    setIsSubItemDialogOpen(true);
  };
  
  const handleSubItemSubmit = async () => {
      if (!subItemFormData.name.trim() || !subItemFormData.unit.trim()) {
          toast({ title: 'Validation Error', description: 'Sub-item name and unit are required.', variant: 'destructive'});
          return;
      }
       try {
          if (dialogMode === 'edit' && editingId) {
            await updateDoc(doc(db, 'sub_items', editingId), subItemFormData);
            toast({ title: 'Success', description: 'Sub-item updated.' });
          } else {
            await addDoc(collection(db, 'sub_items'), subItemFormData);
            toast({ title: 'Success', description: 'New sub-item added.' });
          }
          setIsSubItemDialogOpen(false);
          fetchData();
        } catch (error) {
          toast({ title: 'Error', description: 'Failed to save sub-item.', variant: 'destructive' });
        }
  }
  
   const handleDeleteSubItem = async (id: string) => {
      await deleteDoc(doc(db, 'sub_items', id));
      toast({title: 'Success', description: 'Sub-item deleted.'});
      fetchData();
  }
  
  const openBomDialog = (item: MainItem) => {
      setSelectedMainItem(item);
      setIsBomDialogOpen(true);
  }


  return (
    <>
      <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/store-stock-management">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-6 w-6" />
              </Button>
            </Link>
            <h1 className="text-xl font-bold">Item Master</h1>
          </div>
           <Link href="/store-stock-management/items/bom">
                <Button variant="outline">
                    <Component className="mr-2 h-4 w-4" /> Manage BOM
                </Button>
            </Link>
        </div>

        <Tabs defaultValue="main-items">
            <TabsList className="mb-4">
                <TabsTrigger value="main-items">Main Items</TabsTrigger>
                <TabsTrigger value="sub-items">Sub-Items</TabsTrigger>
            </TabsList>
            <TabsContent value="main-items">
                <Card>
                    <CardHeader>
                        <div className="flex justify-between items-center">
                            <div>
                                <CardTitle>Main Items</CardTitle>
                                <CardDescription>Define the primary items or products.</CardDescription>
                            </div>
                            <Button onClick={() => openMainItemDialog('add')}>
                                <Plus className="mr-2 h-4 w-4" /> Add Main Item
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Item Name</TableHead>
                            <TableHead>Items in BOM</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {isLoading ? (
                            Array.from({ length: 3 }).map((_, i) => (
                              <TableRow key={i}><TableCell colSpan={3}><Skeleton className="h-8" /></TableCell></TableRow>
                            ))
                          ) : mainItems.map(item => (
                              <TableRow key={item.id}>
                                <TableCell>{item.name}</TableCell>
                                <TableCell>{item.bom?.length || 0}</TableCell>
                                <TableCell className="text-right">
                                  <Button variant="outline" size="sm" onClick={() => openBomDialog(item)}>Edit BOM</Button>
                                  <Button variant="ghost" size="sm" onClick={() => openMainItemDialog('edit', item)}><Edit className="h-4 w-4"/></Button>
                                  <Button variant="ghost" size="sm" onClick={() => handleDeleteMainItem(item.id)}><Trash2 className="h-4 w-4 text-destructive"/></Button>
                                </TableCell>
                              </TableRow>
                            ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                </Card>
            </TabsContent>
            <TabsContent value="sub-items">
                 <Card>
                    <CardHeader>
                         <div className="flex justify-between items-center">
                            <div>
                                <CardTitle>Sub-Items</CardTitle>
                                <CardDescription>Manage individual components and materials.</CardDescription>
                            </div>
                            <Button onClick={() => openSubItemDialog('add')}>
                                <Plus className="mr-2 h-4 w-4" /> Add Sub-Item
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Item Name</TableHead>
                            <TableHead>Unit</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                           {isLoading ? (
                            Array.from({ length: 3 }).map((_, i) => (
                              <TableRow key={i}><TableCell colSpan={3}><Skeleton className="h-8" /></TableCell></TableRow>
                            ))
                          ) : subItems.map(item => (
                              <TableRow key={item.id}>
                                <TableCell>{item.name}</TableCell>
                                <TableCell>{item.unit}</TableCell>
                                <TableCell className="text-right">
                                  <Button variant="ghost" size="sm" onClick={() => openSubItemDialog('edit', item)}><Edit className="h-4 w-4"/></Button>
                                  <Button variant="ghost" size="sm" onClick={() => handleDeleteSubItem(item.id)}><Trash2 className="h-4 w-4 text-destructive"/></Button>
                                </TableCell>
                              </TableRow>
                            ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                </Card>
            </TabsContent>
        </Tabs>
      </div>

       {/* Main Item Dialog */}
        <Dialog open={isMainItemDialogOpen} onOpenChange={setIsMainItemDialogOpen}>
            <DialogContent>
                <DialogHeader><DialogTitle>{dialogMode === 'add' ? 'Add' : 'Edit'} Main Item</DialogTitle></DialogHeader>
                <div className="py-4">
                    <Label htmlFor="main-item-name">Name</Label>
                    <Input id="main-item-name" value={mainItemFormData.name} onChange={e => setMainItemFormData({ name: e.target.value })} />
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                    <Button onClick={handleMainItemSubmit}>Save</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        {/* Sub Item Dialog */}
        <Dialog open={isSubItemDialogOpen} onOpenChange={setIsSubItemDialogOpen}>
            <DialogContent>
                <DialogHeader><DialogTitle>{dialogMode === 'add' ? 'Add' : 'Edit'} Sub-Item</DialogTitle></DialogHeader>
                <div className="py-4 space-y-4">
                    <div>
                        <Label htmlFor="sub-item-name">Name</Label>
                        <Input id="sub-item-name" value={subItemFormData.name} onChange={e => setSubItemFormData(p => ({...p, name: e.target.value}))} />
                    </div>
                     <div>
                        <Label htmlFor="sub-item-unit">Unit</Label>
                        <Input id="sub-item-unit" value={subItemFormData.unit} onChange={e => setSubItemFormData(p => ({...p, unit: e.target.value}))} />
                    </div>
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                    <Button onClick={handleSubItemSubmit}>Save</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        {/* BOM Dialog */}
        <BomDialog 
            isOpen={isBomDialogOpen}
            onOpenChange={setIsBomDialogOpen}
            mainItem={selectedMainItem}
            subItems={subItems}
            onBomUpdate={fetchData}
        />
    </>
  );
}
