

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Edit, Trash2, Database, Loader2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, addDoc, deleteDoc, doc, updateDoc, writeBatch } from 'firebase/firestore';
import type { AccountHead, SubAccountHead } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';

const initialAccountData = {
    'Purchase': ['Payment to Supplier', 'Interest to Creditor'],
    'Operating Cost': ['Erection & Fabrication', 'Freight & Transportation', 'Site Expenses', 'Insurance', 'Consultancy Fee', 'Hire Charges', 'Row Compensation Expenses', 'Others Misc. Operating Exp.', 'Allied Material', 'Tender Paper Purchase', 'Other Deduction', 'Testing & Inspection Charges'],
    'Employee Benifit Expenses': ['Staffwelfare & Mess Expenses', 'Salary & Wages', 'Gratuity', 'Director Remuneration', 'PF & ESI'],
    'Finance Costs': ['Bank Commission', 'Bank Interest'],
    'Other Expenses': ['Telephone/ Internet', 'Travelling & Conveyence', 'Repair & Maintenance', 'Loading & Unloading', 'Electricity Charges', 'Vehicle Running & Maintenance', 'House & Office Rent', 'Other Misc. Expenses', 'Office Expenses', 'Audit Expenses', 'Rate & Tax', 'Printing & Stationary', 'Postage & Courier Charges', 'Legal & Proffessional Expenses', 'Security Srvice Charges', 'Cash Expensess', 'Temporary Shed', 'Water Supply/Charges', 'Tools & Implements', 'Fuel & Lubricant', 'Rates & Taxes', 'Oil & Lubricant', 'Corporate Social Responsibility Expenses', 'Survey Expenses', 'Subscription and Renual'],
    'Erection & Fabrication': ['Sub-Contractor Payment', 'Labour Charges', 'Fabrication Charges'],
    'Liability': ['TDS', 'GST', 'Professional Tax', 'Group Insurance', 'GECL Loan', 'Unsecured Loan', 'Vehicle Loan'],
    'CURRENT ASSETS': ['FD', 'INVESTMENT'],
    'AGRO DIVISION': ['AGRO DIVISION'],
    'Indirect Expenses': ['Interest (Invoice Mart)', 'Workmen Compensation'],
    'Fixed Assets': ['Vehicle'],
    'TAXATION': ['INCOME TAX']
};

export default function ManageAccountsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  
  const [heads, setHeads] = useState<AccountHead[]>([]);
  const [subHeads, setSubHeads] = useState<SubAccountHead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSeeding, setIsSeeding] = useState(false);

  // Dialog State
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'addHead' | 'addSubHead' | 'editHead' | 'editSubHead' | null>(null);
  const [currentHead, setCurrentHead] = useState<AccountHead | null>(null);
  const [currentSubHead, setCurrentSubHead] = useState<SubAccountHead | null>(null);
  const [name, setName] = useState('');
  const [selectedHeadId, setSelectedHeadId] = useState('');

  const canViewPage = can('Manage Accounts', 'Expenses.Settings');
  
  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [headsSnap, subHeadsSnap] = await Promise.all([
        getDocs(collection(db, 'accountHeads')),
        getDocs(collection(db, 'subAccountHeads'))
      ]);
      const headsData = headsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as AccountHead)).sort((a,b) => a.name.localeCompare(b.name));
      const subHeadsData = subHeadsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as SubAccountHead));
      setHeads(headsData);
      setSubHeads(subHeadsData);
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to fetch account data.', variant: 'destructive' });
    }
    setIsLoading(false);
  };
  
  useEffect(() => {
    if(!isAuthLoading) {
        if(canViewPage) {
            fetchData();
        } else {
            setIsLoading(false);
        }
    }
  }, [isAuthLoading, canViewPage]);

  const openDialog = (mode: 'addHead' | 'addSubHead' | 'editHead' | 'editSubHead', head?: AccountHead, subHead?: SubAccountHead) => {
    setDialogMode(mode);
    if (mode === 'addHead') {
        setName('');
    } else if (mode === 'addSubHead' && head) {
        setCurrentHead(head);
        setSelectedHeadId(head.id);
        setName('');
    } else if (mode === 'editHead' && head) {
        setCurrentHead(head);
        setName(head.name);
    } else if (mode === 'editSubHead' && subHead) {
        setCurrentSubHead(subHead);
        setSelectedHeadId(subHead.headId);
        setName(subHead.name);
    }
    setIsDialogOpen(true);
  };

  const handleDialogSubmit = async () => {
    if (!name.trim()) {
      toast({ title: 'Validation Error', description: 'Name cannot be empty.', variant: 'destructive' });
      return;
    }
    if (!user) return;
    try {
      let action = '';
      let details: Record<string, any> = {};

      switch (dialogMode) {
        case 'addHead':
          await addDoc(collection(db, 'accountHeads'), { name });
          action = 'Add Account Head';
          details = { headName: name };
          break;
        case 'addSubHead':
          if (!selectedHeadId) return;
          await addDoc(collection(db, 'subAccountHeads'), { name, headId: selectedHeadId });
          action = 'Add Sub-Account Head';
          details = { subHeadName: name, parentHeadId: selectedHeadId };
          break;
        case 'editHead':
          if (!currentHead) return;
          await updateDoc(doc(db, 'accountHeads', currentHead.id), { name });
          action = 'Edit Account Head';
          details = { headId: currentHead.id, newName: name, oldName: currentHead.name };
          break;
        case 'editSubHead':
          if (!currentSubHead) return;
          await updateDoc(doc(db, 'subAccountHeads', currentSubHead.id), { name, headId: selectedHeadId });
          action = 'Edit Sub-Account Head';
          details = { subHeadId: currentSubHead.id, newName: name, oldName: currentSubHead.name };
          break;
      }
      await logUserActivity({ userId: user.id, action, details });
      toast({ title: 'Success', description: 'Account data saved successfully.' });
      fetchData();
      setIsDialogOpen(false);
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to save data.', variant: 'destructive' });
    }
  };

  const handleDelete = async (type: 'head' | 'subhead', id: string, itemName: string) => {
    if (!user) return;
    try {
      if (type === 'head') {
        await deleteDoc(doc(db, 'accountHeads', id));
      } else {
        await deleteDoc(doc(db, 'subAccountHeads', id));
      }
      await logUserActivity({ userId: user.id, action: `Delete ${type === 'head' ? 'Account Head' : 'Sub-Account Head'}`, details: { id, name: itemName }});
      toast({ title: 'Success', description: 'Item deleted.' });
      fetchData();
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to delete item.', variant: 'destructive' });
    }
  };
  
  const handleSeedData = async () => {
    if (!user) return;
    setIsSeeding(true);
    const batch = writeBatch(db);
    
    try {
      for (const headName of Object.keys(initialAccountData)) {
          const headRef = doc(collection(db, 'accountHeads'));
          batch.set(headRef, { name: headName });
          
          const subHeadsList = initialAccountData[headName as keyof typeof initialAccountData];
          for (const subHeadName of subHeadsList) {
              const subHeadRef = doc(collection(db, 'subAccountHeads'));
              batch.set(subHeadRef, { name: subHeadName, headId: headRef.id });
          }
      }
      await batch.commit();

      await logUserActivity({ userId: user.id, action: 'Seed Account Data', details: {} });

      toast({ title: 'Success', description: 'Initial account data has been seeded.' });
      fetchData();
    } catch (error) {
        console.error("Seeding error:", error);
        toast({ title: 'Seeding Failed', description: 'An error occurred while seeding data.', variant: 'destructive' });
    } finally {
        setIsSeeding(false);
    }
  };

  const dialogTitleByMode: Record<NonNullable<typeof dialogMode>, string> = {
    addHead: 'Add New Head of A/c',
    addSubHead: `Add Sub-Head to ${currentHead?.name || ''}`,
    editHead: `Edit Head: ${currentHead?.name || ''}`,
    editSubHead: `Edit Sub-Head: ${currentSubHead?.name || ''}`,
  };
  const dialogTitle = dialogMode ? dialogTitleByMode[dialogMode] : '';

  if(isAuthLoading || (isLoading && canViewPage)) {
    return (
        <div className="w-full max-w-4xl mx-auto">
            <Skeleton className="h-10 w-80 mb-6" />
            <Skeleton className="h-96 w-full" />
        </div>
    )
  }

  if(!canViewPage) {
    return (
        <div className="w-full max-w-4xl mx-auto">
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Link href="/expenses/settings"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
                <h1 className="text-2xl font-bold">Manage Accounts</h1>
              </div>
            </div>
            <Card>
                <CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to view this page.</CardDescription></CardHeader>
                <CardContent className="flex justify-center p-8"><ShieldAlert className="h-16 w-16 text-destructive" /></CardContent>
            </Card>
        </div>
    )
  }

  return (
    <>
      <div className="w-full max-w-4xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/expenses/settings">
              <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
            </Link>
            <h1 className="text-2xl font-bold">Manage Accounts</h1>
          </div>
          <Button onClick={() => openDialog('addHead')}>
            <Plus className="mr-2 h-4 w-4" /> Add Head of A/c
          </Button>
        </div>

        {isLoading ? (
            <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
            </div>
        ) : heads.length === 0 ? (
            <Card className="text-center py-12">
                <CardContent>
                    <Database className="mx-auto h-12 w-12 text-muted-foreground" />
                    <h3 className="mt-4 text-lg font-medium">No Account Data Found</h3>
                    <p className="mt-1 text-sm text-muted-foreground">Get started by seeding the initial chart of accounts.</p>
                    <div className="mt-6">
                        <Button onClick={handleSeedData} disabled={isSeeding}>
                            {isSeeding ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Database className="mr-2 h-4 w-4"/>}
                            Seed Initial Data
                        </Button>
                    </div>
                </CardContent>
            </Card>
        ) : (
            <Accordion type="single" collapsible className="w-full">
              {heads.map(head => {
                const filteredSubHeads = subHeads.filter(sh => sh.headId === head.id).sort((a,b) => a.name.localeCompare(b.name));
                return (
                  <AccordionItem value={head.id} key={head.id}>
                    <AccordionTrigger className="text-lg font-semibold hover:no-underline">
                        <div className="flex items-center gap-4">
                            <span>{head.name}</span>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); openDialog('editHead', head); }}>
                                <Edit className="h-4 w-4" />
                            </Button>
                        </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <Card>
                        <CardContent className="p-0">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Sub-Head Name</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {filteredSubHeads.map(subHead => (
                                <TableRow key={subHead.id}>
                                  <TableCell>{subHead.name}</TableCell>
                                  <TableCell className="text-right">
                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openDialog('editSubHead', undefined, subHead)}>
                                      <Edit className="h-4 w-4" />
                                    </Button>
                                    <AlertDialog>
                                      <AlertDialogTrigger asChild>
                                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive">
                                              <Trash2 className="h-4 w-4" />
                                          </Button>
                                      </AlertDialogTrigger>
                                      <AlertDialogContent>
                                          <AlertDialogHeader>
                                              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                              <AlertDialogDescription>This will permanently delete the sub-head "{subHead.name}".</AlertDialogDescription>
                                          </AlertDialogHeader>
                                          <AlertDialogFooter>
                                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                                              <AlertDialogAction onClick={() => handleDelete('subhead', subHead.id, subHead.name)}>Delete</AlertDialogAction>
                                          </AlertDialogFooter>
                                      </AlertDialogContent>
                                  </AlertDialog>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                          <div className="p-4 border-t">
                            <Button variant="outline" size="sm" onClick={() => openDialog('addSubHead', head)}>
                              <Plus className="mr-2 h-4 w-4" /> Add Sub-Head
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
        )}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{dialogTitle}</DialogTitle></DialogHeader>
          <div className="py-4 space-y-4">
            {dialogMode === 'editSubHead' && (
              <div className="space-y-2">
                <Label htmlFor="head-select">Parent Head of A/c</Label>
                <Select value={selectedHeadId} onValueChange={setSelectedHeadId}>
                    <SelectTrigger id="head-select"><SelectValue/></SelectTrigger>
                    <SelectContent>
                        {heads.map(h => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
                    </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="name-input">Name</Label>
              <Input id="name-input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={handleDialogSubmit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
