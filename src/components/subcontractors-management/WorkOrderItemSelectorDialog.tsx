// /src/app/(protected)/billing-recon/[project]/billing/create/page.tsx
'use client';

import { useState, useEffect, useMemo, Fragment, useId } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, Plus, Trash2, Library, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import {
  collection,
  addDoc,
  getDocs,
  doc,
  query,
  serverTimestamp,
  getDoc,
  Timestamp,
  collectionGroup,
} from 'firebase/firestore';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type {
  WorkOrderItem,
  JmcEntry,
  Project,
  Bill,
  ProformaBill,
  WorkflowStep,
  ActionLog,
  Subcontractor,
  SubItem,
  BillItem,
} from '@/lib/types';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { getAssigneeForStep, calculateDeadline } from '@/lib/workflow-utils';

const slugify = (text: string) => {
  if (!text) return '';
  return text
    .toString()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
};

const toNumber = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const nanoid = () => {
  try {
    // @ts-ignore
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return (crypto as any).randomUUID();
  } catch (e) { /* ignore */ }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
};

type EnrichedSubItem = SubItem & {
  id: string;
  billedQty: string;
  totalAmount: string;
  rate: string; // UI uses strings
  quantity: string;
  jmcCertifiedQty: number;
  alreadyBilledQty: number;
  availableQty: number;
};

type EnrichedBillItem = Omit<BillItem, 'rate' | 'totalAmount' | 'billedQty' | 'executedQty' | 'subItems' | 'orderQty'> & {
  id: string;
  isBreakdown: boolean;
  orderQty: number;
  jmcCertifiedQty: number;
  alreadyBilledQty: number;
  availableQty: number;
  billedQty: string;
  totalAmount: string;
  rate: string;
  executedQty: string;
  subItems: EnrichedSubItem[];
  boqItemId?: string;
  boqSlNo?: string;
};

type AdvanceDeductionItem = {
  id: string;
  reference: string; // proforma id
  deductionType: 'amount' | 'percentage';
  deductionValue: number;
  amount: number;
};

interface WorkOrderItemSelectorDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  workOrder: { items: WorkOrderItem[] } | null;
  onConfirm: (selectedItems: WorkOrderItem[]) => void;
  alreadyAddedItems?: WorkOrderItem[];
}

export default function WorkOrderItemSelectorDialog({
  isOpen,
  onOpenChange,
  workOrder,
  onConfirm,
  alreadyAddedItems = [],
}: WorkOrderItemSelectorDialogProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isOpen) {
      setSelectedIds(new Set());
    }
  }, [isOpen]);

  const availableItems = useMemo(() => {
    if (!workOrder) return [];
    const addedIds = new Set(alreadyAddedItems.map(item => item.id));
    return workOrder.items.filter(item => !addedIds.has(item.id));
  }, [workOrder, alreadyAddedItems]);

  const handleSelect = (itemId: string, checked: boolean) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (checked) {
        newSet.add(itemId);
      } else {
        newSet.delete(itemId);
      }
      return newSet;
    });
  };

  const handleConfirm = () => {
    const selected = workOrder?.items.filter(item => selectedIds.has(item.id)) || [];
    onConfirm(selected);
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Select Work Order Items</DialogTitle>
          <DialogDescription>Select items to add to the bill. Already added items are not shown.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12"></TableHead>
                <TableHead>BOQ Sl. No.</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Order Qty</TableHead>
                <TableHead>Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {availableItems.map(item => (
                <TableRow key={item.id} onClick={() => handleSelect(item.id, !selectedIds.has(item.id))} className="cursor-pointer">
                  <TableCell>
                    <Checkbox checked={selectedIds.has(item.id)} />
                  </TableCell>
                  <TableCell>{item.boqSlNo}</TableCell>
                  <TableCell>{item.description}</TableCell>
                  <TableCell>{item.orderQty}</TableCell>
                  <TableCell>{new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(item.rate)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={selectedIds.size === 0}>
            Add {selectedIds.size} Selected Item(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}