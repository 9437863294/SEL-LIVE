
'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, Library } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, doc, query, writeBatch, serverTimestamp, getDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { WorkOrder, Project, Bill, Subcontractor, WorkflowStep, ActionLog } from '@/lib/types';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { getAssigneeForStep, calculateDeadline } from '@/lib/workflow-utils';

const initialDetails = {
    retentionBillNo: '',
    date: new Date().toISOString().split('T')[0],
    subcontractorId: '',
};

const slugify = (text: string) => {
  if (!text) return '';
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

export default function CreateRetentionBillPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const router = useRouter();
  const { project: projectSlug } = useParams() as { project: string };

  const [details, setDetails] = useState(initialDetails);
  const [selectedBillIds, setSelectedBillIds] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([]);
  const [allBills, setAllBills] = useState<Bill[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);

  useEffect(() => {
    const fetchData = async () => {
        if (!projectSlug) return;
        
        const projectsQuery = query(collection(db, 'projects'));
        const projectSnap = await getDocs(projectsQuery);
        const project = projectSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)).find(p => slugify(p.projectName) === projectSlug);

        if (!project) {
            toast({ title: "Error", description: "Project not found.", variant: "destructive" });
            return;
        }
        setCurrentProject(project);

        const subsQuery = query(collection(db, 'projects', project.id, 'subcontractors'));
        const billsQuery = query(collection(db, 'projects', project.id, 'bills'));

        const [subsSnap, billsSnap] = await Promise.all([ getDocs(subsQuery), getDocs(billsQuery) ]);

        setSubcontractors(subsSnap.docs.map(d => ({id: d.id, ...d.data()} as Subcontractor)));
        setAllBills(billsSnap.docs.map(d => ({id: d.id, ...d.data()} as Bill)));
    };
    fetchData();
  }, [projectSlug, toast]);

  const availableBills = useMemo(() => {
    if (!details.subcontractorId) return [];
    return allBills.filter(bill => 
      bill.subcontractorId === details.subcontractorId && 
      (bill.retentionAmount || 0) > 0 && 
      !bill.retentionClaimed
    );
  }, [allBills, details.subcontractorId]);

  const selectedBills = useMemo(() => {
      return availableBills.filter(bill => selectedBillIds.has(bill.id));
  }, [availableBills, selectedBillIds]);

  const totalRetentionAmount = useMemo(() => {
      return selectedBills.reduce((sum, bill) => sum + (bill.retentionAmount || 0), 0);
  }, [selectedBills]);
  
  const handleSelectBill = (billId: string, checked: boolean) => {
      setSelectedBillIds(prev => {
          const newSet = new Set(prev);
          if (checked) {
              newSet.add(billId);
          } else {
              newSet.delete(billId);
          }
          return newSet;
      });
  };

  const handleSave = async () => {
    if (!user || !currentProject || !details.retentionBillNo || selectedBills.length === 0) {
        toast({ title: 'Missing Fields', description: 'Please fill in Bill No, and select at least one bill to claim retention from.', variant: 'destructive'});
        return;
    }
    setIsSaving(true);
    
    try {
        const workflowRef = doc(db, 'workflows', 'billing-workflow');
        const workflowSnap = await getDoc(workflowRef);
        if (!workflowSnap.exists()) throw new Error('Billing workflow not found.');
        
        const steps = (workflowSnap.data().steps || []) as WorkflowStep[];
        if (steps.length === 0) throw new Error('Billing workflow has no steps.');
        const firstStep = steps[0];

        const batch = writeBatch(db);

        const newBillData: Omit<Bill, 'id'> = {
          billNo: details.retentionBillNo,
          billDate: details.date,
          workOrderId: selectedBills[0]?.workOrderId || '',
          workOrderNo: selectedBills[0]?.workOrderNo || '',
          subcontractorId: details.subcontractorId,
          subcontractorName: subcontractors.find(s => s.id === details.subcontractorId)?.legalName || '',
          items: [],
          subtotal: totalRetentionAmount,
          gstType: 'manual',
          gstAmount: 0,
          grossAmount: totalRetentionAmount,
          retentionType: 'manual',
          retentionAmount: 0,
          otherDeduction: 0,
          advanceDeductions: [],
          totalDeductions: 0,
          netPayable: totalRetentionAmount,
          totalAmount: totalRetentionAmount,
          createdAt: serverTimestamp() as Timestamp,
          projectId: currentProject.id,
          status: 'Pending',
          stage: firstStep.name,
          currentStepId: firstStep.id,
          assignees: [],
          history: [],
          isRetentionBill: true,
          claimedBillIds: Array.from(selectedBillIds),
        };
        
        const tempForAssignment = { ...newBillData, amount: newBillData.netPayable };
        const assignees = await getAssigneeForStep(firstStep, tempForAssignment as any);
        if (!assignees || assignees.length === 0) throw new Error(`Could not find assignee for step: ${firstStep.name}`);
        newBillData.assignees = assignees;

        const deadline = await calculateDeadline(new Date(), firstStep.tat);
        (newBillData as any).deadline = Timestamp.fromDate(deadline);

        const initialLog: ActionLog = {
            action: 'Created',
            comment: 'Retention bill created.',
            userId: user.id,
            userName: user.name,
            timestamp: Timestamp.now(),
            stepName: 'Creation',
        };
        newBillData.history = [initialLog];


        const newBillRef = doc(collection(db, 'projects', currentProject.id, 'bills'));
        batch.set(newBillRef, newBillData);
        
        selectedBillIds.forEach(billId => {
            const billRef = doc(db, 'projects', currentProject!.id, 'bills', billId);
            batch.update(billRef, { retentionClaimed: true });
        });
        
        await batch.commit();
        
        toast({ title: 'Retention Bill Created', description: 'The bill has been saved and retention statuses updated.' });
        router.push(`/subcontractors-management/${projectSlug}/billing`);

    } catch (error) {
        console.error("Error creating retention bill: ", error);
        toast({ title: 'Save Failed', description: 'An error occurred while saving the retention bill.', variant: 'destructive' });
    } finally {
        setIsSaving(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
            <Link href={`/subcontractors-management/${projectSlug}/billing`}><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
            <h1 className="text-2xl font-bold">Retention Bill</h1>
        </div>
        <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Retention Bill
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
              <div className="space-y-2">
                  <Label htmlFor="subcontractorId">Subcontractor</Label>
                  <Select value={details.subcontractorId} onValueChange={(v) => { setDetails(p => ({...p, subcontractorId: v})); setSelectedBillIds(new Set()); }}>
                      <SelectTrigger id="subcontractorId"><SelectValue placeholder="Select a Subcontractor" /></SelectTrigger>
                      <SelectContent>
                          {subcontractors.map(sc => <SelectItem key={sc.id} value={sc.id}>{sc.legalName}</SelectItem>)}
                      </SelectContent>
                  </Select>
              </div>
              <div className="space-y-2">
                  <Label htmlFor="retentionBillNo">Retention Bill No</Label>
                  <Input id="retentionBillNo" value={details.retentionBillNo} onChange={(e) => setDetails(p => ({...p, retentionBillNo: e.target.value}))} />
              </div>
              <div className="space-y-2">
                  <Label htmlFor="date">Date</Label>
                  <Input id="date" type="date" value={details.date} onChange={(e) => setDetails(p => ({...p, date: e.target.value}))} />
              </div>
               <div className="space-y-2 pt-4">
                  <Label className="text-base">Total Claim Amount</Label>
                  <p className="text-2xl font-bold">{formatCurrency(totalRetentionAmount)}</p>
               </div>
          </CardContent>
        </Card>
        
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Select Bills to Claim Retention</CardTitle>
            <CardDescription>Only bills with an unclaimed retention amount are shown.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="border rounded-md max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12"></TableHead>
                    <TableHead>Bill No.</TableHead>
                    <TableHead>Bill Date</TableHead>
                    <TableHead className="text-right">Retention Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {availableBills.length > 0 ? availableBills.map(bill => (
                    <TableRow key={bill.id} onClick={() => handleSelectBill(bill.id, !selectedBillIds.has(bill.id))} className="cursor-pointer">
                        <TableCell><Checkbox checked={selectedBillIds.has(bill.id)} /></TableCell>
                        <TableCell>{bill.billNo}</TableCell>
                        <TableCell>{bill.billDate}</TableCell>
                        <TableCell className="text-right">{formatCurrency(bill.retentionAmount || 0)}</TableCell>
                    </TableRow>
                  )) : (
                    <TableRow><TableCell colSpan={4} className="text-center h-24">No bills with retention found for this subcontractor.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
