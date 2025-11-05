
'use client';

import { useState, useEffect, useMemo } from 'react';
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
import type { MvacItem, BoqItem, Project, SerialNumberConfig, JmcEntry } from '@/lib/types';
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
    erpSlNo: '',
    boqSlNo: '',
    description: '',
    unit: '',
    boqQty: 0,
    rate: 0,
    scope1: '',
    totalCertifiedQty: 0,
    executedQty: 0,
    totalAmount: 0,
};

type MvacItemForm = typeof initialItemState;

const slugify = (text: string) => {
  if (!text) return '';
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

const extractErpSlNo = (boqItem: BoqItem): string => {
  const key = Object.keys(boqItem).find(k => k.toLowerCase().replace(/\s+/g, '') === 'erpslno');
  return key ? String((boqItem as any)[key] ?? '') : '';
};

const extractBoqSlNo = (boqItem: BoqItem): string => {
    return String((boqItem as any)['BOQ SL No'] || (boqItem as any)['SL. No.'] || '');
}

const extractDescription = (boqItem: BoqItem): string => {
    return String((boqItem as any)['Description'] || '');
}

const extractUnit = (boqItem: BoqItem): string => {
    return String((boqItem as any)['UNIT'] || (boqItem as any)['Unit'] || '');
}

const extractBoqQty = (boqItem: BoqItem): number => {
    return Number((boqItem as any)['QTY'] || (boqItem as any)['Total Qty'] || 0);
}

const extractRate = (boqItem: BoqItem): number => {
    const rateKey = Object.keys(boqItem).find(k => k.toLowerCase().includes('rate')) || 'rate';
    return Number((boqItem as any)[rateKey] || 0);
}

const extractScope1 = (boqItem: BoqItem): string => {
    return String((boqItem as any)['Scope 1'] || '');
}

export default function CreateMvacPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const router = useRouter();
  const { project: projectSlug } = useParams() as { project: string };

  const [details, setDetails] = useState(initialMvacDetails);
  const [items, setItems] = useState<MvacItemForm[]>([ { ...initialItemState, id: crypto.randomUUID() } ]);
  const [isSaving, setIsSaving] = useState(false);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [jmcEntries, setJmcEntries] = useState<JmcEntry[]>([]);
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

        const jmcSnap = await getDocs(collection(db, 'projects', projectData.id, 'jmcEntries'));
        setJmcEntries(jmcSnap.docs.map(d => ({id: d.id, ...d.data()} as JmcEntry)));
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

  const totalCertifiedQtyMap = useMemo(() => {
      const map: Record<string, number> = {};
      jmcEntries.forEach(entry => {
          entry.items.forEach(item => {
              const key = item.boqSlNo;
              map[key] = (map[key] || 0) + (item.certifiedQty || 0);
          });
      });
      return map;
  }, [jmcEntries]);

  const handleDetailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setDetails(prev => ({ ...prev, [name]: value }));
  };

  const handleItemChange = (index: number, field: keyof MvacItemForm, value: string) => {
    const newItems = [...items];
    const item = { ...newItems[index] };
    (item as any)[field] = value;
    
    if (field === 'executedQty') {
        const qty = parseFloat(value);
        const rate = item.rate || 0;
        if (!isNaN(qty)) {
            item.totalAmount = qty * rate;
        }
    }
    
    newItems[index] = item;
    setItems(newItems);
  };
  
  const addItem = () => {
    setItems([...items, { ...initialItemState, id: crypto.randomUUID() }]);
  };

  const handleBoqItemSelect = (index: number, boqItem: BoqItem | null) => {
    if (!boqItem) return;
    const boqSlNo = extractBoqSlNo(boqItem);
    const newItems = [...items];
    newItems[index] = {
      ...newItems[index],
      boqItemId: boqItem.id,
      erpSlNo: extractErpSlNo(boqItem),
      boqSlNo: boqSlNo,
      description: extractDescription(boqItem),
      unit: extractUnit(boqItem),
      boqQty: extractBoqQty(boqItem),
      rate: extractRate(boqItem),
      scope1: extractScope1(boqItem),
      totalCertifiedQty: totalCertifiedQtyMap[boqSlNo] || 0,
    };
    setItems(newItems);
  };
  
  const handleMultiBoqSelect = (selectedItems: BoqItem[]) => {
      const newMvacItems: MvacItemForm[] = selectedItems.map(boqItem => {
          const boqSlNo = extractBoqSlNo(boqItem);
          return {
              id: crypto.randomUUID(),
              boqItemId: boqItem.id,
              erpSlNo: extractErpSlNo(boqItem),
              boqSlNo: boqSlNo,
              description: extractDescription(boqItem),
              unit: extractUnit(boqItem),
              boqQty: extractBoqQty(boqItem),
              rate: extractRate(boqItem),
              scope1: extractScope1(boqItem),
              totalCertifiedQty: totalCertifiedQtyMap[boqSlNo] || 0,
              executedQty: 0,
              totalAmount: 0,
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
    if (items.length > 1) {
      setItems(items.filter(item => item.id !== id));
    } else {
      setItems([{ ...initialItemState, id: crypto.randomUUID() }]);
    }
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
        
        const mvacDocRef = doc(collection(db, 'mvacEntries'));
        const mvacData = {
          ...details,
          mvacNo,
          projectId: currentProject.id,
          projectSlug,
          createdAt: serverTimestamp(),
          items: items.map(({id, ...rest}) => rest) // remove client-side id
        };
        batch.set(mvacDocRef, mvacData);

        await batch.commit();
        toast({ title: 'Success', description: 'MVAC entry saved successfully.' });
        router.push(`/billing-recon/${projectSlug}/mvac/log`);
    } catch (error: any) {
        console.error("Error saving MVAC entries:", error);
        toast({ title: 'Save Failed', description: error.message || 'Could not save MVAC entries.', variant: 'destructive' });
    } finally {
        setIsSaving(false);
    }
  };
  
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
            Save Entry
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
                <CardTitle>MVAC Items</CardTitle>
                <CardDescription>Add one or more items executed under this MVAC.</CardDescription>
              </div>
              <Button variant="outline" type="button" onClick={() => setIsBoqMultiSelectOpen(true)}>
                <Library className="mr-2 h-4 w-4" /> Add Items from BOQ
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ERP Sl. No.</TableHead>
                    <TableHead>BOQ Sl. No.</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>BOQ Qty</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead>Scope 1</TableHead>
                    <TableHead>Total Certified Qty</TableHead>
                    <TableHead>Executed Qty</TableHead>
                    <TableHead>Total Amount</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item, index) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.erpSlNo || '-'}</TableCell>
                      <TableCell>
                          <BoqItemSelector
                           boqItems={boqItems}
                           selectedSlNo={item.boqSlNo}
                           onSelect={(boq) => handleBoqItemSelect(index, boq)}
                           isLoading={false}
                          />
                      </TableCell>
                      <TableCell>{item.description}</TableCell>
                      <TableCell>{item.unit}</TableCell>
                      <TableCell>{item.boqQty}</TableCell>
                      <TableCell>{item.rate}</TableCell>
                      <TableCell>{item.scope1}</TableCell>
                      <TableCell>{item.totalCertifiedQty}</TableCell>
                      <TableCell>
                           <Input type="number" value={item.executedQty} onChange={(e) => handleItemChange(index, 'executedQty', e.target.value)} />
                      </TableCell>
                       <TableCell>
                           <Input value={item.totalAmount.toFixed(2)} readOnly className="bg-muted" />
                      </TableCell>
                      <TableCell>
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

    