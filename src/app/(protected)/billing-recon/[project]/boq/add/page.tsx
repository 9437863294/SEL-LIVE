'use client';

/**
 * BOQ › Add BOQ items — one item at a time, into the BOQ Billing Recon reads for the project
 * (`billingReconRegister(project).boqItems`). After a save the form clears for the next item.
 *
 * An item is a duplicate when another has the same scope 1 / scope 2 / BOQ SL No — the key every
 * JMC, MVAC and RA bill line finds its BOQ item by (src/lib/billing-recon/lines.ts). The same
 * SL No under another scope is a different item.
 */

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, ChevronsUpDown, ClipboardList, IndianRupee, Loader2, MapPinned, PlusSquare, Save, X } from 'lucide-react';
import { useParams } from 'next/navigation';
import { addDoc, collection, getDocs, query, serverTimestamp, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import type { Project, BoqItem as BoqItemType } from '@/lib/types';
import { projectMatchesSlug } from '@/lib/project-slug';
import { billingReconRegister } from '@/lib/billing-recon/register';
import { formatAmount, lineKey } from '@/lib/billing-recon/lines';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/shared/page-header';
import { AppTile, BrAccessDenied, BrNotice, BrPage, BrPageSkeleton, BR_TONE, type BrTone } from '@/components/billing-recon/page-kit';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import type { LucideIcon } from 'lucide-react';

const RESOURCE = 'Billing Recon.BOQ';

const initialBoqItem = {
  'Project Name': '',
  'Sub-Division': '',
  'Site': '',
  'Scope 1': '',
  'Scope 2': '',
  'Category 1': '',
  'Category 2': '',
  'Category 3': '',
  'ERP SL NO': '',
  'BOQ SL No': '',
  'Description': '',
  'Unit': '',
  'QTY': '',
  'Unit Rate': '',
  'Total Amount': '',
};

type FieldKey = keyof typeof initialBoqItem;

/** A typed number: '' is blank (null), "1,250.5" is 1250.5, anything else NaN. */
const parseTyped = (v: string): number | null => {
  const text = String(v ?? '').replace(/,/g, '').trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : NaN;
};

const NUMERIC_FIELDS: readonly FieldKey[] = ['QTY', 'Unit Rate', 'Total Amount'];

interface FieldConfig {
  key: FieldKey;
  type: 'input' | 'suggestion';
  placeholder?: string;
  wide?: boolean;
  required?: boolean;
}

const SECTIONS: ReadonlyArray<{ title: string; description: string; icon: LucideIcon; tone: BrTone; fields: FieldConfig[] }> = [
  {
    title: 'Where it belongs',
    description: 'Scope 1 and Scope 2 are part of the key JMC and MVAC lines find this item by.',
    icon: MapPinned,
    tone: 'teal',
    fields: [
      { key: 'Project Name', type: 'input' },
      { key: 'Sub-Division', type: 'suggestion', placeholder: 'Select or type a sub-division' },
      { key: 'Site', type: 'suggestion', placeholder: 'Select or type a site' },
      { key: 'Scope 1', type: 'suggestion', placeholder: 'Select or type scope 1' },
      { key: 'Scope 2', type: 'suggestion', placeholder: 'Select or type scope 2' },
      { key: 'Category 1', type: 'suggestion', placeholder: 'Select or type category 1' },
      { key: 'Category 2', type: 'suggestion', placeholder: 'Select or type category 2' },
      { key: 'Category 3', type: 'suggestion', placeholder: 'Select or type category 3' },
    ],
  },
  {
    title: 'The item',
    description: 'BOQ SL No and Description are required.',
    icon: ClipboardList,
    tone: 'emerald',
    fields: [
      { key: 'BOQ SL No', type: 'input', required: true },
      { key: 'ERP SL NO', type: 'input' },
      { key: 'Unit', type: 'suggestion', placeholder: 'Select or type a unit' },
      { key: 'Description', type: 'input', wide: true, required: true },
    ],
  },
  {
    title: 'Quantity and value',
    description: 'Leave Total Amount blank to use QTY × Unit Rate.',
    icon: IndianRupee,
    tone: 'cyan',
    fields: [
      { key: 'QTY', type: 'input' },
      { key: 'Unit Rate', type: 'input' },
      { key: 'Total Amount', type: 'input' },
    ],
  },
];

const SuggestionField = ({
  id,
  value,
  onChange,
  options,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder: string;
}) => {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);

  const typed = inputValue.trim();
  const exactMatch = useMemo(() => options.some((opt) => opt.toLowerCase() === typed.toLowerCase()), [options, typed]);
  const filtered = useMemo(() => options.filter((opt) => opt.toLowerCase().includes(typed.toLowerCase())), [options, typed]);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setInputValue(value);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('w-full min-w-0 justify-between text-left font-normal', !value && 'text-muted-foreground')}
        >
          <span className="truncate">{value || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" side="bottom" align="start">
        {/* cmdk selects the highlighted item on Enter, so the typed value is an item of its own —
            "Use …" — rather than a second Enter handler that the highlighted match then overrode. */}
        <Command shouldFilter={false}>
          <CommandInput placeholder={placeholder} value={inputValue} onValueChange={setInputValue} />
          <CommandList>
            <CommandEmpty>No matches found.</CommandEmpty>
            <CommandGroup>
              {filtered.map((option) => (
                <CommandItem
                  key={option}
                  value={`option:${option}`}
                  onSelect={() => {
                    onChange(option);
                    setOpen(false);
                  }}
                >
                  <Check className={cn('mr-2 h-4 w-4', value === option ? 'opacity-100' : 'opacity-0')} />
                  <span className="truncate">{option}</span>
                </CommandItem>
              ))}
              {typed && !exactMatch && (
                <CommandItem
                  value={`create:${typed}`}
                  onSelect={() => {
                    onChange(typed);
                    setOpen(false);
                  }}
                >
                  <PlusSquare className="mr-2 h-4 w-4" />
                  <span className="truncate">Use “{typed}”</span>
                </CommandItem>
              )}
              {value && (
                <CommandItem
                  value="clear:"
                  onSelect={() => {
                    onChange('');
                    setOpen(false);
                  }}
                  className="text-muted-foreground"
                >
                  <X className="mr-2 h-4 w-4" />
                  Clear
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default function AddBoqItemPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();
  const params = useParams();
  const projectSlug = params.project as string;

  const canAdd = can('Add Manual', RESOURCE);

  const [boqItem, setBoqItem] = useState<typeof initialBoqItem>(initialBoqItem);
  const [isSaving, setIsSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [existingBoqItems, setExistingBoqItems] = useState<BoqItemType[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'not-found' | 'failed'>('loading');
  const [added, setAdded] = useState<Array<{ id: string; slNo: string; description: string }>>([]);
  const reg = useMemo(() => billingReconRegister(currentProject), [currentProject]);

  useEffect(() => {
    if (authLoading || !canAdd) return;
    let alive = true;
    const fetchData = async () => {
      if (!projectSlug) return;
      try {
        const pSnap = await getDocs(query(collection(db, 'projects')));
        if (!alive) return;

        const allProjects = pSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Project));
        const pData = allProjects.find((p) => projectMatchesSlug(p.projectName, projectSlug));

        if (!pData) {
          setLoadState('not-found');
          return;
        }

        setProjectName(pData.projectName);
        setCurrentProject(pData);
        setBoqItem((prev) => ({ ...prev, 'Project Name': pData.projectName }));

        const bSnap = await getDocs(collection(db, 'projects', pData.id, billingReconRegister(pData).boqItems));
        if (!alive) return;
        setExistingBoqItems(bSnap.docs.map((d) => ({ id: d.id, ...d.data() } as BoqItemType)));
        setLoadState('ready');
      } catch (e) {
        console.error(e);
        if (!alive) return;
        setLoadState('failed');
        toast({ title: 'Load failed', description: 'Could not fetch project/BOQ data.', variant: 'destructive' });
      }
    };
    void fetchData();
    return () => {
      alive = false;
    };
  }, [projectSlug, toast, authLoading, canAdd]);

  const handleInputChange = (key: FieldKey, value: string) => {
    setBoqItem((prev) => ({ ...prev, [key]: value }));
  };

  const optionsCache = useMemo(() => {
    const map = new Map<FieldKey, string[]>();
    const fields = Object.keys(initialBoqItem) as FieldKey[];
    for (const k of fields) {
      const seen = new Set<string>();
      const opts: string[] = [];
      for (const item of existingBoqItems) {
        const t = String((item as any)[k] ?? '').trim();
        const l = t.toLowerCase();
        if (t && !seen.has(l)) {
          seen.add(l);
          opts.push(t);
        }
      }
      map.set(k, opts.sort((a, b) => a.localeCompare(b)));
    }
    return map;
  }, [existingBoqItems]);

  /* ── validation ───────────────────────────────────────────────────────────────────────────── */

  const numbers = {
    qty: parseTyped(boqItem['QTY']),
    rate: parseTyped(boqItem['Unit Rate']),
    total: parseTyped(boqItem['Total Amount']),
  };
  const numberErrors: Partial<Record<FieldKey, string>> = {};
  if (Number.isNaN(numbers.qty)) numberErrors['QTY'] = 'QTY must be a number.';
  if (Number.isNaN(numbers.rate)) numberErrors['Unit Rate'] = 'Unit Rate must be a number.';
  if (Number.isNaN(numbers.total)) numberErrors['Total Amount'] = 'Total Amount must be a number.';
  const computedTotal = (Number(numbers.qty) || 0) * (Number(numbers.rate) || 0);
  const effectiveTotal = numbers.total === null ? computedTotal : Number(numbers.total) || 0;

  const newKey = lineKey(boqItem);
  const slNoTyped = boqItem['BOQ SL No'].trim();
  const duplicateHere = Boolean(slNoTyped) && existingBoqItems.some((item) => lineKey(item) === newKey);

  const missingRequired = !slNoTyped || !boqItem['Description'].trim();

  const handleSave = async () => {
    setAttempted(true);
    if (!user) {
      toast({ title: 'Authentication Error', description: 'You must be logged in.', variant: 'destructive' });
      return;
    }
    if (!currentProject) {
      toast({ title: 'Project Error', description: 'Could not determine the current project.', variant: 'destructive' });
      return;
    }

    // Trim strings
    const cleaned = Object.fromEntries(
      Object.entries(boqItem).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]),
    ) as typeof boqItem;

    if (!cleaned['BOQ SL No'] || !cleaned['Description']) {
      toast({
        title: 'Missing Required Fields',
        description: 'Please fill in at least "BOQ SL No" and "Description".',
        variant: 'destructive',
      });
      return;
    }
    if (Object.keys(numberErrors).length > 0) {
      toast({ title: 'Check the numbers', description: Object.values(numberErrors)[0], variant: 'destructive' });
      return;
    }
    if (duplicateHere) {
      toast({
        title: 'Duplicate BOQ SL No',
        description: `An item with BOQ SL No "${cleaned['BOQ SL No']}" already exists under this scope.`,
        variant: 'destructive',
      });
      return;
    }

    setIsSaving(true);
    try {
      // Fresh check against the register (another person may have added it since the page loaded).
      // An import stores a numeric SL No as a number, so look for both spellings, and only an item
      // under the same scope 1 / scope 2 is a duplicate.
      const boqRef = collection(db, 'projects', currentProject.id, reg.boqItems);
      const slNo = cleaned['BOQ SL No'];
      const asNumber = Number(slNo);
      const lookups = [getDocs(query(boqRef, where('BOQ SL No', '==', slNo)))];
      if (/^\d+(\.\d+)?$/.test(slNo) && Number.isFinite(asNumber)) lookups.push(getDocs(query(boqRef, where('BOQ SL No', '==', asNumber))));
      const snaps = await Promise.all(lookups);
      const key = lineKey(cleaned);
      const clash = snaps.some((snap) => snap.docs.some((d) => lineKey(d.data()) === key));
      if (clash) {
        toast({
          title: 'Duplicate BOQ SL No',
          description: `An item with BOQ SL No "${slNo}" already exists under this scope.`,
          variant: 'destructive',
        });
        return;
      }

      const qty = Number(numbers.qty) || 0;
      const unitRate = Number(numbers.rate) || 0;
      const total = numbers.total === null ? qty * unitRate : Number(numbers.total) || 0;

      const payload = {
        ...cleaned,
        'QTY': qty,
        'Unit Rate': unitRate,
        'Total Amount': total,
        projectSlug: projectSlug, // Ensure projectSlug is saved
        createdAt: serverTimestamp(),
        createdBy: user.id,
      };

      const docRef = await addDoc(boqRef, payload);

      setExistingBoqItems((prev) => [...prev, { ...payload, id: docRef.id, createdAt: new Date() } as unknown as BoqItemType]);
      setAdded((prev) => [{ id: docRef.id, slNo, description: cleaned['Description'] }, ...prev].slice(0, 8));

      void logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: 'Billing Recon',
        action: 'Add BOQ Item',
        details: {
          project: projectSlug,
          itemSlNo: cleaned['BOQ SL No'],
          itemDescription: cleaned['Description'],
        },
      });

      toast({ title: 'Item Added', description: 'The new BOQ item has been successfully saved.' });

      // Keep where it belongs (scopes, categories, site) for the next item of the same section.
      setBoqItem((prev) => ({
        ...initialBoqItem,
        'Project Name': projectName,
        'Sub-Division': prev['Sub-Division'],
        'Site': prev['Site'],
        'Scope 1': prev['Scope 1'],
        'Scope 2': prev['Scope 2'],
        'Category 1': prev['Category 1'],
        'Category 2': prev['Category 2'],
        'Category 3': prev['Category 3'],
      }));
      setAttempted(false);
    } catch (error) {
      console.error('Error adding BOQ item: ', error);
      toast({ title: 'Save Failed', description: 'An error occurred while saving the item.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  /* ── render ───────────────────────────────────────────────────────────────────────────────── */

  const backHref = `/billing-recon/${projectSlug}/boq`;

  if (authLoading) return <BrPageSkeleton kpis={0} blocks={2} />;
  if (!canAdd) return <BrAccessDenied message="You need Billing Recon › BOQ › Add Manual to add BOQ items." />;

  const saveDisabled = isSaving || loadState !== 'ready' || missingRequired || Object.keys(numberErrors).length > 0;

  const saveButton = (
    <Button onClick={() => void handleSave()} disabled={saveDisabled}>
      {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
      Save item
    </Button>
  );

  return (
    <BrPage tone={BR_TONE.boq}>
      <PageHeader
        title="Add BOQ item"
        description="Add one item at a time to this project's BOQ. After a save the form keeps its scope and category for the next item."
        icon={PlusSquare}
        backHref={backHref}
        backLabel="Back to BOQ"
        meta={projectName ? [{ label: 'Project', value: projectName }, { label: 'Items in BOQ', value: existingBoqItems.length.toLocaleString('en-IN') }] : undefined}
        actions={saveButton}
      />

      {loadState === 'not-found' && (
        <BrNotice tone="danger" icon={AlertTriangle} title="Project not found">
          This link does not match any project. It may have been renamed or removed.
        </BrNotice>
      )}
      {loadState === 'failed' && (
        <BrNotice tone="danger" icon={AlertTriangle} title="Could not load the project">
          Check your connection and reload the page.
        </BrNotice>
      )}
      {duplicateHere && (
        <BrNotice tone="warning" icon={AlertTriangle} title="This BOQ SL No already exists under this scope">
          Another item has BOQ SL No “{slNoTyped}” with the same scope 1 and scope 2. Change the SL No or the scope.
        </BrNotice>
      )}

      {SECTIONS.map((section) => (
        <Card key={section.title} className="min-w-0">
          <CardContent className="space-y-4 p-4 sm:p-5">
            <div className="flex items-center gap-2.5">
              <AppTile tone={section.tone} icon={section.icon} size={30} />
              <div className="min-w-0">
                <h2 className="text-base font-bold leading-tight text-foreground">{section.title}</h2>
                <p className="text-xs text-muted-foreground">{section.description}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {section.fields.map(({ key, type, placeholder, wide, required }) => {
                const fieldId = `boq-add-${String(key).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
                const isNumeric = NUMERIC_FIELDS.includes(key);
                const error = numberErrors[key] ?? (attempted && required && !boqItem[key].trim() ? `${key} is required.` : undefined);
                return (
                  <div className={cn('min-w-0 space-y-1.5', wide && 'sm:col-span-2 lg:col-span-3')} key={key}>
                    <Label htmlFor={fieldId}>
                      {key}
                      {required && <span className="ml-0.5 text-rose-600">*</span>}
                    </Label>
                    {type === 'input' ? (
                      <Input
                        id={fieldId}
                        name={key}
                        value={boqItem[key]}
                        onChange={(e) => handleInputChange(key, e.target.value)}
                        readOnly={key === 'Project Name'}
                        inputMode={isNumeric ? 'decimal' : undefined}
                        placeholder={key === 'Total Amount' && computedTotal ? `${computedTotal}` : undefined}
                        aria-invalid={Boolean(error)}
                        className={cn(key === 'Project Name' && 'bg-muted', isNumeric && 'tabular-nums', error && 'border-rose-400')}
                      />
                    ) : (
                      <SuggestionField
                        id={fieldId}
                        value={boqItem[key]}
                        onChange={(value) => handleInputChange(key, value)}
                        options={optionsCache.get(key) ?? []}
                        placeholder={placeholder || `Enter ${key}`}
                      />
                    )}
                    {error && <p className="text-xs text-rose-700 dark:text-rose-300">{error}</p>}
                  </div>
                );
              })}
            </div>
            {section.title === 'Quantity and value' && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3">
                <div className="min-w-0 text-sm">
                  <div className="text-xs text-muted-foreground">{numbers.total === null ? 'Total amount (QTY × Unit Rate)' : 'Total amount (as entered)'}</div>
                  <div className="text-lg font-bold tabular-nums text-foreground">{formatAmount(effectiveTotal)}</div>
                </div>
                {saveButton}
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      {added.length > 0 && (
        <BrNotice tone="success" icon={CheckCircle2} title={`Added this session: ${added.length}`}>
          <ul className="mt-1 space-y-0.5">
            {added.map((a) => (
              <li key={a.id} className="truncate">
                <span className="font-medium">{a.slNo}</span> · {a.description}
              </li>
            ))}
          </ul>
        </BrNotice>
      )}
    </BrPage>
  );
}
