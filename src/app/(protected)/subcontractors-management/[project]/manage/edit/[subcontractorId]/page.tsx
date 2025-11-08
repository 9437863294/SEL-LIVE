
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, doc, getDoc, updateDoc, getDocs } from 'firebase/firestore';
import type { Subcontractor, ContactPerson, Project } from '@/lib/types';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import { Skeleton } from '@/components/ui/skeleton';

const initialContact: Omit<ContactPerson, 'id'> = { type: 'Project', name: '', title: '', mobile: '', email: '' };

export default function EditSubcontractorPage() {
  const { toast } = useToast();
  const router = useRouter();
  const { user } = useAuth();
  const { project: projectSlug, subcontractorId } = useParams() as { project: string, subcontractorId: string };
  const [formData, setFormData] = useState<Subcontractor | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);

  useEffect(() => {
    const fetchSubcontractor = async () => {
      if (!projectSlug || !subcontractorId) return;
      setIsLoading(true);
      try {
        const projectsQuery = collection(db, 'projects');
        const projectsSnapshot = await getDocs(projectsQuery);
        const slugify = (text: string) => text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');
        const projectData = projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)).find(p => slugify(p.projectName) === projectSlug);

        if (!projectData) {
            toast({ title: "Error", description: "Project not found.", variant: "destructive" });
            return;
        }
        setCurrentProject(projectData);
        
        const subDocRef = doc(db, 'projects', projectData.id, 'subcontractors', subcontractorId);
        const subDocSnap = await getDoc(subDocRef);
        if (subDocSnap.exists()) {
          const data = { id: subDocSnap.id, ...subDocSnap.data() } as Subcontractor;
          // Ensure contacts have unique client-side IDs
          const contactsWithIds = (data.contacts || []).map(c => ({...c, id: c.id || crypto.randomUUID()}));
          setFormData({...data, contacts: contactsWithIds});
        } else {
          toast({ title: 'Error', description: 'Subcontractor not found.', variant: 'destructive' });
          router.push(`/subcontractors-management/${projectSlug}/manage`);
        }
      } catch (e) {
        console.error("Error fetching subcontractor:", e);
        toast({ title: 'Error', description: 'Failed to load subcontractor details.', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    }
    fetchSubcontractor();
  }, [projectSlug, subcontractorId, router, toast]);

  const handleFormChange = (field: keyof Omit<Subcontractor, 'id' | 'attachments' | 'contacts'>, value: string) => {
    setFormData(prev => prev ? ({ ...prev, [field]: value }) : null);
  };
  
  const handleContactChange = (index: number, field: keyof Omit<ContactPerson, 'id'>, value: string) => {
    if (!formData) return;
    const newContacts = [...formData.contacts];
    newContacts[index] = { ...newContacts[index], [field]: value };
    setFormData(prev => prev ? ({ ...prev, contacts: newContacts }) : null);
  };

  const addContact = () => {
    if (!formData) return;
    setFormData(prev => prev ? ({ ...prev, contacts: [...prev.contacts, { ...initialContact, id: crypto.randomUUID() }] }) : null);
  };

  const removeContact = (id: string) => {
    if (!formData || formData.contacts.length <= 1) {
      toast({ title: "Cannot Remove", description: "At least one contact person is required.", variant: "destructive" });
      return;
    }
    setFormData(prev => prev ? ({ ...prev, contacts: prev.contacts.filter(c => c.id !== id) }) : null);
  };
  
  const handleUpdate = async () => {
    if (!formData || !formData.legalName.trim() || !currentProject || !user) {
      toast({ title: 'Validation Error', description: 'Legal Business Name is required.', variant: 'destructive' });
      return;
    }
    setIsSaving(true);
    try {
      const subRef = doc(db, 'projects', currentProject.id, 'subcontractors', formData.id);
      const { id, ...dataToUpdate } = {
        ...formData,
        contacts: formData.contacts.map(({ id: contactId, ...rest }) => rest), // Remove client-side ID
      };
      await updateDoc(subRef, dataToUpdate);

      toast({ title: 'Success', description: 'Subcontractor updated.' });
      router.push(`/subcontractors-management/${projectSlug}/manage`);
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to update subcontractor.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };
  
  if (isLoading || !formData) {
    return (
        <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <Skeleton className="h-10 w-64 mb-6" />
            <Skeleton className="h-[500px]" />
        </div>
    )
  }

  return (
    <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
            <Link href={`/subcontractors-management/${projectSlug}/manage`}><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
            <h1 className="text-2xl font-bold">Edit Subcontractor</h1>
        </div>
        <Button onClick={handleUpdate} disabled={isSaving}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save Changes
        </Button>
      </div>

      <div className="space-y-6">
        <Accordion type="multiple" defaultValue={['item-1', 'item-2', 'item-3']} className="w-full">
            <AccordionItem value="item-1">
                <AccordionTrigger className="font-semibold text-lg">1. Company & Business Details</AccordionTrigger>
                <AccordionContent asChild>
                    <Card><CardContent className="pt-6 space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1"><Label>Legal Business Name</Label><Input value={formData.legalName} onChange={e => handleFormChange('legalName', e.target.value)} /></div>
                            <div className="space-y-1"><Label>DBA Name</Label><Input value={formData.dbaName} onChange={e => handleFormChange('dbaName', e.target.value)} /></div>
                        </div>
                        <div className="space-y-1"><Label>Registered Address</Label><Input value={formData.registeredAddress} onChange={e => handleFormChange('registeredAddress', e.target.value)} /></div>
                        <div className="space-y-1"><Label>Operating Address</Label><Input value={formData.operatingAddress} onChange={e => handleFormChange('operatingAddress', e.target.value)} /></div>
                    </CardContent></Card>
                </AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-2">
                <AccordionTrigger className="font-semibold text-lg">2. Financial & Tax Details</AccordionTrigger>
                <AccordionContent asChild>
                    <Card><CardContent className="pt-6 space-y-4">
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
                    </CardContent></Card>
                </AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-3">
                <AccordionTrigger className="font-semibold text-lg">3. Key Contact Personnel</AccordionTrigger>
                <AccordionContent asChild>
                    <Card><CardContent className="pt-6 space-y-4">
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
                    </CardContent></Card>
                </AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-4">
                <AccordionTrigger className="font-semibold text-lg">4. Status</AccordionTrigger>
                <AccordionContent asChild>
                    <Card><CardContent className="pt-6">
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
                    </CardContent></Card>
                </AccordionContent>
            </AccordionItem>
        </Accordion>
      </div>
    </div>
  );
}
