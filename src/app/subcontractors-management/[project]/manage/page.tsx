
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Edit, Trash2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc, query, where } from 'firebase/firestore';
import type { Subcontractor, Project, ContactPerson } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from '@/components/ui/badge';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useParams } from 'next/navigation';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const initialContact: Omit<ContactPerson, 'id'> = { type: 'Project', name: '', title: '', mobile: '', email: '' };

const initialFormState: Omit<Subcontractor, 'id' | 'attachments'> = {
  status: 'Active',
  legalName: '',
  dbaName: '',
  registeredAddress: '',
  operatingAddress: '',
  gstNumber: '',
  panNumber: '',
  bankName: '',
  bankBranch: '',
  accountNumber: '',
  ifscCode: '',
  contacts: [{...initialContact, id: crypto.randomUUID() }],
};

export default function ManageSubcontractorsPage() {
  const { toast } = useToast();
  const params = useParams();
  const projectSlug = params.project as string;
  const { can, isLoading: authLoading } = useAuthorization();

  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'add' | 'edit'>('add');
  const [formData, setFormData] = useState<Omit<Subcontractor, 'id' | 'attachments'>>(initialFormState);
  const [editingId, setEditingId] = useState<string | null>(null);

  const canViewPage = can('View', 'Subcontractors Management.Manage Subcontractors');
  const canAdd = can('Add', 'Subcontractors Management.Manage Subcontractors');
  const canEdit = can('Edit', 'Subcontractors Management.Manage Subcontractors');
  const canDelete = can('Delete', 'Subcontractors Management.Manage Subcontractors');

  const fetchData = async () => {
    if (!projectSlug) return;
    setIsLoading(true);
    try {
      const projectsQuery = query(collection(db, 'projects'));
      const projectsSnapshot = await getDocs(projectsQuery);
      const slugify = (text: string) => text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');
      const project = projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)).find(p => slugify(p.projectName) === projectSlug);

      if (!project) {
        toast({ title: "Project not found", variant: "destructive" });
        return;
      }
      setCurrentProject(project);

      const subsSnap = await getDocs(collection(db, 'projects', project.id, 'subcontractors'));
      const data = subsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Subcontractor));
      setSubcontractors(data);
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to fetch data.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && canViewPage) {
      fetchData();
    } else if (!authLoading) {
      setIsLoading(false);
    }
  }, [authLoading, canViewPage, projectSlug]);

  const openDialog = (mode: 'add' | 'edit', sub?: Subcontractor) => {
    setDialogMode(mode);
    if (mode === 'edit' && sub) {
        const { id, attachments, ...dataToEdit } = sub;
        const contactsWithIds = (dataToEdit.contacts || []).map(c => ({...c, id: c.id || crypto.randomUUID()}));
        setFormData({ ...initialFormState, ...dataToEdit, contacts: contactsWithIds.length > 0 ? contactsWithIds : [{...initialContact, id: crypto.randomUUID()}] });
        setEditingId(sub.id);
    } else {
        setFormData({...initialFormState, contacts: [{...initialContact, id: crypto.randomUUID() }]});
        setEditingId(null);
    }
    setIsDialogOpen(true);
  };
  
  const handleFormChange = (field: keyof Omit<Subcontractor, 'id'|'attachments'|'contacts'>, value: string) => {
    setFormData(prev => ({...prev, [field]: value}));
  };

  const handleContactChange = (index: number, field: keyof Omit<ContactPerson, 'id'>, value: string) => {
      const newContacts = [...formData.contacts];
      newContacts[index] = {...newContacts[index], [field]: value};
      setFormData(prev => ({ ...prev, contacts: newContacts }));
  };
  
  const addContact = () => {
      setFormData(prev => ({...prev, contacts: [...prev.contacts, {...initialContact, id: crypto.randomUUID()}]}));
  }

  const removeContact = (id: string) => {
      if (formData.contacts.length <= 1) {
          toast({ title: "Cannot Remove", description: "At least one contact person is required.", variant: "destructive"});
          return;
      }
      setFormData(prev => ({...prev, contacts: prev.contacts.filter(c => c.id !== id)}));
  }

  const handleSubmit = async () => {
    if (!currentProject || !formData.legalName.trim()) {
      toast({ title: 'Validation Error', description: 'Legal Business Name is required.', variant: 'destructive' });
      return;
    }
    
    try {
      const subsCollection = collection(db, 'projects', currentProject.id, 'subcontractors');
      const dataToSave = {...formData, contacts: formData.contacts.map(({id, ...rest}) => rest)};

      if (dialogMode === 'edit' && editingId) {
        await updateDoc(doc(subsCollection, editingId), dataToSave);
        toast({ title: 'Success', description: 'Subcontractor updated.' });
      } else {
        await addDoc(subsCollection, dataToSave);
        toast({ title: 'Success', description: 'New subcontractor added.' });
      }
      setIsDialogOpen(false);
      fetchData();
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to save data.', variant: 'destructive' });
    }
  };
  
  const handleDelete = async (id: string) => {
    if (!currentProject) return;
    try {
      await deleteDoc(doc(db, 'projects', currentProject.id, 'subcontractors', id));
      toast({ title: 'Success', description: 'Subcontractor deleted.'});
      fetchData();
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to delete subcontractor.', variant: 'destructive'});
    }
  };
  
  const getPrimaryContact = (sub: Subcontractor) => {
      const projContact = sub.contacts?.find(c => c.type === 'Project');
      return projContact || sub.contacts?.[0] || { name: 'N/A', mobile: 'N/A' };
  }

  if (authLoading || (isLoading && canViewPage)) {
    return <div className="w-full px-4 sm:px-6 lg:px-8"><Skeleton className="h-96" /></div>;
  }

  if (!canViewPage) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
          <div className="mb-6 flex items-center gap-2">
              <Link href={`/subcontractors-management/${projectSlug}`}><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
              <h1 className="text-xl font-bold">Manage Subcontractors</h1>
          </div>
          <Card>
              <CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to view this page.</CardDescription></CardHeader>
              <CardContent className="flex justify-center p-8"><ShieldAlert className="h-16 w-16 text-destructive" /></CardContent>
          </Card>
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
            <Link href={`/subcontractors-management/${projectSlug}`}><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
            <h1 className="text-2xl font-bold">Manage Subcontractors</h1>
        </div>
        <Button onClick={() => openDialog('add')} disabled={!canAdd}><Plus className="mr-2 h-4 w-4"/> Add Subcontractor</Button>
      </div>
      
       <Card>
          <CardContent className="p-0">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Legal Name</TableHead>
                        <TableHead>DBA Name</TableHead>
                        <TableHead>Primary Contact</TableHead>
                        <TableHead>GST No.</TableHead>
                        <TableHead>PAN No.</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {isLoading ? (
                        Array.from({ length: 3 }).map((_, i) => (
                            <TableRow key={i}><TableCell colSpan={7}><Skeleton className="h-8" /></TableCell></TableRow>
                        ))
                    ) : subcontractors.length > 0 ? (
                        subcontractors.map(sub => {
                            const primaryContact = getPrimaryContact(sub);
                            return (
                                <TableRow key={sub.id}>
                                    <TableCell className="font-medium">{sub.legalName}</TableCell>
                                    <TableCell>{sub.dbaName || 'N/A'}</TableCell>
                                    <TableCell>{primaryContact.name} ({primaryContact.mobile})</TableCell>
                                    <TableCell>{sub.gstNumber || 'N/A'}</TableCell>
                                    <TableCell>{sub.panNumber || 'N/A'}</TableCell>
                                    <TableCell><Badge variant={sub.status === 'Active' ? 'default' : 'secondary'}>{sub.status}</Badge></TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="outline" size="sm" onClick={() => openDialog('edit', sub)} disabled={!canEdit}><Edit className="mr-2 h-4 w-4" />Edit</Button>
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button variant="destructive" size="sm" className="ml-2" disabled={!canDelete}><Trash2 className="mr-2 h-4 w-4" />Delete</Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This will permanently delete "{sub.legalName}".</AlertDialogDescription></AlertDialogHeader>
                                                <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleDelete(sub.id)}>Delete</AlertDialogAction></AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </TableCell>
                                </TableRow>
                            )
                        })
                    ) : (
                        <TableRow>
                            <TableCell colSpan={7} className="text-center h-24">No subcontractors found for this project.</TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
          </CardContent>
       </Card>
      
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>{dialogMode === 'add' ? 'Add New' : 'Edit'} Subcontractor</DialogTitle></DialogHeader>
          <ScrollArea className="max-h-[70vh] pr-6">
            <div className="py-4 space-y-6">
              <Accordion type="multiple" defaultValue={['item-1', 'item-2', 'item-3']} className="w-full">
                <AccordionItem value="item-1">
                  <AccordionTrigger className="font-semibold">1. Company & Business Details</AccordionTrigger>
                  <AccordionContent className="space-y-4 pt-2">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1"><Label>Legal Business Name</Label><Input value={formData.legalName} onChange={e => handleFormChange('legalName', e.target.value)} /></div>
                      <div className="space-y-1"><Label>DBA Name</Label><Input value={formData.dbaName} onChange={e => handleFormChange('dbaName', e.target.value)} /></div>
                    </div>
                    <div className="space-y-1"><Label>Registered Address</Label><Input value={formData.registeredAddress} onChange={e => handleFormChange('registeredAddress', e.target.value)} /></div>
                    <div className="space-y-1"><Label>Operating Address</Label><Input value={formData.operatingAddress} onChange={e => handleFormChange('operatingAddress', e.target.value)} /></div>
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="item-2">
                  <AccordionTrigger className="font-semibold">2. Financial & Tax Details</AccordionTrigger>
                  <AccordionContent className="space-y-4 pt-2">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1"><Label>GST Number</Label><Input value={formData.gstNumber} onChange={e => handleFormChange('gstNumber', e.target.value)} /></div>
                      <div className="space-y-1"><Label>PAN Number</Label><Input value={formData.panNumber} onChange={e => handleFormChange('panNumber', e.target.value)} /></div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1"><Label>Bank Name</Label><Input value={formData.bankName} onChange={e => handleFormChange('bankName', e.target.value)} /></div>
                      <div className="space-y-1"><Label>Bank Branch</Label><Input value={formData.bankBranch} onChange={e => handleFormChange('bankBranch', e.target.value)} /></div>
                      <div className="space-y-1"><Label>Account Number</Label><Input value={formData.accountNumber} onChange={e => handleFormChange('accountNumber', e.target.value)} /></div>
                      <div className="space-y-1"><Label>IFSC Code</Label><Input value={formData.ifscCode} onChange={e => handleFormChange('ifscCode', e.target.value)} /></div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="item-3">
                  <AccordionTrigger className="font-semibold">3. Key Contact Personnel</AccordionTrigger>
                  <AccordionContent className="space-y-4 pt-2">
                    {formData.contacts.map((contact, index) => (
                      <div key={contact.id} className="p-4 border rounded-lg space-y-4 relative">
                        {formData.contacts.length > 1 && (
                          <Button variant="ghost" size="icon" className="absolute top-2 right-2 h-6 w-6" onClick={() => removeContact(contact.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            <div className="space-y-1"><Label>Contact Type</Label><Input value={contact.type} onChange={e => handleContactChange(index, 'type', e.target.value)} placeholder="e.g., Project, Billing"/></div>
                            <div className="space-y-1"><Label>Name</Label><Input value={contact.name} onChange={e => handleContactChange(index, 'name', e.target.value)} /></div>
                            <div className="space-y-1"><Label>Job Title</Label><Input value={contact.title} onChange={e => handleContactChange(index, 'title', e.target.value)} /></div>
                            <div className="space-y-1"><Label>Mobile</Label><Input value={contact.mobile} onChange={e => handleContactChange(index, 'mobile', e.target.value)} /></div>
                            <div className="space-y-1 lg:col-span-2"><Label>Email</Label><Input type="email" value={contact.email} onChange={e => handleContactChange(index, 'email', e.target.value)} /></div>
                        </div>
                      </div>
                    ))}
                    <Button variant="outline" size="sm" onClick={addContact}><Plus className="mr-2 h-4 w-4"/>Add Another Contact</Button>
                  </AccordionContent>
                </AccordionItem>
                 <AccordionItem value="item-4">
                  <AccordionTrigger className="font-semibold">4. Status</AccordionTrigger>
                  <AccordionContent className="space-y-4 pt-2">
                    <div className="space-y-2">
                      <Label>Status</Label>
                      <Select value={formData.status} onValueChange={(value: 'Active' | 'Inactive') => handleFormChange('status', value)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                              <SelectItem value="Active">Active</SelectItem>
                              <SelectItem value="Inactive">Inactive</SelectItem>
                          </SelectContent>
                      </Select>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </ScrollArea>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="button" onClick={handleSubmit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

    