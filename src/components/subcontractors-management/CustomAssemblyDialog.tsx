
'use client';

import { useState, useMemo } from 'react';
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
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import type { BoqItem, WorkOrderItem, SubItem } from '@/lib/types';
import { Loader2, Plus, Search } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Separator } from '@/components/ui/separator';

interface CustomAssemblyDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onConfirm: (assembly: { mainItem: Omit<WorkOrderItem, 'id'>, bom: BoqItem[] }) => void;
  boqItems: BoqItem[];
}

const getItemDescription = (item: BoqItem): string => {
  const descriptionKeys = ['Description', 'DESCRIPTION OF ITEMS'];
  for (const key of descriptionKeys) {
    if (item[key]) return String(item[key]);
  }
  return 'No Description';
};

const getSlNo = (item: BoqItem): string => {
  return String(item['Sl No'] || item['SL. No.'] || '');
};

export function CustomAssemblyDialog({ isOpen, onOpenChange, onConfirm, boqItems }: CustomAssemblyDialogProps) {
  const { toast } = useToast();
  const [mainItemName, setMainItemName] = useState('');
  const [mainItemUnit, setMainItemUnit] = useState('');
  const [mainItemRate, setMainItemRate] = useState(0);
  const [mainItemQty, setMainItemQty] = useState(1);
  const [selectedBoqIds, setSelectedBoqIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');

  const filteredBoqItems = useMemo(() => {
    if (!searchTerm) return boqItems;
    const lowercasedFilter = searchTerm.toLowerCase();
    return boqItems.filter(item =>
      getItemDescription(item).toLowerCase().includes(lowercasedFilter) ||
      getSlNo(item).toLowerCase().includes(lowercasedFilter)
    );
  }, [boqItems, searchTerm]);

  const handleConfirm = () => {
    if (!mainItemName.trim() || !mainItemUnit.trim() || selectedBoqIds.size === 0) {
      toast({
        title: 'Missing Information',
        description: 'Please provide a name, unit, and select at least one BOQ item for the assembly.',
        variant: 'destructive',
      });
      return;
    }

    const selectedItems = boqItems.filter(item => selectedBoqIds.has(item.id));
    
    const newMainItem: Omit<WorkOrderItem, 'id'> = {
        boqItemId: `custom-${nanoid()}`, // Unique ID for custom item
        description: mainItemName,
        unit: mainItemUnit,
        orderQty: mainItemQty,
        rate: mainItemRate,
        totalAmount: mainItemRate * mainItemQty,
        boqSlNo: 'Custom',
        subItems: [], // The selected BOQ items will be processed into sub-items later
    };

    onConfirm({ mainItem: newMainItem, bom: selectedItems });
    onOpenChange(false);
    // Reset state
    setMainItemName('');
    setMainItemUnit('');
    setMainItemRate(0);
    setMainItemQty(1);
    setSelectedBoqIds(new Set());
    setSearchTerm('');
  };

  const handleSelect = (itemId: string, checked: boolean) => {
    setSelectedBoqIds(prev => {
        const newSet = new Set(prev);
        if(checked) {
            newSet.add(itemId);
        } else {
            newSet.delete(itemId);
        }
        return newSet;
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Create Custom Assembly Item</DialogTitle>
          <DialogDescription>
            Define a new main item and select the BOQ items that comprise it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 <div className="space-y-2">
                    <Label>Assembly Name</Label>
                    <Input placeholder="e.g., Tower Type A" value={mainItemName} onChange={e => setMainItemName(e.target.value)} />
                </div>
                 <div className="space-y-2">
                    <Label>Assembly Unit</Label>
                    <Input placeholder="e.g., Set" value={mainItemUnit} onChange={e => setMainItemUnit(e.target.value)} />
                </div>
                 <div className="space-y-2">
                    <Label>Order Quantity</Label>
                    <Input type="number" value={mainItemQty} onChange={e => setMainItemQty(Number(e.target.value))} />
                </div>
                <div className="space-y-2">
                    <Label>Rate (optional)</Label>
                    <Input type="number" placeholder="Leave blank to auto-calculate from sub-items" value={mainItemRate} onChange={e => setMainItemRate(Number(e.target.value))} />
                </div>
            </div>
            
            <Separator />
            
            <div>
                <Label>Select Sub-Items from BOQ</Label>
                <div className="relative mt-2">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search BOQ items..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-8"/>
                </div>
                <ScrollArea className="h-64 mt-2 border rounded-md">
                    <div className="p-2 space-y-2">
                        {filteredBoqItems.map(item => (
                            <div key={item.id} className="flex items-center space-x-3 p-2 rounded-md hover:bg-muted">
                                <Checkbox
                                    id={`check-${item.id}`}
                                    checked={selectedBoqIds.has(item.id)}
                                    onCheckedChange={(checked) => handleSelect(item.id, !!checked)}
                                />
                                <Label htmlFor={`check-${item.id}`} className="flex-1 cursor-pointer">
                                    <p className="font-medium text-sm">{getItemDescription(item)}</p>
                                    <p className="text-xs text-muted-foreground">Sl. No: {getSlNo(item)}</p>
                                </Label>
                            </div>
                        ))}
                    </div>
                </ScrollArea>
            </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={handleConfirm} disabled={selectedBoqIds.size === 0}>
             Create Assembly ({selectedBoqIds.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// nanoid is a smaller, URL-friendly unique ID generator
const nanoid = (size = 21) => crypto.getRandomValues(new Uint8Array(size)).reduce((id, byte) => {
    byte &= 63;
    if (byte < 36) {
      id += byte.toString(36);
    } else if (byte < 62) {
      id += (byte - 26).toString(36).toUpperCase();
    } else if (byte > 62) {
      id += '-';
    } else {
      id += '_';
    }
    return id;
}, '');
