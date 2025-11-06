
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, Plus, Trash2, Library } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, getDoc, Timestamp, runTransaction } from 'firebase/firestore';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type {
  BoqItem as BoqItemBase,
  MvacEntry,
  MvacItem,
  WorkflowStep,
  ActionLog,
  Project,
  SerialNumberConfig,
} from '@/lib/types';
import { BoqItemSelector } from '@/components/BoqItemSelector';
import { BoqMultiSelectDialog } from '@/components/BoqMultiSelectDialog';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import { getAssigneeForStep, calculateDeadline } from '@/lib/workflow-utils';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

/* ---------- local types ---------- */
type BoqItem = BoqItemBase & { projectId?: string; [k: string]: any };

const initialMvacDetails = {
  mvacNo: '',
  woNo: '',
  mvacDate: new Date().toISOString().split('T')[0],
};

const initialItem: MvacItem = {
  boqSlNo: '',
  description: '',
  unit: '',
  rate: 0,
  executedQty: 0,
  totalAmount: 0,
};

/* ---------- helpers ---------- */
const normalizeKey = (obj: Record<string, unknown>, target: string) => {
  const needle = target.toLowerCase().replace(/\s+|\./g, '');
  return Object.keys(obj).find((k) => k.toLowerCase().replace(/\s+|\./g, '') === needle);
};

const num0 = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = Number(v.replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const slugify = (text: string) =>
  (text || '')
    .toString()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

const compositeKey = (scope1: unknown, slNo: unknown) =>
  `${String(scope1 ?? '').trim().toLowerCase()}__${String(slNo ?? '').trim()}`;

/* ---------- field extractors ---------- */
const extractSlNo = (boqItem: BoqItem): string => {
  const slKey =
    normalizeKey(boqItem as any, 'BOQ SL No') ??
    normalizeKey(boqItem as any, 'BOQ SL NO') ??
    normalizeKey(boqItem as any, 'SL. No.') ??
    normalizeKey(boqItem as any, 'SL No') ??
    normalizeKey(boqItem as any, 'SL');
  return slKey ? String((boqItem as any)[slKey] ?? '') : '';
};

const extractScope1 = (boqItem: BoqItem): string => {
  const key = normalizeKey(boqItem as any, 'Scope 1');
  return key ? String((boqItem as any)[key] ?? '') : '';
};

const extractScope2 = (boqItem: BoqItem): string => {
  const key = normalizeKey(boqItem as any, 'Scope 2');
  return key ? String((boqItem as any)[key] ?? '') : '';
};

const extractErpSlNo = (boqItem: BoqItem): string => {
  const key =
    normalizeKey(boqItem as any, 'ERP SL NO') ??
    normalizeKey(boqItem as any, 'ERP Sl No') ??
    normalizeKey(boqItem as any, 'ERP SLNo');
  return key ? String((boqItem as any)[key] ?? '') : '';
};

const valueOf = (obj: any, keys: string[]): any =>
  keys.reduce<any>((acc, k) => (acc !== undefined ? acc : (obj ?? {})[k]), undefined);

const findBasicPriceKey = (boqItem: BoqItem): string | undefined => {
  const candidates = ['UNIT PRICE', 'Unit Rate', 'Rate', 'Basic Rate', 'UNIT RATE'];
  for (const k of candidates) {
    const key = normalizeKey(boqItem as any, k);
    if (key) return key;
  }
  return Object.keys(boqItem).find((k) => k.toLowerCase().includes('rate') && !k.toLowerCase().includes('total'));
};

export default function CreateMvacPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const router = useRouter();
  const { project: projectSlug } = useParams() as { project: string };

  const [details, setDetails] = useState(initialMvacDetails);
  const [items, setItems] = useState<MvacItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const [allBoqItems, setAllBoqItems] = useState<BoqItem[]>([]);
  const [isBoqLoading, setIsBoqLoading] = useState(true);
  const [isBoqMultiSelectOpen, setIsBoqMultiSelectOpen] = useState(false);

  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  
  const [previewMvacNo, setPreviewMvacNo] = useState('Generating...');

  const currentProject = useMemo(
    () => allProjects.find((p) => p.id === selectedProjectId) || null,
    [allProjects, selectedProjectId]
  );

  const boqItems = useMemo(() => {
    if (!currentProject) return [];
    return allBoqItems.filter((item) => (item as any).projectId === currentProject.id);
  }, [allBoqItems, currentProject]);
  
  const jmcEntries: any[] = []; // Placeholder

  useEffect(() => {
    const loadInitialData = async () => {
      setIsBoqLoading(true);
      try {
        const projectsSnapshot = await getDocs(collection(db, 'projects'));
        const projectsData = projectsSnapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Project));
        setAllProjects(projectsData);

        const initialProject = projectsData.find((p) => slugify(p.projectName) === projectSlug);
        if (initialProject) {
          setSelectedProjectId(initialProject.id);
          setDetails((prev) => ({ ...prev, woNo: (initialProject as any).woNo || '' }));
        }

        const boqSnaps = await Promise.all(
          projectsData.map((p) => getDocs(collection(db, 'projects', p.id, 'boqItems')))
        );
       
        const allBoq = boqSnaps.flatMap((snap, index) =>
          snap.docs.map(
            (d) =>
              ({
                ...(d.data() as object),
                id: d.id,
                projectId: projectsData[index].id,
              } as BoqItem)
          )
        );
        setAllBoqItems(allBoq);

      } catch (e) {
        console.error('Failed to load initial data:', e);
        toast({ title: 'Error', description: 'Could not load project data.', variant: 'destructive' });
      } finally {
        setIsBoqLoading(false);
      }
    };
    loadInitialData();
  }, [projectSlug, toast]);

  const totalCertifiedQtyMap = useMemo(() => {
    return {};
  }, [jmcEntries, selectedProjectId]);

  const handleDetailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setDetails((prev) => ({ ...prev, [name]: value }));
  };

  const handleBoqSelect = (index: number, boqItem: BoqItem | null) => {
    const newItems = [...items];
    if (boqItem) {
      const rateKey = findBasicPriceKey(boqItem);
      const rate = num0(rateKey ? (boqItem as any)[rateKey] : 0);
      const sl = extractSlNo(boqItem);

      newItems[index] = {
        ...initialItem,
        boqSlNo: sl,
        description: String(valueOf(boqItem, ['Description', 'description', 'Item Description']) ?? ''),
        unit: valueOf(boqItem, ['Unit', 'UNIT', 'UOM']) ?? '',
        rate,
      };
    } else {
      newItems[index] = initialItem;
    }
    setItems(newItems);
  };
  
  const handleItemChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const newItems = [...items];
    const it = { ...newItems[index], [name]: value };

    if (name === 'executedQty') {
      const q = Math.max(0, num0(value));
      it.executedQty = q;
    }

    const qty = num0(it.executedQty);
    const rate = num0(it.rate);
    it.totalAmount = qty * rate;

    newItems[index] = it;
    setItems(newItems);
  };
  
  const addItem = () => setItems((prev) => [...prev, initialItem]);
  const removeItem = (index: number) => {
    if (items.length > 1) {
      setItems((prev) => prev.filter((_, i) => i !== index));
    } else {
      setItems([initialItem]);
    }
  };

  const handleSave = async () => {
    router.push(`/subcontractors-management/${projectSlug}/mvac/log`);
  };

  return (
    <>
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href={`/billing-recon/${projectSlug}/mvac`}>
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-6 w-6" />
              </Button>
            </Link>
            <h1 className="text-xl font-bold">Create MVAC Entry</h1>
          </div>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Entry
          </Button>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>MVAC Details</CardTitle>
            <CardDescription>Provide the main details for this Material/Vehicle Administration Certificate.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="space-y-2">
                <Label htmlFor="project">Project</Label>
                <Input id="project" value={currentProject?.projectName || ''} readOnly className="bg-muted"/>
              </div>
              <div className="space-y-2">
                <Label htmlFor="mvacNo">MVAC No</Label>
                <Input id="mvacNo" name="mvacNo" value={previewMvacNo} readOnly className="font-semibold bg-muted/50" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="woNo">WO No</Label>
                <Input
                  id="woNo"
                  name="woNo"
                  value={details.woNo || '— not set —'}
                  readOnly
                  className="bg-muted/50 cursor-not-allowed"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mvacDate">MVAC Date</Label>
                <Input id="mvacDate" name="mvacDate" type="date" value={details.mvacDate} onChange={handleDetailChange} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>MVAC Items</CardTitle>
                <CardDescription>Add one or more items executed under this MVAC.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>BOQ Sl. No.</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead>Executed Qty</TableHead>
                    <TableHead>Total Amount</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item, index) => (
                    <TableRow key={index}>
                        <TableCell>
                            <BoqItemSelector
                            boqItems={boqItems}
                            selectedSlNo={item.boqSlNo}
                            onSelect={(boq) => handleBoqSelect(index, boq)}
                            isLoading={isBoqLoading}
                            />
                        </TableCell>
                        <TableCell>
                            <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger>
                                <p className="truncate max-w-xs">{item.description}</p>
                                </TooltipTrigger>
                                <TooltipContent>
                                <p className="max-w-md">{item.description}</p>
                                </TooltipContent>
                            </Tooltip>
                            </TooltipProvider>
                        </TableCell>
                        <TableCell>{item.unit}</TableCell>
                        <TableCell>{item.rate}</TableCell>
                        <TableCell>
                            <Input
                            name="executedQty"
                            type="number"
                            step="any"
                            min={0}
                            value={item.executedQty}
                            onChange={(e) => handleItemChange(index, e)}
                            />
                        </TableCell>
                        <TableCell>
                            {formatCurrency(item.totalAmount)}
                        </TableCell>
                        <TableCell>
                            <Button variant="ghost" size="icon" onClick={() => removeItem(index)} aria-label="Remove row">
                            <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                        </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <Button variant="outline" onClick={addItem} className="mt-4">
              <Plus className="mr-2 h-4 w-4" /> Add Item
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
