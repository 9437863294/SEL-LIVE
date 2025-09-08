
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, doc, writeBatch, serverTimestamp, getDoc } from 'firebase/firestore';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { BillItem, JmcEntry, BoqItem } from '@/lib/types';
import { JmcItemSelectorDialog } from '@/components/JmcItemSelectorDialog';

const initialBillDetails = {
    billNo: '',
    billDate: new Date().toISOString().split('T')[0],
    woNo: '',
};

export default function BillingPage() {
  const { toast } = useToast();
  const [details, setDetails] = useState(initialBillDetails);
  const [items, setItems] = useState<BillItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isSelectorOpen, setIsSelectorOpen] = useState(false);

  const handleDetailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setDetails(prev => ({ ...prev, [name]: value }));
  };
  
  const handleItemChange = (index: number, field: 'billedQty', value: string) => {
      const newItems = [...items];
      const item = newItems[index];
      const billedQty = parseFloat(value);
      const executedQty = parseFloat(item.executedQty);
      
      if(isNaN(billedQty) || billedQty < 0) {
        item.billedQty = '';
        item.totalAmount = '';
        newItems[index] = item;
        setItems(newItems);
        return;
      }
      
      if(billedQty > executedQty) {
          toast({
              title: 'Quantity Exceeded',
              description: `Billed quantity cannot be more than available quantity (${executedQty}).`,
              variant: 'destructive',
          });
          item.billedQty = executedQty.toString();
      } else {
          item.billedQty = value;
      }
      
      const rate = parseFloat(item.rate);
      if(!isNaN(rate) && item.billedQty) {
          item.totalAmount = (parseFloat(item.billedQty) * rate).toFixed(2);
      } else {
          item.totalAmount = '';
      }

      newItems[index] = item;
      setItems(newItems);
  };
  
  const handleItemsAdd = (selectedItems: BillItem[]) => {
      const newItems = [...items];
      selectedItems.forEach(newItem => {
        // Prevent adding the same item from the same JMC twice
        const exists = newItems.some(
            i => i.jmcItemId === newItem.jmcItemId && i.jmcEntryId === newItem.jmcEntryId
        );
        if (!exists) {
            newItems.push(newItem);
        }
      });
      setItems(newItems);
  }

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setIsSaving(true);
    if (!details.billNo || !details.woNo || items.length === 0) {
        toast({
            title: 'Missing Required Fields',
            description: 'Please fill in Bill No, WO No, and add at least one item.',
            variant: 'destructive',
        });
        setIsSaving(false);
        return;
    }
    
    try {
        const billData = {
            ...details,
            items: items.map(item => ({...item, billedQty: parseFloat(item.billedQty)})), // Ensure billedQty is a number
            createdAt: serverTimestamp()
        };
        await addDoc(collection(db, 'bills'), billData);
        toast({
            title: 'Bill Created',
            description: 'The new bill has been successfully saved.',
        });
        setDetails(initialBillDetails);
        setItems([]);
    } catch (error) {
        console.error("Error creating bill: ", error);
        toast({
            title: 'Save Failed',
            description: 'An error occurred while saving the bill.',
            variant: 'destructive',
        });
    } finally {
        setIsSaving(false);
    }
  };
  
  const formatCurrency = (amount: string | number) => {
    const num = parseFloat(String(amount));
    if(isNaN(num)) return amount;
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(num);
  }

  return (
    <>
      <div className="w-full max-w-7xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
              <Link href="/billing-recon/tpsodl">
                  <Button variant="ghost" size="icon">
                      <ArrowLeft className="h-6 w-6" />
                  </Button>
              </Link>
              <h1 className="text-2xl font-bold">Create New Bill</h1>
          </div>
          <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Bill
          </Button>
        </div>

        <Card className="mb-6">
          <CardHeader>
              <CardTitle>Bill Details</CardTitle>
              <CardDescription>Provide the main details for this bill.</CardDescription>
          </CardHeader>
          <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                      <Label htmlFor="billNo">Bill No</Label>
                      <Input id="billNo" name="billNo" value={details.billNo} onChange={handleDetailChange} />
                  </div>
                  <div className="space-y-2">
                      <Label htmlFor="woNo">Work Order No</Label>
                      <Input id="woNo" name="woNo" value={details.woNo} onChange={handleDetailChange} />
                  </div>
                  <div className="space-y-2">
                      <Label htmlFor="billDate">Bill Date</Label>
                      <Input id="billDate" name="billDate" type="date" value={details.billDate} onChange={handleDetailChange} />
                  </div>
              </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
               <div className="flex items-center justify-between">
                  <div>
                      <CardTitle>Bill Items</CardTitle>
                      <CardDescription>Add items from JMC entries to this bill.</CardDescription>
                  </div>
                  <Button variant="outline" onClick={() => setIsSelectorOpen(true)}>
                      <Plus className="mr-2 h-4 w-4" /> Add Items from JMC
                  </Button>
              </div>
          </CardHeader>
          <CardContent>
              <div className="overflow-x-auto">
                  <Table>
                      <TableHeader>
                          <TableRow>
                              <TableHead>JMC No.</TableHead>
                              <TableHead>BOQ Sl. No.</TableHead>
                              <TableHead>Description</TableHead>
                              <TableHead>Unit</TableHead>
                              <TableHead>Rate</TableHead>
                              <TableHead>Available Qty</TableHead>
                              <TableHead>Billed Qty</TableHead>
                              <TableHead>Total Amount</TableHead>
                              <TableHead>Action</TableHead>
                          </TableRow>
                      </TableHeader>
                      <TableBody>
                          {items.map((item, index) => (
                              <TableRow key={item.jmcItemId}>
                                  <TableCell>{item.jmcNo}</TableCell>
                                  <TableCell>{item.boqSlNo}</TableCell>
                                  <TableCell>{item.description}</TableCell>
                                  <TableCell>{item.unit}</TableCell>
                                  <TableCell>{formatCurrency(item.rate)}</TableCell>
                                  <TableCell>{item.executedQty}</TableCell>
                                  <TableCell>
                                      <Input 
                                        type="number" 
                                        value={item.billedQty}
                                        onChange={(e) => handleItemChange(index, 'billedQty', e.target.value)}
                                        max={item.executedQty}
                                      />
                                  </TableCell>
                                  <TableCell>{formatCurrency(item.totalAmount)}</TableCell>
                                  <TableCell>
                                      <Button variant="ghost" size="icon" onClick={() => removeItem(index)}>
                                          <Trash2 className="h-4 w-4 text-destructive" />
                                      </Button>
                                  </TableCell>
                              </TableRow>
                          ))}
                      </TableBody>
                  </Table>
              </div>
          </CardContent>
        </Card>
      </div>
      <JmcItemSelectorDialog
        isOpen={isSelectorOpen}
        onOpenChange={setIsSelectorOpen}
        onConfirm={handleItemsAdd}
        alreadyAddedItems={items}
      />
    </>
  );
}
