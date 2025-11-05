
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, Plus, Trash2, Library } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, doc, query, where, serverTimestamp, runTransaction, getDoc } from 'firebase/firestore';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import type { MvacItem, BoqItem, Project, SerialNumberConfig } from '@/lib/types';
import { BoqItemSelector } from '@/components/BoqItemSelector';
import { BoqMultiSelectDialog } from '@/components/BoqMultiSelectDialog';
import { format } from 'date-fns';

const initialMvacDetails = {
    mvacNo: '',
    mvacDate: new Date().toISOString().split('T')[0],
    woNo: '',
};

const initialItemState = {
    id: '',
    boqItemId: '',
    'BOQ Sl. No.': '',
    'Description': '',
    'Unit': '',
    'Total BOQ Qty': '0',
    'Rate': '0',
    'Amount': '0',
    'Start Date': '',
    'End Date': '',
    'Status': 'Pending'
};

const slugify = (text: string) => {
  if (!text) return '';
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

export default function CreateMvacPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const router = useRouter();
  const { project: projectSlug } = useParams() as { project: string };

  const [details, setDetails] = useState(initialMvacDetails);
  const [items, setItems] = useState<MvacItem[]>([ { ...initialItemState, id: crypto.randomUUID() } ]);
  const [isSaving, setIsSaving] = useState(false);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [isBoqMultiSelectOpen, setIsBoqMultiSelectOpen] = useState(false);
  const [previewMvacNo, setPreviewMvacNo] = useState('Generating...');

  useEffect(() => {
    const fetchData = async () => {
        if(!projectSlug) return;
        
        const projectsQuery = query(collection(db, 'projects'));
        const projectsSnapshot = await getDocs(projectsQuery);
        const projectData = projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)).find(p => slugify(p.projectName) === projectSlug);

        if(!projectData) {
            toast({ title: 'Project not found', variant: 'destructive'});
            return;
        }
        setCurrentProject(projectData);

        const boqSnap = await getDocs(collection(db, 'projects', projectData.id, 'boqItems'));
        setBoqItems(boqSnap.docs.map(d => ({id: d.id, ...d.data()} as BoqItem)));
    };
    fetchData();
  }, [projectSlug, toast]);

   useEffect(() => {
    const generatePreviewId = async () => {
        try {
            const configRef = doc(db, 'serialNumberConfigs', 'mvac');
            const configDoc = await getDoc(configRef);
            if (configDoc.exists()) {
                const configData = configDoc.data() as SerialNumberConfig;
                const newIndex = configData.startingIndex;
                const datePart = configData.format ? format(new Date(), configData.format.replace(/y/g, 'y').replace(/m/g, 'M').replace(/d/g, 'd')) : '';
                const formattedIndex = String(newIndex).padStart(4, '0');
                const mvacNo = `${configData.prefix || ''}${datePart}${formattedIndex}${configData.suffix || ''}`;
                setPreviewMvacNo(mvacNo);
            } else {
                setPreviewMvacNo('Config not found');
            }
        } catch (error) {
            setPreviewMvacNo('Error generating ID');
        }
    };
    generatePreviewId();
  }, []);

  const handleDetailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setDetails(prev => ({ ...prev, [name]: value }));
  };

  const handleItemChange = (index: number, field: keyof Omit<MvacItem, 'id'|'boqItemId'|'projectSlug'>, value: string) => {
    const newItems = [...items];
    const item = { ...newItems[index], [field]: value };
    
    // Recalculate amount
    const qty = parseFloat(item['Total BOQ Qty']) || 0;
    const rate = parseFloat(item['Rate']) || 0;
    item['Amount'] = (qty * rate).toFixed(2);
    
    newItems[index] = item;
    setItems(newItems);
  };
  
  const addItem = () => {
    setItems([...items, { ...initialItemState, id: crypto.randomUUID() }]);
  };

  const handleBoqItemSelect = (index: number, boqItem: BoqItem | null) => {
    if (!boqItem) return;
    const rateKey = Object.keys(boqItem).find(key => key.toLowerCase().includes('rate')) || 'rate';
    const newItems = [...items];
    newItems[index] = {
      ...newItems[index],
      boqItemId: boqItem.id,
      'BOQ Sl. No.': String(boqItem['BOQ SL No'] || ''),
      'Description': String(boqItem.Description || boqItem.DESCRIPTION || ''),
      'Unit': String(boqItem.UNIT || boqItem.Unit || ''),
      'Total BOQ Qty': String(boqItem.QTY || 0),
      'Rate': String((boqItem as any)[rateKey] || 0),
    };
    // Recalculate amount after setting new values
    const qty = parseFloat(newItems[index]['Total BOQ Qty']);
    const rate = parseFloat(newItems[index]['Rate']);
    newItems[index]['Amount'] = (qty * rate).toFixed(2);
    setItems(newItems);
  };
  
  const handleMultiBoqSelect = (selectedItems: BoqItem[]) => {
      const newMvacItems: MvacItem[] = selectedItems.map(boqItem => {
          const rateKey = Object.keys(boqItem).find(key => key.toLowerCase().includes('rate')) || 'rate';
          const qty = parseFloat(String(boqItem.QTY || 0));
          const rate = parseFloat(String((boqItem as any)[rateKey] || 0));
          return {
              id: crypto.randomUUID(),
              boqItemId: boqItem.id,
              'BOQ Sl. No.': String(boqItem['BOQ SL No'] || ''),
              'Description': String(boqItem.Description || boqItem.DESCRIPTION || ''),
              'Unit': String(boqItem.UNIT || boqItem.Unit || ''),
              'Total BOQ Qty': String(qty),
              'Rate': String(rate),
              'Amount': (qty * rate).toFixed(2),
              'Start Date': '',
              'End Date': '',
              'Status': 'Pending',
          };
      });

      const isFirstItemEmpty = items.length === 1 && !items[0].boqItemId;
      if(isFirstItemEmpty) {
          setItems(newMvacItems);
      } else {
          setItems(prev => [...prev, ...newMvacItems]);
      }
  }

  const removeItem = (id: string) => {
    setItems(items.filter(item => item.id !== id));
  };
  
  const handleSave = async () => {
    if (!user || !currentProject || items.some(item => !item.boqItemId)) {
      toast({ title: 'Missing Fields', description: 'Please select a BOQ item for all rows.', variant: 'destructive' });
      return;
    }
    setIsSaving(true);
    
    try {
        const configDocRef = doc(db, 'serialNumberConfigs', 'mvac');
        
        const mvacNo = await runTransaction(db, async (transaction) => {
            const configDoc = await transaction.get(configDocRef);
            if (!configDoc.exists()) throw new Error("MVAC serial number configuration not found!");
            const config = configDoc.data() as SerialNumberConfig;
            const newIndex = config.startingIndex;
            const datePart = config.format ? format(new Date(), config.format.replace(/y/g, 'y').replace(/m/g, 'M').replace(/d/g, 'd')) : '';
            const newMvacNo = `${config.prefix || ''}${datePart}${String(newIndex).padStart(4, '0')}${config.suffix || ''}`;
            transaction.update(configDocRef, { startingIndex: newIndex + 1 });
            return newMvacNo;
        });

        const batch = writeBatch(db);
        
        items.forEach(item => {
            const { id, ...itemToSave } = item;
            const mvacDocRef = doc(collection(db, 'mvacItems'));
            const docData = {
                ...itemToSave,
                projectSlug,
                mvacNo,
                mvacDate: details.mvacDate,
                'WO': details.woNo,
                'Project': currentProject.projectName,
            };
            batch.set(mvacDocRef, docData);
        });

        await batch.commit();
        toast({ title: 'Success', description: 'MVAC entries saved successfully.' });
        router.push(`/billing-recon/${projectSlug}/mvac/log`);
    } catch (error: any) {
        console.error("Error saving MVAC entries:", error);
        toast({ title: 'Save Failed', description: error.message || 'Could not save MVAC entries.', variant: 'destructive' });
    } finally {
        setIsSaving(false);
    }
  };
  
  const formatCurrency = (amount: string | number) => {
    const num = parseFloat(String(amount));
    if(isNaN(num)) return amount;
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(num);
  }

  return (
    <>
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href={`/billing-recon/${projectSlug}/mvac`}>
              <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
            </Link>
            <h1 className="text-2xl font-bold">Create MVAC Entry</h1>
          </div>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Entries
          </Button>
        </div>
        
        <Card className="mb-6">
          <CardHeader><CardTitle>MVAC Details</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-6">
             <div className="space-y-2">
                <Label htmlFor="mvacNo">MVAC No</Label>
                <Input id="mvacNo" value={previewMvacNo} readOnly className="bg-muted" />
            </div>
            <div className="space-y-2">
                <Label htmlFor="mvacDate">MVAC Date</Label>
                <Input id="mvacDate" name="mvacDate" type="date" value={details.mvacDate} onChange={handleDetailChange} />
            </div>
            <div className="space-y-2">
                <Label htmlFor="woNo">Work Order No</Label>
                <Input id="woNo" name="woNo" value={details.woNo} onChange={handleDetailChange} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <div>
                <CardTitle>Items</CardTitle>
                <CardDescription>Add items from the BOQ to include in this MVAC.</CardDescription>
              </div>
              <Button variant="outline" type="button" onClick={() => setIsBoqMultiSelectOpen(true)}>
                <Library className="mr-2 h-4 w-4" /> Add Multiple Items
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>BOQ Item</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Start Date</TableHead>
                    <TableHead>End Date</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item, index) => (
                    <TableRow key={item.id}>
                      <TableCell className="min-w-[300px]">
                        <BoqItemSelector
                            boqItems={boqItems}
                            selectedSlNo={item['BOQ Sl. No.'] || ''}
                            onSelect={(selected) => handleBoqItemSelect(index, selected)}
                            isLoading={false}
                        />
                      </TableCell>
                       <TableCell>
                           <Input value={item['Total BOQ Qty']} onChange={(e) => handleItemChange(index, 'Total BOQ Qty', e.target.value)} type="number" />
                       </TableCell>
                       <TableCell>
                           <Input value={item['Rate']} onChange={(e) => handleItemChange(index, 'Rate', e.target.value)} type="number" />
                       </TableCell>
                       <TableCell>
                           <Input value={item['Amount']} readOnly className="bg-muted" />
                       </TableCell>
                       <TableCell>
                           <Input value={item['Start Date']} onChange={(e) => handleItemChange(index, 'Start Date', e.target.value)} type="date" />
                       </TableCell>
                       <TableCell>
                           <Input value={item['End Date']} onChange={(e) => handleItemChange(index, 'End Date', e.target.value)} type="date" />
                       </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => removeItem(item.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Button variant="outline" size="sm" className="mt-4" onClick={addItem}>
              <Plus className="mr-2 h-4 w-4" /> Add Item
            </Button>
          </CardContent>
        </Card>
      </div>
      <BoqMultiSelectDialog
        isOpen={isBoqMultiSelectOpen}
        onOpenChange={setIsBoqMultiSelectOpen}
        boqItems={boqItems}
        onConfirm={handleMultiBoqSelect}
        alreadyAddedItems={[]}
      />
    </>
  );
}

