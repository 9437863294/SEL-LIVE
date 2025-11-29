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
import type { BoqItem, WorkOrderItem } from '@/lib/types';
import { Loader2, Plus, Search, ArrowUpDown } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Separator } from '../ui/separator';
import { cn } from '@/lib/utils';

interface CustomAssemblyDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onConfirm: (assembly: { mainItem: Omit<WorkOrderItem, 'id'>; bom: BoqItem[] }) => void;
  boqItems: BoqItem[];
}

const getItemDescription = (item: BoqItem): string => {
  const descriptionKeys = ['Description', 'DESCRIPTION OF ITEMS'];
  for (const key of descriptionKeys) {
    if (item[key]) return String(item[key]);
  }
  const fallbackKey = Object.keys(item).find(k => k.toLowerCase().includes('description'));
  return fallbackKey ? String(item[fallbackKey]) : 'No Description';
};

const getSlNo = (item: BoqItem): string => {
  return String(item['BOQ SL No'] || item['SL. No.'] || '');
};

const getErpSlNo = (item: BoqItem): string => {
    return String(item['ERP SL NO'] || '');
};

const getBoqQty = (item: BoqItem): string => {
    return String(item['QTY'] || item['Total Qty'] || '0');
};

const getUnit = (item: BoqItem): string => {
    return String(item['Unit'] || item['UNIT'] || 'N/A');
};

const findRateKey = (item: BoqItem): string | undefined => {
    const keys = Object.keys(item);
    if ('Unit Rate' in item) return 'Unit Rate';
    if ('UNIT PRICE' in item) return 'UNIT PRICE';
    return keys.find(key => key.toLowerCase().includes('rate') && !key.toLowerCase().includes('total'));
};

const getRateNumber = (rate: unknown) => {
    if (typeof rate === 'number') return rate;
    const n = Number(rate);
    return Number.isFinite(n) ? n : 0;
};

const formatCurrency = (value: any) => {
    const num = parseFloat(value);
    if(isNaN(num)) return 'N/A';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(num);
}

export function CustomAssemblyDialog({ isOpen, onOpenChange, onConfirm, boqItems }: CustomAssemblyDialogProps) {
  const { toast } = useToast();
  const [mainItemName, setMainItemName] = useState('');
  const [mainItemUnit, setMainItemUnit] = useState('');
  const [mainItemRate, setMainItemRate] = useState(0);
  const [mainItemQty, setMainItemQty] = useState(1);
  const [selectedBoqIds, setSelectedBoqIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  
  const [sortKey, setSortKey] = useState<'erpSlNo' | 'boqSlNo' | 'description' | 'qty' | 'rate'>('erpSlNo');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const filteredAndSortedBoqItems = useMemo(() => {
    let items = boqItems.filter(item => {
      const lowercasedFilter = searchTerm.toLowerCase();
      return (
        getItemDescription(item).toLowerCase().includes(lowercasedFilter) ||
        getSlNo(item).toLowerCase().includes(lowercasedFilter) ||
        getErpSlNo(item).toLowerCase().includes(lowercasedFilter)
      );
    });

    const dir = sortDirection === 'asc' ? 1 : -1;
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

    items.sort((a, b) => {
        let cmp = 0;
        switch (sortKey) {
            case 'erpSlNo': cmp = collator.compare(getErpSlNo(a), getErpSlNo(b)); break;
            case 'boqSlNo': cmp = collator.compare(getSlNo(a), getSlNo(b)); break;
            case 'description': cmp = collator.compare(getItemDescription(a), getItemDescription(b)); break;
            case 'qty': cmp = collator.compare(getBoqQty(a), getBoqQty(b)); break;
            case 'rate':
                const rateKeyA = findRateKey(a);
                const rateKeyB = findRateKey(b);
                const rateA = getRateNumber(rateKeyA ? a[rateKeyA] : 0);
                const rateB = getRateNumber(rateKeyB ? b[rateKeyB] : 0);
                cmp = rateA - rateB;
                break;
            default: break;
        }
        if (cmp === 0) return collator.compare(getErpSlNo(a), getErpSlNo(b));
        return cmp * dir;
    });
    
    return items;

  }, [boqItems, searchTerm, sortKey, sortDirection]);

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

   const toggleSort = (key: 'erpSlNo' | 'boqSlNo' | 'description' | 'qty' | 'rate') => {
    if (sortKey === key) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
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
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-12"><Checkbox /></TableHead>
                                <TableHead>
                                  <Button variant="ghost" size="sm" onClick={() => toggleSort('erpSlNo')}>ERP Sl. No. <ArrowUpDown className="ml-2 h-4 w-4" /></Button>
                                </TableHead>
                                <TableHead>
                                  <Button variant="ghost" size="sm" onClick={() => toggleSort('boqSlNo')}>BOQ Sl.No. <ArrowUpDown className="ml-2 h-4 w-4" /></Button>
                                </TableHead>
                                <TableHead>Description</TableHead>
                                <TableHead className="text-right">
                                  <Button variant="ghost" size="sm" onClick={() => toggleSort('qty')}>BOQ Qty / Unit <ArrowUpDown className="ml-2 h-4 w-4" /></Button>
                                </TableHead>
                                <TableHead className="text-right">
                                  <Button variant="ghost" size="sm" onClick={() => toggleSort('rate')}>Unit Rate <ArrowUpDown className="ml-2 h-4 w-4" /></Button>
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredAndSortedBoqItems.map(item => {
                                const rateKey = findRateKey(item);
                                const rate = rateKey ? (item as any)[rateKey] : '0';
                                return (
                                <TableRow key={item.id} onClick={() => handleSelect(item.id, !selectedBoqIds.has(item.id))} className="cursor-pointer">
                                    <TableCell><Checkbox checked={selectedBoqIds.has(item.id)}/></TableCell>
                                    <TableCell>{getErpSlNo(item)}</TableCell>
                                    <TableCell>{getSlNo(item)}</TableCell>
                                    <TableCell>{getItemDescription(item)}</TableCell>
                                    <TableCell className="text-right">{getBoqQty(item)} {getUnit(item)}</TableCell>
                                    <TableCell className="text-right">{formatCurrency(rate)}</TableCell>
                                </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
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
