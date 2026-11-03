'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { collection, getDocs, doc, getDoc, Timestamp, runTransaction } from 'firebase/firestore';
import { AlertTriangle, ClipboardList, FileText, Truck, Library, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { db } from '@/lib/firebase';
import type {
  BoqItem as BoqItemBase,
  MvacEntry,
  WorkflowStep,
  ActionLog,
  SerialNumberConfig,
} from '@/lib/types';
import { BoqItemSelector } from '@/components/billing-recon/BoqItemSelector';
import { BoqMultiSelectDialog } from '@/components/billing-recon/BoqMultiSelectDialog';
import { useBillingReconProjects } from '@/components/billing-recon/billing-recon-shell';
import { AppTile, BrAccessDenied, BrNotice, BrPage, BrPageSkeleton, BR_TONE } from '@/components/billing-recon/page-kit';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import { getAssigneeForStep, calculateDeadline } from '@/lib/workflow-utils';
import { billingReconRegister, WORKFLOWS_COLLECTION } from '@/lib/billing-recon/register';
import { localIsoDate } from '@/lib/billing-recon/lines';

/* ---------- local types ---------- */
type BoqItem = BoqItemBase & { projectId?: string; [k: string]: any };

/** A blank header. The date is today's in local time (a UTC date is yesterday before 05:30 IST). */
const freshDetails = (woNo = '') => ({
  mvacNo: '',
  woNo,
  mvacDate: localIsoDate(),
});

const initialItem = {
  erpSlNo: '',         // ✅ store ERP SL NO on each MVAC item
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

type MvacItem = typeof initialItem;

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

const compositeKey = (scope1: unknown, scope2: unknown, slNo: unknown) =>
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
const sortItemsByErp = (arr: MvacItem[]): MvacItem[] => {
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

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(
    Number.isFinite(amount) ? amount : 0
  );

/** Label + control, one cell of the details grid. */
function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** One figure in the totals bar. */
function Figure({ label, value, title, className }: { label: string; value: React.ReactNode; title?: string; className?: string }) {
  return (
    <div className={`min-w-0 ${className ?? ''}`} title={title}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate text-base font-bold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

export default function MvacEntryPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const { project: projectSlug } = useParams() as { project: string };

  // The project comes from the URL (the menu's switcher changes it), so the entry can't be filed
  // under one project while carrying another's slug.
  const { currentProject, loading: projectsLoading } = useBillingReconProjects();
  const reg = useMemo(() => billingReconRegister(currentProject), [currentProject]);
  const projectId = currentProject?.id ?? '';
  const projectWoNo = String((currentProject as any)?.woNo ?? '');

  const [details, setDetails] = useState(() => freshDetails());
  const [items, setItems] = useState<MvacItem[]>([{ ...initialItem }]);
  const [isSaving, setIsSaving] = useState(false);

  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [mvacEntries, setMvacEntries] = useState<MvacEntry[]>([]);
  const [isBoqLoading, setIsBoqLoading] = useState(true);
  const [isBoqMultiSelectOpen, setIsBoqMultiSelectOpen] = useState(false);

  const canCreate = can('Create MVAC Entry', 'Billing Recon.MVAC', projectSlug);

  /* ---------- this project's BOQ and MVAC entries ---------- */
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    const loadProjectData = async () => {
      setIsBoqLoading(true);
      try {
        const [boqSnap, mvacSnap] = await Promise.all([
          getDocs(collection(db, 'projects', projectId, reg.boqItems)),
          getDocs(collection(db, 'projects', projectId, reg.mvacEntries)),
        ]);
        if (cancelled) return;
        setBoqItems(
          boqSnap.docs.map(
            (d) =>
              ({
                ...(d.data() as object),
                id: d.id,
                projectId,
              } as BoqItem)
          )
        );
        setMvacEntries(
          mvacSnap.docs.map((d) => ({
            ...(d.data() as Omit<MvacEntry, 'id'>),
            id: d.id,
          }))
        );
      } catch (e) {
        console.error('Failed to load project data:', e);
        if (!cancelled) toast({ title: 'Error', description: 'Could not load project data.', variant: 'destructive' });
      } finally {
        if (!cancelled) setIsBoqLoading(false);
      }
    };
    loadProjectData();
    return () => {
      cancelled = true;
    };
  }, [projectId, reg.boqItems, reg.mvacEntries, toast]);

  // The WO No is the project's; a different project (switched in the menu) starts a fresh entry.
  useEffect(() => {
    setDetails((prev) => (prev.woNo === projectWoNo ? prev : { ...prev, woNo: projectWoNo }));
  }, [projectWoNo]);
  useEffect(() => {
    setItems([{ ...initialItem }]);
  }, [projectId]);

  /* ---------- auto-generate MVAC No when scope1/scope2 ready ---------- */
  const firstScope1 = items[0]?.scope1 ?? '';
  const firstScope2 = items[0]?.scope2 ?? '';
  useEffect(() => {
    let cancelled = false;
    const generateMvacNo = async () => {
      if (!projectId || !firstScope1 || !firstScope2) {
        setDetails((prev) => ({ ...prev, mvacNo: '' }));
        return;
      }

      const configSlug = `${projectId}_${slugify(firstScope2)}_${slugify(firstScope1)}`;
      try {
        const configRef = doc(db, reg.serialConfigs, configSlug);
        const configDoc = await getDoc(configRef);
        if (cancelled) return;
        if (configDoc.exists()) {
          const configData = configDoc.data() as SerialNumberConfig;
          const index = configData.startingIndex;
          const formatted = String(index).padStart(4, '0');
          const newMvacNo = `${configData.prefix || ''}${configData.format || ''}${formatted}${configData.suffix || ''}`;
          setDetails((prev) => ({ ...prev, mvacNo: newMvacNo }));
        } else {
          setDetails((prev) => ({ ...prev, mvacNo: 'Config not found' }));
        }
      } catch {
        if (!cancelled) setDetails((prev) => ({ ...prev, mvacNo: 'Error generating ID' }));
      }
    };
    generateMvacNo();
    return () => {
      cancelled = true;
    };
  }, [firstScope1, firstScope2, projectId, reg.serialConfigs]);

  /* ---------- certified qty map (robust to key casing) ---------- */
  const totalCertifiedQtyMap = useMemo(() => {
    const map: Record<string, number> = {};
    mvacEntries.forEach((entry) => {
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
  }, [mvacEntries]);

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
    const newMvacItems: MvacItem[] = selected
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
      .filter(Boolean) as MvacItem[];

    const existing = items.length === 1 && items[0].boqSlNo === '' && items[0].erpSlNo === '' ? [] : items;

    const merged = [...existing, ...newMvacItems];
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
      !details.mvacNo ||
      /not found|error/i.test(details.mvacNo) ||
      !details.woNo ||
      items.some((it) => !it.boqSlNo);

    if (hasBad) {
      toast({
        title: 'Missing Required Fields',
        description:
          'Please select a project, ensure WO No is set, and add at least one valid item with a generated MVAC No.',
        variant: 'destructive',
      });
      setIsSaving(false);
      return;
    }

    try {
      const firstItem = items[0];
      const configSlug = `${currentProject!.id}_${slugify(firstItem.scope2)}_${slugify(firstItem.scope1)}`;
      const configRef = doc(db, reg.serialConfigs, configSlug);

      await runTransaction(db, async (transaction) => {
        const configDoc = await transaction.get(configRef);
        if (!configDoc.exists()) throw new Error('Serial number configuration could not be found for this scope.');
        const configData = configDoc.data() as SerialNumberConfig;

        const currentIndex = configData.startingIndex;
        const formattedIndex = String(currentIndex).padStart(4, '0');
        const expectedMvacNo = `${configData.prefix || ''}${configData.format || ''}${formattedIndex}${
          configData.suffix || ''
        }`;

        if (details.mvacNo !== expectedMvacNo) {
          throw new Error(`MVAC number mismatch. Expected ${expectedMvacNo}, but found ${details.mvacNo}. Please refresh.`);
        }

        const workflowRef = doc(db, WORKFLOWS_COLLECTION, reg.mvacWorkflowId);
        const workflowSnap = await getDoc(workflowRef);
        if (!workflowSnap.exists()) throw new Error('Workflow not configured for MVAC.');

        const steps = (workflowSnap.data()?.steps as WorkflowStep[]) ?? [];
        if (steps.length === 0) throw new Error('Workflow has no steps.');
        const firstStep = steps[0];

        const tempMvacData = { ...details, items, projectId: currentProject!.id };
        const assignees = await getAssigneeForStep(firstStep, tempMvacData as any);
        if (!assignees || assignees.length === 0) {
          throw new Error(`Could not determine assignee for step: ${firstStep.name}`);
        }

        const deadline = await calculateDeadline(new Date(), firstStep.tat);

        const initialLog: ActionLog = {
          action: 'Created',
          comment: 'MVAC created.',
          userId: (user as any).id ?? (user as any).uid ?? 'unknown',
          userName: (user as any).name ?? (user as any).displayName ?? 'User',
          timestamp: Timestamp.now(),
          stepName: 'Creation',
        };

        const MvacData = {
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

        const newMvacRef = doc(collection(db, 'projects', currentProject!.id, reg.mvacEntries));
        transaction.set(newMvacRef, MvacData);
        transaction.update(configRef, { startingIndex: currentIndex + 1 });
      });

      await logUserActivity({
        userId: (user as any).id ?? (user as any).uid ?? 'unknown',
        userName: (user as any).name ?? (user as any).displayName,
        userEmail: (user as any).email,
        module: 'Billing Recon',
        action: 'Create MVAC Entry',
        details: { project: projectSlug, mvacNo: details.mvacNo, workOrderNo: details.woNo, itemCount: items.length },
      });

      toast({
        title: 'MVAC Entry Created',
        description: 'The new MVAC entry has been successfully saved and workflow started.',
      });

      // Keep the project's WO No: resetting it to blank made the next save fail until a reload.
      setDetails(freshDetails(projectWoNo));
      setItems([{ ...initialItem }]);
    } catch (error: any) {
      console.error('Error creating MVAC entry: ', error);
      toast({
        title: 'Save Failed',
        description: error?.message || 'An error occurred while saving the MVAC entry.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  /* ---------- figures for the totals bar ---------- */
  const pickedCount = items.filter((it) => it.boqSlNo).length;
  const unpickedCount = items.length - pickedCount;
  const totalAmount = items.reduce((sum, it) => sum + (Number.isFinite(it.totalAmount) ? it.totalAmount : 0), 0);
  const numberProblem: 'missing' | 'error' | null =
    details.mvacNo === 'Config not found' ? 'missing' : /error/i.test(details.mvacNo) ? 'error' : null;
  const statusLine = !details.woNo
    ? 'This project has no WO No — set it in Settings › Billing Status first.'
    : numberProblem === 'missing'
      ? 'No MVAC number series for this scope yet.'
      : numberProblem === 'error'
        ? 'The MVAC number could not be read — pick the item again.'
        : pickedCount === 0
          ? 'Pick at least one BOQ item to number the MVAC.'
          : unpickedCount > 0
            ? `${unpickedCount} row${unpickedCount === 1 ? ' has' : 's have'} no BOQ item — pick one or remove the row.`
            : 'Saving numbers the MVAC and sends it to the first step of the MVAC workflow.';

  /* ---------- states ---------- */
  if (isAuthLoading || projectsLoading) return <BrPageSkeleton kpis={0} blocks={2} />;
  if (!canCreate) return <BrAccessDenied message="You don't have permission to create MVAC entries." />;

  if (!currentProject) {
    return (
      <BrPage tone={BR_TONE.mvac}>
        <PageHeader title="New MVAC Entry" icon={Truck} backHref="/billing-recon" backLabel="Back to Billing Recon" />
        <BrNotice tone="warning" icon={AlertTriangle} title="Project not found">
          No project matches this address. Choose a project from the switcher at the top of the menu.
        </BrNotice>
      </BrPage>
    );
  }

  return (
    <BrPage tone={BR_TONE.mvac}>
      <PageHeader
        title="New MVAC Entry"
        description="Record the quantities executed against the BOQ. Saving numbers the MVAC and starts its approval workflow."
        icon={Truck}
        backHref={`/billing-recon/${projectSlug}/mvac`}
        backLabel="Back to MVAC"
      />

      {!projectWoNo && (
        <BrNotice
          tone="warning"
          icon={AlertTriangle}
          title="This project has no work order number"
          action={
            <Button asChild size="sm" variant="outline">
              <Link href="/billing-recon/settings/billing-status">Billing Status</Link>
            </Button>
          }
        >
          A MVAC carries the project&apos;s WO No. Add it in Settings › Billing Status, then come back to save.
        </BrNotice>
      )}
      {numberProblem === 'missing' && (
        <BrNotice
          tone="warning"
          icon={AlertTriangle}
          title="No MVAC number series for this scope"
          action={
            <Button asChild size="sm" variant="outline">
              <Link href="/billing-recon/settings/serial-no">Serial numbers</Link>
            </Button>
          }
        >
          The number comes from the first item&apos;s scope ({firstScope1} / {firstScope2}), which has no series in Settings › Serial No.
          Configuration yet.
        </BrNotice>
      )}
      {numberProblem === 'error' && (
        <BrNotice tone="danger" icon={AlertTriangle} title="The MVAC number could not be read">
          Check the connection and pick the first item again.
        </BrNotice>
      )}

      <Card>
        <CardHeader className="flex flex-row items-start gap-3 space-y-0">
          <AppTile tone={BR_TONE.mvac} icon={FileText} size={36} />
          <div className="min-w-0">
            <CardTitle className="text-base">MVAC details</CardTitle>
            <CardDescription>The MVAC&apos;s header. The number and WO No fill in by themselves.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Project" htmlFor="project">
              <Input id="project" value={currentProject.projectName ?? ''} title={currentProject.projectName ?? ''} readOnly className="truncate bg-muted/50" />
            </Field>
            <Field label="MVAC No" htmlFor="mvacNo" hint="From the first item's Scope 1 / Scope 2 series.">
              <Input
                id="mvacNo"
                name="mvacNo"
                value={details.mvacNo}
                placeholder="Assigned when you pick an item"
                readOnly
                className="bg-muted/50 font-semibold"
              />
            </Field>
            <Field label="WO No" htmlFor="woNo">
              <Input id="woNo" name="woNo" value={details.woNo || '— not set —'} readOnly className="cursor-not-allowed bg-muted/50" />
            </Field>
            <Field label="MVAC Date" htmlFor="mvacDate">
              <Input id="mvacDate" name="mvacDate" type="date" value={details.mvacDate} onChange={handleDetailChange} />
            </Field>
          </div>
        </CardContent>
      </Card>

      <TableCard
        title="Line items"
        description="Pick the BOQ item on each row and enter the quantity executed under this MVAC."
        icon={ClipboardList}
        count={pickedCount}
        noun="item"
        actions={
          <Button variant="outline" onClick={() => setIsBoqMultiSelectOpen(true)} disabled={isBoqLoading}>
            {isBoqLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Library className="mr-2 h-4 w-4" />}
            Add from BOQ
          </Button>
        }
        footer={
          <Button variant="outline" size="sm" onClick={addItem}>
            <Plus className="mr-2 h-4 w-4" /> Add row
          </Button>
        }
      >
        <Table className="min-w-[1100px]">
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap">ERP Sl. No.</TableHead>
              <TableHead className="whitespace-nowrap">BOQ Sl. No.</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="whitespace-nowrap text-right">BOQ Qty</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead className="whitespace-nowrap">Scope 1</TableHead>
              <TableHead className="whitespace-nowrap text-right">Total Certified Qty</TableHead>
              <TableHead className="whitespace-nowrap">Executed Qty</TableHead>
              <TableHead className="whitespace-nowrap text-right">Total Amount</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Remove</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item, index) => (
              <TableRow key={`${item.erpSlNo || 'erp'}_${item.boqSlNo || 'boq'}_${index}`}>
                <TableCell className="whitespace-nowrap">{item.erpSlNo || '-'}</TableCell>
                <TableCell className="min-w-[12rem]">
                  <BoqItemSelector
                    boqItems={boqItems}
                    selectedSlNo={item.boqSlNo}
                    onSelect={(boq) => handleBoqSelect(index, boq)}
                    isLoading={isBoqLoading}
                  />
                </TableCell>
                <TableCell className="max-w-xs">
                  {item.description ? (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger className="block max-w-xs truncate text-left">{item.description}</TooltipTrigger>
                        <TooltipContent>
                          <p className="max-w-md">{item.description}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>{item.unit}</TableCell>
                <TableCell className="text-right tabular-nums">{item.boqQty}</TableCell>
                <TableCell className="text-right tabular-nums">{item.rate}</TableCell>
                <TableCell className="whitespace-nowrap">{item.scope1 || '-'}</TableCell>
                <TableCell className="text-right tabular-nums">{item.totalCertifiedQty}</TableCell>
                <TableCell>
                  <Input
                    name="executedQty"
                    type="number"
                    step="any"
                    min={0}
                    value={item.executedQty}
                    onChange={(e) => handleItemChange(index, e)}
                    className="w-28"
                    aria-label={`Executed quantity, row ${index + 1}`}
                  />
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{formatCurrency(item.totalAmount)}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => removeItem(index)} aria-label="Remove row">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>

      {/* Totals and save, kept in reach while scrolling the lines (above the phone's tab bar). */}
      <div className="sticky bottom-20 z-20 -mx-1 print:hidden lg:bottom-3">
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 shadow-lg sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Figure label="Items" value={pickedCount} />
              <Figure label="Executed value" value={formatCurrency(totalAmount)} />
              <Figure
                label="MVAC No"
                value={details.mvacNo && !numberProblem ? details.mvacNo : '—'}
                title={details.mvacNo || undefined}
                className="col-span-2 sm:col-span-1"
              />
            </div>
            <p className="text-xs text-muted-foreground">{statusLine}</p>
          </div>
          <Button onClick={handleSave} disabled={isSaving} className="shrink-0">
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save entry
          </Button>
        </div>
      </div>

      <BoqMultiSelectDialog
        key={projectId || 'no-project'}
        isOpen={isBoqMultiSelectOpen}
        onOpenChange={setIsBoqMultiSelectOpen}
        boqItems={boqItems}
        onConfirm={handleMultiBoqSelect}
        alreadyAddedItems={[]}
      />
    </BrPage>
  );
}
