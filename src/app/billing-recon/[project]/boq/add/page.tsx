
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, ChevronsUpDown, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, query } from 'firebase/firestore';
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

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className={cn("w-full justify-between font-normal", !value && "text-muted-foreground")}
        >
          {value || placeholder}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" side="bottom" align="start">
        <Command>
          <CommandInput
            placeholder={placeholder}
            value={inputValue}
            onValueChange={setInputValue}
          />
          <CommandList>
            <CommandEmpty>
                {inputValue && !options.some(opt => opt.toLowerCase() === inputValue.toLowerCase()) ? (
                    <CommandItem
                        value={inputValue}
                        onSelect={() => {
                            onChange(inputValue);
                            setOpen(false);
                        }}
                    >
                        Create "{inputValue}"
                    </CommandItem>
                ) : 'No matches found.'}
            </CommandEmpty>
            <CommandGroup>
              {options.filter(opt => opt.toLowerCase().includes(inputValue.toLowerCase())).map((option) => (
                <CommandItem
                  key={option}
                  value={option}
                  onSelect={(currentValue) => {
                    onChange(currentValue === value ? '' : currentValue);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === option ? "opacity-100" : "opacity-0")} />
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
  const [boqItem, setBoqItem] = useState(initialBoqItem);
  const [isSaving, setIsSaving] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [existingBoqItems, setExistingBoqItems] = useState<BoqItemType[]>([]);

  useEffect(() => {
    const fetchProjectAndBoqData = async () => {
      if (!projectSlug) return;
      const projectsQuery = query(collection(db, 'projects'));
      const projectsSnapshot = await getDocs(projectsQuery);
      const slugify = (text: string) => text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');
      const projectData = projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)).find(p => slugify(p.projectName) === projectSlug);
      
      if (projectData) {
        setProjectName(projectData.projectName);
        setBoqItem(prev => ({ ...prev, 'Project Name': projectData.projectName }));
      }

      const boqQuery = query(collection(db, 'projects', projectData?.id || '', 'boqItems'));
      const boqSnapshot = await getDocs(boqQuery);
      setExistingBoqItems(boqSnapshot.docs.map(doc => doc.data() as BoqItemType));
    };
    fetchProjectAndBoqData();
  }, [projectSlug]);


  const handleInputChange = (key: keyof typeof boqItem, value: string) => {
    setBoqItem(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (!user) {
        toast({ title: 'Authentication Error', description: 'You must be logged in.', variant: 'destructive'});
        return;
    }
    setIsSaving(true);
    // Basic validation
    if (!boqItem['BOQ SL No'] || !boqItem['Description']) {
        toast({
            title: 'Missing Required Fields',
            description: 'Please fill in at least "BOQ SL No" and "Description".',
            variant: 'destructive',
        });
        setIsSaving(false);
        return;
    }
    
    try {
        await addDoc(collection(db, 'projects', projectSlug, 'boqItems'), boqItem);

        await logUserActivity({
            userId: user.id,
            action: 'Add BOQ Item',
            details: {
                project: projectSlug,
                itemSlNo: boqItem['BOQ SL No'],
                itemDescription: boqItem['Description'],
            }
        });

        toast({
            title: 'Item Added',
            description: 'The new BOQ item has been successfully saved.',
        });
        setBoqItem({
          ...initialBoqItem,
          'Project Name': projectName // Keep project name after reset
        });
        
        // Refetch to get new suggestions
        const boqQuery = query(collection(db, 'projects', projectSlug, 'boqItems'));
        const boqSnapshot = await getDocs(boqQuery);
        setExistingBoqItems(boqSnapshot.docs.map(doc => doc.data() as BoqItemType));


    } catch (error) {
        console.error("Error adding BOQ item: ", error);
        toast({
            title: 'Save Failed',
            description: 'An error occurred while saving the item.',
            variant: 'destructive',
        });
    } finally {
        setIsSaving(false);
    }
  };

  const getUniqueOptions = (field: keyof typeof boqItem) => {
    return [...new Set(existingBoqItems.map(item => item[field]).filter(Boolean) as string[])];
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
        <Button onClick={handleSave} disabled={isSaving}>
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
                {fieldsConfig.map(({ key, type, placeholder }) => (
                    <div className="space-y-2" key={key}>
                        <Label htmlFor={key}>{key}</Label>
                        {type === 'input' ? (
                            <Input
                                id={key}
                                name={key}
                                value={boqItem[key]}
                                onChange={(e) => handleInputChange(key, e.target.value)}
                                readOnly={key === 'Project Name'}
                            />
                        ) : (
                            <SuggestionField
                                value={boqItem[key]}
                                onChange={(value) => handleInputChange(key, value)}
                                options={getUniqueOptions(key)}
                                placeholder={placeholder || `Enter ${key}`}
                            />
                        )}
                    </div>
                ))}
            </div>
        </CardContent>
      </Card>
    </div>
  );
}
