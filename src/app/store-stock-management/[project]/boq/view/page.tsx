
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Trash2, Loader2, View, MoreHorizontal, Search, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, getDocs, writeBatch, doc, deleteDoc, query, where } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import type { JmcEntry, Bill } from '@/lib/types';
import BoqItemDetailsDialog from '@/components/BoqItemDetailsDialog';
import { useParams } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';

type BoqItem = {
    id: string;
    'JMC Executed Qty'?: number;
    'Billed Qty'?: number;
    'Balance Qty'?: number;
    [key: string]: any;
};

const baseTableHeaders = [
    'Sl No',
    'Description',
    'UNIT',
    'BOQ QTY',
];

export default function ViewBoqPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { project: projectSlug } = useParams() as { project: string };
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [jmcEntries, setJmcEntries] = useState<JmcEntry[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  
  const [selectedBoqItem, setSelectedBoqItem] = useState<BoqItem | null>(null);
  const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [isColumnEditorOpen, setIsColumnEditorOpen] = useState(false);

  // Column Customization State
  const [columnOrder, setColumnOrder] = useState<string[]>(baseTableHeaders);
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(
    baseTableHeaders.reduce((acc, h) => ({ ...acc, [h]: true }), {})
  );
  const [columnNames, setColumnNames] = useState<Record<string, string>>(
    baseTableHeaders.reduce((acc, h) => ({ ...acc, [h]: h }), {})
  );

  useEffect(() => {
    const savedOrder = localStorage.getItem(`boqColumnOrder_${projectSlug}`);
    const savedVisibility = localStorage.getItem(`boqColumnVisibility_${projectSlug}`);
    const savedNames = localStorage.getItem(`boqColumnNames_${projectSlug}`);

    if (savedOrder) setColumnOrder(JSON.parse(savedOrder));
    if (savedVisibility) setColumnVisibility(JSON.parse(savedVisibility));
    if (savedNames) setColumnNames(JSON.parse(savedNames));

  }, [projectSlug]);
  
  const saveColumnPrefs = () => {
    localStorage.setItem(`boqColumnOrder_${projectSlug}`, JSON.stringify(columnOrder));
    localStorage.setItem(`boqColumnVisibility_${projectSlug}`, JSON.stringify(columnVisibility));
    localStorage.setItem(`boqColumnNames_${projectSlug}`, JSON.stringify(columnNames));
    toast({ title: 'Success', description: 'Column preferences saved.' });
  };

  const onDragEnd = (result: any) => {
    if (!result.destination) return;
    const items = Array.from(columnOrder);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    setColumnOrder(items);
  };
  
  const fetchBoqItems = async () => {
    if (!projectSlug) return;
    setIsLoading(true);
    try {
      const boqItemsRef = collection(db, 'boqItems');
      const q = query(boqItemsRef, where('projectSlug', '==', projectSlug));
      const boqSnapshot = await getDocs(q);

      const items = boqSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BoqItem));
      
      const sortedItems = items.sort((a, b) => {
        const slNoA = Number(a['Sl No']);
        const slNoB = Number(b['Sl No']);
        if (isNaN(slNoA) || isNaN(slNoB)) {
          return 0; 
        }
        return slNoA - slNoB;
      });

      setBoqItems(sortedItems);
      
    } catch (error: any) {
      console.error("Error fetching BOQ items: ", error);
      if (error.code === 'failed-precondition') {
          toast({
              title: 'Database Index Required',
              description: 'An index is required for this query. Please create a composite index on the `boqItems` collection for the `projectSlug` field.',
              variant: 'destructive',
              duration: 10000,
          });
      } else {
        toast({ title: 'Error', description: 'Failed to fetch BOQ items.', variant: 'destructive' });
      }
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchBoqItems();
  }, [projectSlug]);

  const handleRowClick = (item: BoqItem) => {
    setSelectedBoqItem(item);
    setIsDetailsDialogOpen(true);
  };
  
  const handleClearBoq = async () => {
    if (!user) return;
    setIsDeleting(true);
    try {
        const boqItemsRef = collection(db, 'boqItems');
        const q = query(boqItemsRef, where('projectSlug', '==', projectSlug));
        const querySnapshot = await getDocs(q);
        if (querySnapshot.empty) {
            toast({ title: 'No data to clear', description: 'The BOQ is already empty.' });
            setIsDeleting(false);
            return;
        }

        const batch = writeBatch(db);
        querySnapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });

        await batch.commit();

        await logUserActivity({
            userId: user.id,
            action: 'Clear BOQ (Stock)',
            details: { project: projectSlug, clearedItemCount: querySnapshot.size }
        });

        toast({
            title: 'BOQ Cleared',
            description: 'All items have been successfully deleted.',
        });
        fetchBoqItems();
    } catch (error) {
        console.error("Error clearing BOQ: ", error);
        toast({ title: 'Error', description: 'Failed to clear BOQ.', variant: 'destructive' });
    } finally {
        setIsDeleting(false);
    }
  }

  const handleDeleteSelected = async () => {
    if (!user) return;
    setIsDeleting(true);
    const batch = writeBatch(db);
    const boqItemsRef = collection(db, 'boqItems');
    selectedItemIds.forEach(id => {
        batch.delete(doc(boqItemsRef, id));
    });

    try {
        await batch.commit();

        await logUserActivity({
            userId: user.id,
            action: 'Delete BOQ Items (Stock)',
            details: { project: projectSlug, deletedItemCount: selectedItemIds.length }
        });

        toast({
            title: 'Success',
            description: `${selectedItemIds.length} item(s) deleted successfully.`,
        });
        setSelectedItemIds([]);
        fetchBoqItems();
    } catch (error) {
        console.error("Error deleting selected items:", error);
        toast({ title: 'Error', description: 'Failed to delete selected items.', variant: 'destructive' });
    }
    setIsDeleting(false);
  };
  
  const findBasicPriceKey = (item: BoqItem): string | undefined => {
    const keys = Object.keys(item);
    return keys.find(key => key.toLowerCase().includes('price') && !key.toLowerCase().includes('total'));
  };

  const formatNumber = (value: any) => {
    if (typeof value === 'number') {
      return new Intl.NumberFormat('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value);
    }
    return value;
  };
  
  const isNumeric = (value: any) => {
    return typeof value === 'number' || (typeof value === 'string' && !isNaN(parseFloat(value)) && isFinite(value as any));
  }
  
  const handleSelectAll = (checked: boolean) => {
      setSelectedItemIds(checked ? boqItems.map(item => item.id) : []);
  };
  
  const handleSelectRow = (id: string, checked: boolean) => {
      setSelectedItemIds(prev => checked ? [...prev, id] : prev.filter(itemId => itemId !== id));
  };
  
  const filteredItems = useMemo(() => {
    return boqItems.filter(item => {
        const description1 = item['Description'] || '';
        const description2 = getItemDescription(item);
        
        return (
            (String(item['Sl No'] || '').toLowerCase().includes(searchTerm.toLowerCase())) ||
            (String(description1).toLowerCase().includes(searchTerm.toLowerCase())) ||
            (String(description2).toLowerCase().includes(searchTerm.toLowerCase()))
        );
    });
  }, [boqItems, searchTerm]);

  const visibleHeaders = columnOrder.filter(header => columnVisibility[header]);

  const getItemDescription = (item: BoqItem) => {
    return item['Description'] 
        || item['DESCRIPTION OF ITEMS'] 
        || item['DESCRIPTION OF ITEMS(SCHEDULE-VIIA-SS) SUPPLY OF FOLLOWING EQUIPMENT & MATERIALS (As per Technical Specification)'] 
        || '';
  };

  return (
    <>
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
              <Link href={`/store-stock-management/${projectSlug}/boq`}>
                  <Button variant="ghost" size="icon">
                      <ArrowLeft className="h-6 w-6" />
                  </Button>
              </Link>
              <h1 className="text-xl font-bold">View BOQ</h1>
          </div>
          <div className="flex items-center gap-2">
               <Input
                  placeholder="Search BOQ..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="max-w-sm"
              />
              {selectedItemIds.length > 0 && (
                  <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" disabled={isDeleting}>
                          {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                          Delete ({selectedItemIds.length})
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                          <AlertDialogHeader>
                              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                              <AlertDialogDescription>
                                  This will permanently delete {selectedItemIds.length} item(s). This action cannot be undone.
                              </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={handleDeleteSelected}>Continue</AlertDialogAction>
                          </AlertDialogFooter>
                      </AlertDialogContent>
                  </AlertDialog>
              )}
               <Button variant="outline" onClick={() => setIsColumnEditorOpen(true)}>
                    <Settings className="mr-2 h-4 w-4" /> Columns
                </Button>
          </div>
        </div>
        <Card>
          <CardContent className="p-0">
              <ScrollArea className="h-[calc(100vh-15rem)]">
                  <Table>
                      <TableHeader className="sticky top-0 bg-background z-10">
                          <TableRow>
                              <TableHead className="w-[50px]">
                                  <Checkbox 
                                      checked={selectedItemIds.length > 0 && selectedItemIds.length === filteredItems.length}
                                      onCheckedChange={(checked) => handleSelectAll(!!checked)}
                                  />
                              </TableHead>
                              {visibleHeaders.map((header) => (
                                  <TableHead key={header} className="whitespace-nowrap px-4">{columnNames[header] || header}</TableHead>
                              ))}
                          </TableRow>
                      </TableHeader>
                      <TableBody>
                          {isLoading ? (
                              Array.from({ length: 5 }).map((_, i) => (
                              <TableRow key={i}>
                                  <TableCell><Skeleton className="h-5 w-5" /></TableCell>
                                  {visibleHeaders.map((header, j) => (
                                      <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                                  ))}
                              </TableRow>
                              ))
                          ) : filteredItems.length > 0 ? (
                              filteredItems.map((item) => (
                                  <TableRow 
                                    key={item.id} 
                                    data-state={selectedItemIds.includes(item.id) && "selected"}
                                    onClick={() => handleRowClick(item)}
                                    className="cursor-pointer"
                                  >
                                      <TableCell onClick={(e) => e.stopPropagation()}>
                                          <Checkbox 
                                              checked={selectedItemIds.includes(item.id)}
                                              onCheckedChange={(checked) => handleSelectRow(item.id, !!checked)}
                                          />
                                      </TableCell>
                                      {visibleHeaders.map(header => {
                                          let cellData = getItemDescription(item);
                                          if (header !== 'Description') {
                                              cellData = item[header];
                                          }
                                          const formattedData = formatNumber(cellData);
                                          const numeric = isNumeric(cellData);
                                          return (
                                              <TableCell key={`${item.id}-${header}`} className={cn(numeric && 'text-right')}>
                                                  {formattedData}
                                              </TableCell>
                                          )
                                      })}
                                  </TableRow>
                              ))
                          ) : (
                              <TableRow>
                                  <TableCell colSpan={visibleHeaders.length + 1} className="text-center h-24">
                                      No BOQ items found for this project.
                                  </TableCell>
                              </TableRow>
                          )}
                      </TableBody>
                  </Table>
              </ScrollArea>
          </CardContent>
        </Card>
      </div>

        <Dialog open={isColumnEditorOpen} onOpenChange={setIsColumnEditorOpen}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Customize Columns</DialogTitle>
                </DialogHeader>
                <p className="text-sm text-muted-foreground">Drag to reorder, check to show/hide, and rename columns.</p>
                <ScrollArea className="h-96 pr-4">
                    <DragDropContext onDragEnd={onDragEnd}>
                        <Droppable droppableId="columns">
                            {(provided) => (
                                <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-2">
                                    {columnOrder.map((header, index) => (
                                        <Draggable key={header} draggableId={header} index={index}>
                                            {(provided) => (
                                                <div
                                                    ref={provided.innerRef}
                                                    {...provided.draggableProps}
                                                    {...provided.dragHandleProps}
                                                    className="flex items-center gap-2 p-2 border rounded-md bg-muted/50"
                                                >
                                                    <Checkbox
                                                        checked={columnVisibility[header]}
                                                        onCheckedChange={(checked) =>
                                                            setColumnVisibility(prev => ({ ...prev, [header]: !!checked }))
                                                        }
                                                    />
                                                    <Input
                                                        value={columnNames[header] || header}
                                                        onChange={(e) =>
                                                            setColumnNames(prev => ({ ...prev, [header]: e.target.value }))
                                                        }
                                                    />
                                                </div>
                                            )}
                                        </Draggable>
                                    ))}
                                    {provided.placeholder}
                                </div>
                            )}
                        </Droppable>
                    </DragDropContext>
                </ScrollArea>
                <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setIsColumnEditorOpen(false)}>Cancel</Button>
                    <Button onClick={() => { saveColumnPrefs(); setIsColumnEditorOpen(false); }}>Save Preferences</Button>
                </div>
            </DialogContent>
        </Dialog>


      <BoqItemDetailsDialog
        isOpen={isDetailsDialogOpen}
        onOpenChange={setIsDetailsDialogOpen}
        item={selectedBoqItem}
        jmcEntries={jmcEntries}
        bills={bills}
      />
    </>
  );
}
```,
  <change>
    <file>tailwind.config.ts</file>
    <content><![CDATA[import type {Config} from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        body: ['var(--font-body)', 'sans-serif'],
        inter: ['var(--font-inter)', 'sans-serif'],
        roboto: ['var(--font-roboto)', 'sans-serif'],
        headline: ['var(--font-inter)', 'sans-serif'],
        code: ['monospace'],
      },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))',
          foreground: 'hsl(var(--sidebar-foreground))',
          primary: 'hsl(var(--sidebar-primary))',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))',
          ring: 'hsl(var(--sidebar-ring))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: {
            height: '0',
          },
          to: {
            height: 'var(--radix-accordion-content-height)',
          },
        },
        'accordion-up': {
          from: {
            height: 'var(--radix-accordion-content-height)',
          },
          to: {
            height: '0',
          },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate'), require('react-beautiful-dnd')],
} satisfies Config;
