
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save, Loader2, Upload, File as FileIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { db, storage } from '@/lib/firebase';
import { collection, addDoc, getDocs, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import type { LcEntry, Project } from '@/lib/types';

const initialFormState = {
  vendor: '',
  projectId: '',
  bank: '',
  lcNo: '',
  lcAmount: 0,
  selCalculation: 0,
  bankCalculation: 0,
  fdMargin: 0,
};

export default function NewLcPage() {
  const { toast } = useToast();
  const router = useRouter();
  const [formState, setFormState] = useState(initialFormState);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  
  const [poFile, setPoFile] = useState<File | null>(null);
  const [appFile, setAppFile] = useState<File | null>(null);
  const [lcCopyFile, setLcCopyFile] = useState<File | null>(null);

  useEffect(() => {
    const fetchProjects = async () => {
      const projectsSnapshot = await getDocs(collection(db, 'projects'));
      setProjects(projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
    };
    fetchProjects();
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormState(prev => ({ ...prev, [name]: name.endsWith('Amount') || name.endsWith('Calculation') || name.endsWith('Margin') ? parseFloat(value) || 0 : value }));
  };

  const handleSave = async () => {
    if (!formState.vendor || !formState.projectId || !formState.lcNo) {
      toast({ title: 'Validation Error', description: 'Vendor, Project, and LC No. are required.', variant: 'destructive' });
      return;
    }
    setIsSaving(true);
    try {
      const uploadFile = async (file: File | null, type: string): Promise<string | undefined> => {
        if (!file) return undefined;
        const storageRef = ref(storage, `lc-documents/${formState.lcNo}/${type}-${file.name}`);
        await uploadBytes(storageRef, file);
        return getDownloadURL(storageRef);
      };

      const [poUrl, applicationUrl, lcCopyUrl] = await Promise.all([
        uploadFile(poFile, 'po'),
        uploadFile(appFile, 'application'),
        uploadFile(lcCopyFile, 'lc-copy'),
      ]);

      const newLcData: Omit<LcEntry, 'id'> = {
        ...formState,
        difference: formState.selCalculation - formState.bankCalculation,
        status: 'Opened',
        createdAt: serverTimestamp(),
        poUrl,
        applicationUrl,
        lcCopyUrl,
      };

      await addDoc(collection(db, 'lcs'), newLcData);
      toast({ title: 'Success', description: 'New LC has been opened successfully.' });
      router.push('/lc-module');
    } catch (error) {
      console.error("Error creating LC:", error);
      toast({ title: 'Save Failed', description: 'An error occurred while opening the LC.', variant: 'destructive' });
    }
    setIsSaving(false);
  };

  const FileUpload = ({ label, onFileChange }: { label: string, onFileChange: (file: File | null) => void }) => (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input type="file" className="file:text-primary file:font-semibold" onChange={(e) => onFileChange(e.target.files ? e.target.files[0] : null)} />
    </div>
  );

  return (
    <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/lc-module"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
          <h1 className="text-xl font-bold">Open New Letter of Credit</h1>
        </div>
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save LC
        </Button>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Vendor & Project Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="vendor">Vendor</Label>
            <Input id="vendor" name="vendor" value={formState.vendor} onChange={handleInputChange} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="projectId">Project</Label>
            <Select name="projectId" value={formState.projectId} onValueChange={(v) => setFormState(p => ({...p, projectId: v}))}>
              <SelectTrigger id="projectId"><SelectValue placeholder="Select a project" /></SelectTrigger>
              <SelectContent>
                {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>LC Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="space-y-2">
                <Label htmlFor="bank">Bank</Label>
                <Input id="bank" name="bank" value={formState.bank} onChange={handleInputChange} />
            </div>
            <div className="space-y-2">
                <Label htmlFor="lcNo">LC No.</Label>
                <Input id="lcNo" name="lcNo" value={formState.lcNo} onChange={handleInputChange} />
            </div>
            <div className="space-y-2">
                <Label htmlFor="lcAmount">LC Amount</Label>
                <Input id="lcAmount" name="lcAmount" type="number" value={formState.lcAmount || ''} onChange={handleInputChange} />
            </div>
            <div className="space-y-2">
                <Label htmlFor="selCalculation">SEL vs Bank Calc.</Label>
                <Input id="selCalculation" name="selCalculation" type="number" value={formState.selCalculation || ''} onChange={handleInputChange} />
            </div>
            <div className="space-y-2">
                <Label htmlFor="bankCalculation">Bank Calculation</Label>
                <Input id="bankCalculation" name="bankCalculation" type="number" value={formState.bankCalculation || ''} onChange={handleInputChange} />
            </div>
            <div className="space-y-2">
                <Label>Difference</Label>
                <Input value={formState.selCalculation - formState.bankCalculation} readOnly />
            </div>
        </CardContent>
      </Card>
      
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>FD Details & Documents</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
                <Label htmlFor="fdMargin">FD Margin Requirement</Label>
                <Input id="fdMargin" name="fdMargin" type="number" value={formState.fdMargin || ''} onChange={handleInputChange} />
            </div>
            <FileUpload label="Purchase Order (PO)" onFileChange={setPoFile} />
            <FileUpload label="LC Application" onFileChange={setAppFile} />
            <FileUpload label="LC Copy" onFileChange={setLcCopyFile} />
        </CardContent>
      </Card>
    </div>
  );
}
