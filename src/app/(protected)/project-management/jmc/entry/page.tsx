

'use client';

import { useState, useEffect, useMemo } from 'react';
import { Save, Loader2, Plus, Trash2, Library, FilePlus } from 'lucide-react';
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
  JmcEntry as JmcEntryType,
  WorkflowStep,
  ActionLog,
  Project,
  SerialNumberConfig,
} from '@/lib/types';
import { BoqItemSelector } from '@/components/billing-recon/BoqItemSelector';
import { BoqMultiSelectDialog } from '@/components/billing-recon/BoqMultiSelectDialog';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { logUserActivity } from '@/lib/activity-logger';
import { getAssigneeForStep, calculateDeadline } from '@/lib/workflow-utils';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { jmcSerialConfigId, jmcSlugify } from '@/lib/jmc-module';
import { useProjectManagementJmcContext } from '@/components/jmc/use-jmc-host-context';
import {
  JMC_GRADIENT,
  JmcAccessDenied,
  JmcLoadingState,
  JmcPageHeader,
  JmcPageShell,
  JmcProjectNotFound,
} from '@/components/jmc/jmc-page-shell';
import { JmcNav } from '@/components/jmc/jmc-nav';

/* ---------- local types ---------- */
type BoqItem = BoqItemBase & { projectId?: string; [k: string]: any };

const initialJmcDetails = {
  jmcNo: '',
  woNo: '',
  jmcDate: new Date().toISOString().split('T')[0],
};

const initialItem = {
  erpSlNo: '',         // ✅ store ERP SL NO on each JMC item
  boqSlNo: '',
  description: '',
  unit: '',
  rate: 0,
  executedQty: 0,
  totalAmount: 0,
  boqQty: 0,
  totalCertifiedQty: 0,
  scope1: '',
  scope2: '',
};

type JmcItem = typeof initialItem;

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

const compositeKey =(scope1: unknown, scope2: unknown, slNo: unknown) =>
  `${String(scope1 ?? '').trim().toLowerCase()}__${String(scope2 ?? '').trim().toLowerCase()}__${String(slNo ?? '').trim()}`;

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

/* ---------- ERP-first sort ---------- */
const sortItemsByErp = (arr: JmcItem[]): JmcItem[] => {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...arr].sort((a, b) => {
    const ea = String(a.erpSlNo ?? '');
    const eb = String(b.erpSlNo ?? '');
    const cmp = collator.compare(ea, eb);
    if (cmp !== 0) return cmp;
    // stable tiebreaker: BOQ Sl. No.
    return collator.compare(String(a.boqSlNo ?? ''), String(b.boqSlNo ?? ''));
  });
};

export default function JmcEntryPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const mappingId = searchParams?.get('project') ?? '';
  const { context, isResolving, notFound, projectName } = useProjectManagementJmcContext(mappingId);
  const { can, isLoading: authIsLoading } = useAuthorization();

  const canCreate = useMemo(() => {
    if (authIsLoading) return false;
    try {
      return can('Create JMC Entry', context.permissionResource);
    } catch {
      return false;
    }
  }, [authIsLoading, can, context.permissionResource]);

  const [details, setDetails] = useState(initialJmcDetails);
  const [items, setItems] = useState<JmcItem[]>([initialItem]);
  const [isSaving, setIsSaving] = useState(false);

  const [allBoqItems, setAllBoqItems] = useState<BoqItem[]>([]);
  const [allJmcEntries, setAllJmcEntries] = useState<(JmcEntryType & { projectId: string })[]>([]);
  const [isBoqLoading, setIsBoqLoading] = useState(true);
  const [isBoqMultiSelectOpen, setIsBoqMultiSelectOpen] = useState(false);

  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

  const currentProject = useMemo(
    () => allProjects.find((p) => p.id === selectedProjectId) || null,
    [allProjects, selectedProjectId]
  );

  /* `jmcEntries` documents carry a `projectSlug` and Billing Recon writes the same register, so the
     field keeps Billing Recon's slug rule — derived from the selected project's name rather than
     from a route segment this host does not have. */
  const projectSlug = useMemo(
    () => jmcSlugify(currentProject?.projectName ?? ''),
    [currentProject]
  );

  const boqItems = useMemo(() => {
    if (!currentProject) return [];
    return allBoqItems.filter((item) => item.projectId === currentProject.id);
  }, [allBoqItems, currentProject]);

  useEffect(() => {
    // Hold until the `?project=` mapping has been read, so the whole-collection load below runs
    // once against a known project — the same single pass the slug-routed original made.
    if (isResolving) return;

    const loadInitialData = async () => {
      setIsBoqLoading(true);
      try {
        const projectsSnapshot = await getDocs(collection(db, 'projects'));
        const projectsData = projectsSnapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Project));
        setAllProjects(projectsData);

        const initialProject = context.resolveProject(projectsData) as Project | null;
        if (initialProject) {
          setSelectedProjectId(initialProject.id);
          setDetails((prev) => ({ ...prev, woNo: (initialProject as any).woNo || '' }));
        }

        const boqSnaps = await Promise.all(
          projectsData.map((p) => getDocs(collection(db, 'projects', p.id, 'boqItems')))
        );
        const jmcSnaps = await Promise.all(
          projectsData.map((p) => getDocs(collection(db, 'projects', p.id, 'jmcEntries')))
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

        const allJmc = jmcSnaps.flatMap((snap, index) =>
          snap.docs.map((d) => ({
            ...(d.data() as Omit<JmcEntryType, 'id'>),
            id: d.id,
            projectId: projectsData[index].id,
          }))
        );
        setAllJmcEntries(allJmc);
      } catch (e) {
        console.error('Failed to load initial data:', e);
        toast({ title: 'Error', description: 'Could not load project data.', variant: 'destructive' });
      } finally {
        setIsBoqLoading(false);
      }
    };
    loadInitialData();
  }, [context, isResolving, toast]);

  /* ---------- auto-generate JMC No when scope1/scope2 ready ---------- */
  useEffect(() => {
    const generateJmcNo = async () => {
      const firstItem = items[0];
      if (!currentProject || !firstItem?.scope1 || !firstItem?.scope2) {
        setDetails((prev) => ({ ...prev, jmcNo: '' }));
        return;
      }

      const configSlug = jmcSerialConfigId(currentProject.id, firstItem.scope1, firstItem.scope2);
      try {
        const configRef = doc(db, 'billingReconSerialConfigs', configSlug);
        const configDoc = await getDoc(configRef);
        if (configDoc.exists()) {
          const configData = configDoc.data() as SerialNumberConfig;
          const index = configData.startingIndex;
          const formatted = String(index).padStart(4, '0');
          const newJmcNo = `${configData.prefix || ''}${configData.format || ''}${formatted}${configData.suffix || ''}`;
          setDetails((prev) => ({ ...prev, jmcNo: newJmcNo }));
        } else {
          setDetails((prev) => ({ ...prev, jmcNo: 'Config not found' }));
        }
      } catch {
        setDetails((prev) => ({ ...prev, jmcNo: 'Error generating ID' }));
      }
    };
    generateJmcNo();
  }, [items[0]?.scope1, items[0]?.scope2, currentProject?.id]);

  const handleProjectChange = (projectId: string) => {
    const project = allProjects.find((p) => p.id === projectId);
    if (project) {
      setSelectedProjectId(projectId);
      setDetails((prev) => ({ ...prev, woNo: (project as any).woNo || '' }));
      setItems([initialItem]); // reset on project change
    }
  };

  /* ---------- certified qty map (robust to key casing) ---------- */
  const totalCertifiedQtyMap = useMemo(() => {
    const map: Record<string, number> = {};
    const relevant = allJmcEntries.filter((e) => e.projectId === selectedProjectId);
    relevant.forEach((entry) => {
      const arr: any[] = Array.isArray((entry as any).items) ? (entry as any).items : [];
      arr.forEach((it) => {
        const s1 = it?.scope1 ?? it?.['Scope 1'] ?? '';
        const s2 = it?.scope2 ?? it?.['Scope 2'] ?? '';
        const sl = it?.boqSlNo ?? it?.['BOQ SL No'] ?? it?.['BOQ SL NO'] ?? it?.['SL No'] ?? it?.['SL'] ?? '';
        if (!String(sl || '').trim()) return;
        const key = compositeKey(s1, s2, sl);
        map[key] = (map[key] || 0) + num0(it?.certifiedQty ?? it?.['Certified Qty']);
      });
    });
    return map;
  }, [allJmcEntries, selectedProjectId]);

  const handleDetailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setDetails((prev) => ({ ...prev, [name]: value }));
  };

  /* ---------- selections & edits ---------- */
  const handleBoqSelect = (index: number, boqItem: BoqItem | null) => {
    const newItems = [...items];
    const it = { ...newItems[index] };

    if (boqItem) {
      const rateKey = findBasicPriceKey(boqItem);
      const rate = num0(rateKey ? (boqItem as any)[rateKey] : 0);
      const sl = extractSlNo(boqItem);
      const s1 = extractScope1(boqItem);
      const s2 = extractScope2(boqItem);
      const erp = extractErpSlNo(boqItem);

      it.erpSlNo = erp;
      it.boqSlNo = sl;
      it.scope1 = s1;
      it.scope2 = s2;
      it.description = String(valueOf(boqItem, ['Description', 'description', 'Item Description']) ?? '');
      it.unit = valueOf(boqItem, ['Unit', 'UNIT', 'UOM']) ?? '';
      it.rate = rate;
      it.boqQty = num0(valueOf(boqItem, ['QTY', 'Qty', 'Quantity']));

      const key = compositeKey(s1, s2, sl);
      it.totalCertifiedQty = totalCertifiedQtyMap[key] || 0;

      const qty = num0(it.executedQty);
      it.totalAmount = qty * it.rate;
    } else {
      Object.assign(it, initialItem);
    }

    newItems[index] = it;
    setItems(sortItemsByErp(newItems));
  };

  const handleMultiBoqSelect = (selected: BoqItem[]) => {
    const newJmcItems: JmcItem[] = selected
      .map((boqItem) => {
        const rateKey = findBasicPriceKey(boqItem);
        const rate = num0(rateKey ? (boqItem as any)[rateKey] : 0);
        const sl = extractSlNo(boqItem);
        const s1 = extractScope1(boqItem);
        const s2 = extractScope2(boqItem);
        const erp = extractErpSlNo(boqItem);
        if (!String(sl).trim()) return null;
        const key = compositeKey(s1, s2, sl);

        return {
          ...initialItem,
          erpSlNo: erp,
          boqSlNo: sl,
          scope1: s1,
          scope2: s2,
          description: String(valueOf(boqItem, ['Description', 'description', 'Item Description']) ?? ''),
          unit: valueOf(boqItem, ['Unit', 'UNIT', 'UOM']) ?? '',
          rate,
          boqQty: num0(valueOf(boqItem, ['QTY', 'Qty', 'Quantity'])),
          totalCertifiedQty: totalCertifiedQtyMap[key] || 0,
        };
      })
      .filter(Boolean) as JmcItem[];

    const existing = items.length === 1 && items[0].boqSlNo === '' && items[0].erpSlNo === '' ? [] : items;

    const merged = [...existing, ...newJmcItems];
    setItems(sortItemsByErp(merged));
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
    setItems(sortItemsByErp(newItems));
  };

  const addItem = () => setItems((prev) => sortItemsByErp([...prev, { ...initialItem }]));
  const removeItem = (index: number) => {
    if (items.length > 1) {
      const next = items.filter((_, i) => i !== index);
      setItems(sortItemsByErp(next));
    } else {
      setItems([{ ...initialItem }]);
    }
  };

  /* ---------- save ---------- */
  const handleSave = async () => {
    if (!user) {
      toast({ title: 'Authentication Error', description: 'You must be logged in.', variant: 'destructive' });
      return;
    }
    setIsSaving(true);

    const hasBad =
      !currentProject ||
      !details.jmcNo ||
      /not found|error/i.test(details.jmcNo) ||
      !details.woNo ||
      items.some((it) => !it.boqSlNo);

    if (hasBad) {
      toast({
        title: 'Missing Required Fields',
        description:
          'Please select a project, ensure WO No is set, and add at least one valid item with a generated JMC No.',
        variant: 'destructive',
      });
      setIsSaving(false);
      return;
    }

    try {
      const firstItem = items[0];
      const configSlug = jmcSerialConfigId(currentProject!.id, firstItem.scope1, firstItem.scope2);
      const configRef = doc(db, 'billingReconSerialConfigs', configSlug);

      await runTransaction(db, async (transaction) => {
        const configDoc = await transaction.get(configRef);
        if (!configDoc.exists()) throw new Error('Serial number configuration could not be found for this scope.');
        const configData = configDoc.data() as SerialNumberConfig;

        const currentIndex = configData.startingIndex;
        const formattedIndex = String(currentIndex).padStart(4, '0');
        const expectedJmcNo = `${configData.prefix || ''}${configData.format || ''}${formattedIndex}${
          configData.suffix || ''
        }`;

        if (details.jmcNo !== expectedJmcNo) {
          throw new Error(`JMC number mismatch. Expected ${expectedJmcNo}, but found ${details.jmcNo}. Please refresh.`);
        }

        const workflowRef = doc(db, 'workflows', 'jmc-workflow');
        const workflowSnap = await getDoc(workflowRef);
        if (!workflowSnap.exists()) throw new Error('Workflow not configured for JMC.');

        const steps = (workflowSnap.data()?.steps as WorkflowStep[]) ?? [];
        if (steps.length === 0) throw new Error('Workflow has no steps.');
        const firstStep = steps[0];

        const tempJmcData = { ...details, items, projectId: currentProject!.id };
        const assignees = await getAssigneeForStep(firstStep, tempJmcData as any);
        if (!assignees || assignees.length === 0) {
          throw new Error(`Could not determine assignee for step: ${firstStep.name}`);
        }

        const deadline = await calculateDeadline(new Date(), firstStep.tat);

        const initialLog: ActionLog = {
          action: 'Created',
          comment: 'JMC created.',
          userId: (user as any).id ?? (user as any).uid ?? 'unknown',
          userName: (user as any).name ?? (user as any).displayName ?? 'User',
          timestamp: Timestamp.now(),
          stepName: 'Creation',
        };

        const jmcData = {
          ...details,
          items,
          projectSlug,
          projectId: currentProject!.id,
          createdAt: Timestamp.now(),
          status: 'Pending' as const,
          stage: firstStep.name,
          currentStepId: firstStep.id,
          assignees,
          deadline: Timestamp.fromDate(deadline),
          history: [initialLog],
        };

        const newJmcRef = doc(collection(db, 'projects', currentProject!.id, 'jmcEntries'));
        transaction.set(newJmcRef, jmcData);
        transaction.update(configRef, { startingIndex: currentIndex + 1 });
      });

      await logUserActivity({
        userId: (user as any).id ?? (user as any).uid ?? 'unknown',
        userName: (user as any).name ?? (user as any).displayName,
        userEmail: (user as any).email,
        module: context.activityModule,
        action: 'Create JMC Entry',
        details: { project: projectSlug, jmcNo: details.jmcNo, workOrderNo: details.woNo, itemCount: items.length },
      });

      toast({
        title: 'JMC Entry Created',
        description: 'The new JMC entry has been successfully saved and workflow started.',
      });

      setDetails(initialJmcDetails);
      setItems([initialItem]);
    } catch (error: any) {
      console.error('Error creating JMC entry: ', error);
      toast({
        title: 'Save Failed',
        description: error?.message || 'An error occurred while saving the JMC entry.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(
      Number.isFinite(amount) ? amount : 0
    );

  /* ---------- resolution & access states ---------- */
  if (authIsLoading || isResolving) {
    return <JmcLoadingState blocks={2} />;
  }

  if (!canCreate) {
    return <JmcAccessDenied description="You do not have permission to create JMC entries." />;
  }

  if (notFound) {
    return (
      <JmcProjectNotFound description="This JMC entry screen could not resolve a project from the link you followed. Open it from a project in the Civil workspace and try again." />
    );
  }

  return (
    <>
      <JmcPageShell>
        <JmcPageHeader
          title="Create JMC Entry"
          subtitle={
            projectName
              ? `Raise a new Joint Measurement Certificate for ${projectName}`
              : 'Raise a new Joint Measurement Certificate'
          }
          icon={FilePlus}
          backHref={context.jmcHref()}
          backLabel="Back to JMC"
          gradient={JMC_GRADIENT}
          actions={
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Entry
            </Button>
          }
        />

        <JmcNav context={context} active="entry" />

        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>JMC Details</CardTitle>
            <CardDescription>Provide the main details for this Joint Measurement Certificate.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="space-y-2">
                <Label htmlFor="project">Project</Label>
                <Select value={selectedProjectId} onValueChange={handleProjectChange}>
                  <SelectTrigger id="project">
                    <SelectValue placeholder="Select a project" />
                  </SelectTrigger>
                  <SelectContent>
                    {allProjects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.projectName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="jmcNo">JMC No</Label>
                <Input id="jmcNo" name="jmcNo" value={details.jmcNo} readOnly className="font-semibold bg-muted/50" />
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
                <Label htmlFor="jmcDate">JMC Date</Label>
                <Input id="jmcDate" name="jmcDate" type="date" value={details.jmcDate} onChange={handleDetailChange} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>JMC Items</CardTitle>
                <CardDescription>Add one or more items executed under this JMC.</CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsBoqMultiSelectOpen(true)}
                disabled={!currentProject}
              >
                <Library className="mr-2 h-4 w-4" /> Add Items from BOQ
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto border-y border-border/60">
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
                    <TableHead className="text-right">Total Amount</TableHead>
                    <TableHead className="w-20 text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item, index) => (
                    <TableRow key={`${item.erpSlNo || 'erp'}_${item.boqSlNo || 'boq'}_${index}`}>
                      <TableCell className="whitespace-nowrap">{item.erpSlNo || '-'}</TableCell>
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
                      <TableCell className="whitespace-nowrap">{item.unit}</TableCell>
                      <TableCell className="whitespace-nowrap">{item.boqQty}</TableCell>
                      <TableCell className="whitespace-nowrap">{item.rate}</TableCell>
                      <TableCell className="whitespace-nowrap">{item.scope1 || '-'}</TableCell>
                      <TableCell className="whitespace-nowrap">{item.totalCertifiedQty}</TableCell>
                      <TableCell>
                        <Input
                          name="executedQty"
                          type="number"
                          step="any"
                          min={0}
                          value={item.executedQty}
                          onChange={(e) => handleItemChange(index, e)}
                          className="w-28"
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        {new Intl.NumberFormat('en-IN', {
                          style: 'currency',
                          currency: 'INR',
                          maximumFractionDigits: 2,
                        }).format(Number.isFinite(item.totalAmount) ? item.totalAmount : 0)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => removeItem(index)} aria-label="Remove row">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="p-4 sm:p-6">
              <Button variant="outline" size="sm" onClick={addItem}>
                <Plus className="mr-2 h-4 w-4" /> Add Item
              </Button>
            </div>
          </CardContent>
        </Card>
      </JmcPageShell>

      <BoqMultiSelectDialog
        key={currentProject?.id || 'no-project'}
        isOpen={isBoqMultiSelectOpen}
        onOpenChange={setIsBoqMultiSelectOpen}
        boqItems={boqItems}
        onConfirm={handleMultiBoqSelect}
        alreadyAddedItems={[]}
      />
    </>
  );
}

