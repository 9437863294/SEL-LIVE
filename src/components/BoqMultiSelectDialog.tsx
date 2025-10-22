
'use client';

import { useState, useMemo, useEffect, useCallback, Fragment } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, doc } from 'firebase/firestore';
import type { JmcEntry, JmcItem, Bill, BillItem, BoqItem } from '@/lib/types';
import { Search, Loader2, ArrowUpDown, Settings } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useParams } from 'next/navigation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import type { CheckedState } from '@radix-ui/react-checkbox';
import { useAuth } from './auth/AuthProvider';
import { DragDropContext, Droppable, Draggable, OnDragEndResponder, DropResult } from 'react-beautiful-dnd';
import { cn } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Label } from './ui/label';

interface BoqMultiSelectDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onConfirm: (selectedItems: BoqItem[]) => void;
  alreadyAddedItems?: BillItem[];
}

const baseTableHeaders = [
    'Project', 'Site', 'Scope', 'Sl No', 'Description', 'UNIT', 'BOQ QTY', 'UNIT PRICE',
    'TOTAL PRICE FOR THE TENDER QUANTITY',
    'DESCRIPTION OF ITEMS(SCHEDULE-VIIA-SS) SUPPLY OF FOLLOWING EQUIPMENT & MATERIALS (As per Technical Specification)'
];


export function BoqMultiSelectDialog({
  isOpen,
  onOpenChange,
  onConfirm,
  alreadyAddedItems = [],
}: BoqMultiSelectDialogProps) {
  const { toast } = useToast();
  const params = useParams();
  const projectSlug = params.project as string;
  const { user } = useAuth();
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState(''); // debounced
  const [jmcItems, setJmcItems] = useState<JmcItemWithDetails[]>([]);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isColumnEditorOpen, setIsColumnEditorOpen] = useState(false);

  const [columnOrder, setColumnOrder] = useState<string[]>(baseTableHeaders);
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({});
  const [columnNames, setColumnNames] = useState<Record<string, string>>({});

  const userKey = user ? user.id : 'guest';
  const prefKey = `boqSelectDialog:${projectSlug}:${userKey}`;

  useEffect(() => {
    try {
      const savedPrefs = localStorage.getItem(prefKey);
      if (savedPrefs) {
        const { order, visibility, names } = JSON.parse(savedPrefs);
        if (order) setColumnOrder(order);
        if (visibility) setColumnVisibility(visibility);
        if (names) setColumnNames(names);
      } else {
         const defaults: Record<string, boolean> = { 'Sl No': true, 'Description': true, 'UNIT': true, 'UNIT PRICE': true };
         setColumnVisibility(baseTableHeaders.reduce((acc, h) => ({ ...acc, [h]: defaults[h] || false }), {}));
      }
    } catch (e) {
      console.warn("Failed to load dialog column prefs", e);
    }
  }, [prefKey]);

  const savePrefs = useCallback(() => {
    const prefs = {
      order: columnOrder,
      visibility: columnVisibility,
      names: columnNames
    };
    localStorage.setItem(prefKey, JSON.stringify(prefs));
    toast({ title: "Preferences Saved", description: "Your column settings for this dialog have been saved." });
  }, [columnOrder, columnVisibility, columnNames, prefKey, toast]);

  useEffect(() => {
    const t = setTimeout(() => setSearchTerm(searchInput.trim()), 250);
    return () => clearTimeout(t);
  }, [searchInput]);
  
  useEffect(() => {
    if (!isOpen || !projectSlug) return;

    const fetchBoqData = async () => {
      setIsLoading(true);
      try {
        const q = query(collection(db, 'boqItems'), where('projectSlug', '==', projectSlug));
        const boqSnapshot = await getDocs(q);
        const items = boqSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BoqItem));
        setBoqItems(items);
      } catch (error) {
        console.error('Error fetching data for item selection:', error);
        toast({
          title: 'Error',
          description: 'Could not load available BOQ items for this project.',
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
      }
    };
    fetchBoqData();
  }, [isOpen, projectSlug, toast]);


  const addedItemIds = useMemo(
    () => new Set(alreadyAddedItems.map((it) => it.jmcItemId)),
    [alreadyAddedItems]
  );
  
  const filteredItems = useMemo(() => {
    const q = searchTerm.toLowerCase();
    return boqItems.filter((item) => {
      if (addedItemIds.has(item.id)) return false;
      if (!q) return true;
      return Object.values(item).some(val => String(val).toLowerCase().includes(q));
    });
  }, [boqItems, searchTerm, addedItemIds]);
  
  const allOnPageSelected =
    filteredItems.length > 0 && filteredItems.every((it) => selectedIds.has(it.id));
  const noneSelected = filteredItems.every((it) => !selectedIds.has(it.id));
  const selectAllState: CheckedState =
    allOnPageSelected ? true : noneSelected ? false : 'indeterminate';

  const handleSelectAll = (checked: CheckedState) => {
    setSelectedIds(new Set(checked ? filteredItems.map((i) => i.id) : []));
  };
  
  const handleSelectRow = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const handleConfirm = () => {
    const selectedBoqItems = boqItems.filter((item) => selectedIds.has(item.id));
    onConfirm(selectedBoqItems);
    onOpenChange(false);
    setSelectedIds(new Set());
    setSearchInput('');
    setSearchTerm('');
  };

  const onDragEnd: OnDragEndResponder = (result) => {
    if (!result.destination) return;
    const items = Array.from(columnOrder);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    setColumnOrder(items);
  };
  
  const visibleHeaders = columnOrder.filter(header => columnVisibility[header]);

  return (
    <>
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-7xl">
        <DialogHeader>
          <DialogTitle>Select BOQ Items</DialogTitle>
          <DialogDescription>
            Select multiple items from the Bill of Quantities to add.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <div className="flex flex-col sm:flex-row items-center gap-2 mb-4">
            <div className="relative flex-grow w-full">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search all columns..."
                aria-label="Search items"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-8"
              />
            </div>
            <Button variant="outline" onClick={() => setIsColumnEditorOpen(true)}>
                <Settings className="mr-2 h-4 w-4" /> Columns
            </Button>
          </div>
          
          <ScrollArea className="h-96 border rounded-md">
            <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow>
                        <TableHead className="w-[50px]"><Checkbox aria-label="Select all" checked={selectAllState} onCheckedChange={handleSelectAll} /></TableHead>
                        {visibleHeaders.map(header => (
                            <TableHead key={header} className="whitespace-nowrap">{columnNames[header] || header}</TableHead>
                        ))}
                    </TableRow>
                </TableHeader>
                 <TableBody>
                    {isLoading ? (
                        <TableRow><TableCell colSpan={visibleHeaders.length + 1} className="h-24 text-center"><Loader2 className="animate-spin"/></TableCell></TableRow>
                    ) : filteredItems.length > 0 ? (
                        filteredItems.map(item => {
                            const rowChecked = selectedIds.has(item.id);
                            return (
                                <TableRow key={item.id} data-state={rowChecked ? "selected" : undefined}>
                                    <TableCell><Checkbox checked={rowChecked} onCheckedChange={(checked) => handleSelectRow(item.id, Boolean(checked))}/></TableCell>
                                    {visibleHeaders.map(header => (
                                        <TableCell key={header} className="whitespace-nowrap max-w-xs truncate">{String(item[header] ?? '')}</TableCell>
                                    ))}
                                </TableRow>
                            )
                        })
                    ) : (
                        <TableRow><TableCell colSpan={visibleHeaders.length + 1} className="h-24 text-center">No results.</TableCell></TableRow>
                    )}
                 </TableBody>
            </Table>
          </ScrollArea>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={selectedIds.size === 0}
          >
            Add {selectedIds.size} Selected Item{selectedIds.size === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={isColumnEditorOpen} onOpenChange={setIsColumnEditorOpen}>
        <DialogContent className="max-w-2xl">
            <DialogHeader>
                <DialogTitle>Customize Columns</DialogTitle>
                <DialogDescription>Drag to reorder, check to show/hide, and rename columns.</DialogDescription>
            </DialogHeader>
            <ScrollArea className="h-96 pr-4">
                <DragDropContext onDragEnd={onDragEnd}>
                    <Droppable droppableId="columns" isDropDisabled={false}>
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
            <DialogFooter>
                <Button variant="outline" onClick={() => setIsColumnEditorOpen(false)}>Cancel</Button>
                <Button onClick={() => { savePrefs(); setIsColumnEditorOpen(false); }}>Save Preferences</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
    </>
  );
}
