'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import type { MainItem, SubItem, BomItem } from '@/lib/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { useParams } from 'next/navigation';

export default function BomPage() {
  const { toast } = useToast();
  const params = useParams();
  const projectSlug = params.project as string;
  const [mainItems, setMainItems] = useState<MainItem[]>([]);
  const [subItems, setSubItems] = useState<SubItem[]>([]);
  const [selectedMainItemId, setSelectedMainItemId] = useState<string | null>(null);
  const [bom, setBom] = useState<BomItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const [mainItemsSnap, subItemsSnap] = await Promise.all([
          getDocs(collection(db, 'main_items')),
          getDocs(collection(db, 'sub_items')),
        ]);
        const mainItemsData = mainItemsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as MainItem));
        setMainItems(mainItemsData);
        setSubItems(subItemsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as SubItem)));
        if (mainItemsData.length > 0) {
          setSelectedMainItemId(mainItemsData[0].id);
          setBom(mainItemsData[0].bom || []);
        }
      } catch (error) {
        toast({ title: 'Error', description: 'Failed to fetch items.', variant: 'destructive' });
      }
      setIsLoading(false);
    };
    fetchData();
  }, [toast]);
  
  const handleMainItemSelect = (itemId: string) => {
      setSelectedMainItemId(itemId);
      const selectedItem = mainItems.find(item => item.id === itemId);
      setBom(selectedItem?.bom || []);
  };
  
  const handleAddBomItem = () => {
    setBom([...bom, { subItemId: '', quantity: 1 }]);
  };

  const handleBomItemChange = (index: number, field: 'subItemId' | 'quantity', value: string) => {
    const newBom = [...bom];
    if (field === 'quantity') {
      newBom[index][field] = parseFloat(value) || 0;
    } else {
      newBom[index][field] = value;
    }
    setBom(newBom);
  };
  
  const handleRemoveBomItem = (index: number) => {
      setBom(bom.filter((_, i) => i !== index));
  }
  
  const handleSaveBom = async () => {
    if (!selectedMainItemId) return;
    setIsSaving(true);
    try {
      const mainItemRef = doc(db, 'main_items', selectedMainItemId);
      await updateDoc(mainItemRef, { bom: bom });
      toast({ title: 'Success', description: 'Bill of Materials updated.' });
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to update BOM.', variant: 'destructive' });
    }
    setIsSaving(false);
  };
  
  const selectedMainItem = mainItems.find(item => item.id === selectedMainItemId);

  return (
    <div className="w-full max-w-4xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href={`/store-stock-management/${projectSlug}/items`}>
            <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
          </Link>
          <h1 className="text-xl font-bold">Bill of Materials (BOM)</h1>
        </div>
        <Button onClick={handleSaveBom} disabled={isSaving || !selectedMainItemId}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4"/>}
            Save BOM
        </Button>
      </div>

      <Card>
        <CardHeader>
            <CardTitle>Select Main Item</CardTitle>
            <CardDescription>Choose a main item to view or edit its Bill of Materials.</CardDescription>
        </CardHeader>
        <CardContent>
            {isLoading ? <Skeleton className="h-10 w-full max-w-sm"/> : (
                <Select value={selectedMainItemId || ''} onValueChange={handleMainItemSelect}>
                    <SelectTrigger className="w-full max-w-sm">
                        <SelectValue placeholder="Select a Main Item" />
                    </SelectTrigger>
                    <SelectContent>
                        {mainItems.map(item => (
                            <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            )}
        </CardContent>
      </Card>
      
      {selectedMainItemId && (
        <Card className="mt-6">
            <CardHeader>
                <CardTitle>Components for {selectedMainItem?.name}</CardTitle>
                <CardDescription>Define the sub-items and quantities required to make one main item.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="border rounded-md">
                     <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Sub-Item</TableHead>
                                <TableHead>Unit</TableHead>
                                <TableHead>Quantity</TableHead>
                                <TableHead className="w-[50px]"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {bom.map((item, index) => {
                                const selectedSubItem = subItems.find(si => si.id === item.subItemId);
                                return (
                                     <TableRow key={index}>
                                        <TableCell>
                                            <Select value={item.subItemId} onValueChange={value => handleBomItemChange(index, 'subItemId', value)}>
                                                <SelectTrigger><SelectValue placeholder="Select Sub-Item"/></SelectTrigger>
                                                <SelectContent>
                                                    {subItems.map(si => (
                                                        <SelectItem key={si.id} value={si.id}>{si.name}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </TableCell>
                                        <TableCell>{selectedSubItem?.unit || 'N/A'}</TableCell>
                                        <TableCell>
                                            <Input 
                                                type="number" 
                                                value={item.quantity} 
                                                onChange={e => handleBomItemChange(index, 'quantity', e.target.value)}
                                                className="w-24"
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <Button variant="ghost" size="icon" onClick={() => handleRemoveBomItem(index)}>
                                                <Trash2 className="h-4 w-4 text-destructive" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                </div>
                 <Button variant="outline" onClick={handleAddBomItem} className="mt-4">
                    <Plus className="mr-2 h-4 w-4" /> Add Component
                </Button>
            </CardContent>
        </Card>
      )}

    </div>
  );
}
