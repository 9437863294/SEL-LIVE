
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, ChevronsUpDown, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  limit,
  serverTimestamp,
} from 'firebase/firestore';
import { Label } from '@/components/ui/label';
import { useParams } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import type { Project, BoqItem as BoqItemType } from '@/lib/types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';

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
  'Total Amount': ''
};

const toNum = (v: string) => {
  const n = parseFloat(String(v ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
};

const SuggestionField = ({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder: string;
}) => {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);

  useEffect(() => { setInputValue(value); }, [value]);

  const exactMatch = useMemo(
    () => options.some(opt => opt.toLowerCase() === inputValue.toLowerCase()),
    [options, inputValue]
  );
  const filtered = useMemo(
    () => options.filter(opt => opt.toLowerCase().includes(inputValue.toLowerCase())),
    [options, inputValue]
  );

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
          type="button"
          variant="outline"
          role="combobox"
          className={cn('w-full justify-between font-normal', !value && 'text-muted-foreground')}
        >
          {value || placeholder}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" side="bottom" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={placeholder}
            value={inputValue}
            onValueChange={setInputValue}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && inputValue.trim()) {
                onChange(inputValue.trim());
                setOpen(false);
              }
            }}
          />
          <CommandList>
            <CommandEmpty>
              {inputValue && !exactMatch ? (
                <CommandItem
                  value={inputValue}
                  onSelect={() => {
                    onChange(inputValue.trim());
                    setOpen(false);
                  }}
                >
                  Create “{inputValue.trim()}”
                </CommandItem>
              ) : 'No matches found.'}
            </CommandEmpty>
            <CommandGroup>
              {filtered.map((option) => (
                <CommandItem
                  key={option}
                  value={option}
                  onSelect={() => {
                    onChange(option);
                    setOpen(false);
                  }}
                >
                  <Check className={cn('mr-2 h-4 w-4', value === option ? 'opacity-100' : 'opacity-0')} />
                  {option}
                </CommandItem>
              ))}
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
  const params = useParams();
  const projectSlug = params.project as string;

  const [boqItem, setBoqItem] = useState<typeof initialBoqItem>(initialBoqItem);
  const [isSaving, setIsSaving] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [existingBoqItems, setExistingBoqItems] = useState<BoqItemType[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);

  // ⚡️ Fast: single indexed lookup by slug + one subcollection read
  useEffect(() => {
    let alive = true;
    const fetchData = async () => {
      if (!projectSlug) return;
      try {
        const projectQ = query(
          collection(db, 'projects'),
          where('slug', '==', projectSlug),
          limit(1)
        );
        const pSnap = await getDocs(projectQ);
        if (!alive) return;

        if (pSnap.empty) {
          toast({ title: 'Project not found', description: 'Invalid project URL.', variant: 'destructive' });
          return;
        }

        const pDoc = pSnap.docs[0];
        const pData = { id: pDoc.id, ...pDoc.data() } as Project;
        setProjectName(pData.projectName);
        setCurrentProject(pData);
        setBoqItem(prev => ({ ...prev, 'Project Name': pData.projectName }));

        const bSnap = await getDocs(collection(db, 'projects', pData.id, 'boqItems'));
        if (!alive) return;
        setExistingBoqItems(bSnap.docs.map(d => ({id: d.id, ...d.data()} as BoqItemType)));
      } catch (e) {
        console.error(e);
        toast({ title: 'Load failed', description: 'Could not fetch project/BOQ data.', variant: 'destructive' });
      }
    };
    fetchData();
    return () => { alive = false; };
  }, [projectSlug, toast]);

  const handleInputChange = (key: keyof typeof boqItem, value: string) => {
    setBoqItem(prev => ({ ...prev, [key]: value }));
  };

  // 🔒 Stable memo (ref-based, no JSON.stringify)
  const optionsCache = useMemo(() => {
    const map = new Map<keyof typeof boqItem, string[]>();
    const fields = Object.keys(initialBoqItem) as (keyof typeof boqItem)[];
    for (const k of fields) {
      const seen = new Set<string>();
      const opts: string[] = [];
      for (const item of existingBoqItems) {
        const raw = (item[k] as string) || '';
        const t = raw.trim();
        const l = t.toLowerCase();
        if (t && !seen.has(l)) { seen.add(l); opts.push(t); }
      }
      map.set(k, opts.sort((a, b) => a.localeCompare(b)));
    }
    return map;
  }, [existingBoqItems]);

  const handleSave = async () => {
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
      Object.entries(boqItem).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])
    ) as typeof boqItem;

    if (!cleaned['BOQ SL No'] || !cleaned['Description']) {
      toast({
        title: 'Missing Required Fields',
        description: 'Please fill in at least "BOQ SL No" and "Description".',
        variant: 'destructive',
      });
      return;
    }

    setIsSaving(true);
    try {
      // Unique BOQ SL No within project (indexed)
      const dupQ = query(
        collection(db, 'projects', currentProject.id, 'boqItems'),
        where('BOQ SL No', '==', cleaned['BOQ SL No']),
        limit(1)
      );
      const dupSnap = await getDocs(dupQ);
      if (!dupSnap.empty) {
        toast({
          title: 'Duplicate BOQ SL No',
          description: `An item with BOQ SL No "${cleaned['BOQ SL No']}" already exists.`,
          variant: 'destructive',
        });
        setIsSaving(false);
        return;
      }

      const qty = toNum(cleaned['QTY']);
      const unitRate = toNum(cleaned['Unit Rate']);
      const total =
        (cleaned['Total Amount'] ?? '').toString().trim() === ''
          ? qty * unitRate
          : toNum(cleaned['Total Amount']);

      const payload = {
        ...cleaned,
        'QTY': qty,
        'Unit Rate': unitRate,
        'Total Amount': total,
        createdAt: serverTimestamp(),
        createdBy: user.id,
      };

      const docRef = await addDoc(collection(db, 'projects', currentProject.id, 'boqItems'), payload);

      // 🟢 Optimistic append: no second fetch
      setExistingBoqItems(prev => [...prev, { ...payload, id: docRef.id } as BoqItemType]);

      await logUserActivity({
        userId: user.id,
        action: 'Add BOQ Item',
        details: {
          project: projectSlug,
          itemSlNo: cleaned['BOQ SL No'],
          itemDescription: cleaned['Description'],
        }
      });

      toast({ title: 'Item Added', description: 'The new BOQ item has been successfully saved.' });

      setBoqItem({
        ...initialBoqItem,
        'Project Name': projectName,
      });
    } catch (error) {
      console.error('Error adding BOQ item: ', error);
      toast({
        title: 'Save Failed',
        description: 'An error occurred while saving the item.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const fieldsConfig: { key: keyof typeof initialBoqItem; type: 'input' | 'suggestion'; placeholder?: string }[] = [
    { key: 'Project Name', type: 'input' },
    { key: 'Sub-Division', type: 'suggestion', placeholder: 'Select or type Sub-Division' },
    { key: 'Site', type: 'suggestion', placeholder: 'Select or type Site' },
    { key: 'Scope 1', type: 'suggestion', placeholder: 'Select or type Scope 1' },
    { key: 'Scope 2', type: 'suggestion', placeholder: 'Select or type Scope 2' },
    { key: 'Category 1', type: 'suggestion', placeholder: 'Select or type Category 1' },
    { key: 'Category 2', type: 'suggestion', placeholder: 'Select or type Category 2' },
    { key: 'Category 3', type: 'suggestion', placeholder: 'Select or type Category 3' },
    { key: 'ERP SL NO', type: 'input' },
    { key: 'BOQ SL No', type: 'input' },
    { key: 'Description', type: 'input' },
    { key: 'Unit', type: 'suggestion', placeholder: 'Select or type Unit' },
    { key: 'QTY', type: 'input' },
    { key: 'Unit Rate', type: 'input' },
    { key: 'Total Amount', type: 'input' },
  ];

  const saveDisabled =
    isSaving ||
    !(boqItem['BOQ SL No'] ?? '').toString().trim() ||
    !(boqItem['Description'] ?? '').toString().trim();

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href={`/billing-recon/${projectSlug}/boq`}>
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">Add New BOQ Item</h1>
        </div>
        <Button onClick={handleSave} disabled={saveDisabled}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save Item
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Item Details</CardTitle>
          <CardDescription>Fill in the details for the new Bill of Quantities item.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {fieldsConfig.map(({ key, type, placeholder }) => {
              const fieldId = String(key).toLowerCase().replace(/\s+/g, '-');
              const isNumeric = ['QTY', 'Unit Rate', 'Total Amount'].includes(key as string);
              return (
                <div className="space-y-2" key={key}>
                  <Label htmlFor={fieldId}>{key}</Label>
                  {type === 'input' ? (
                    <Input
                      id={fieldId}
                      name={key}
                      value={boqItem[key]}
                      onChange={(e) => handleInputChange(key, e.target.value)}
                      readOnly={key === 'Project Name'}
                      inputMode={isNumeric ? 'decimal' : undefined}
                    />
                  ) : (
                    <SuggestionField
                      value={boqItem[key]}
                      onChange={(value) => handleInputChange(key, value)}
                      options={optionsCache.get(key) ?? []}
                      placeholder={placeholder || `Enter ${key}`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
