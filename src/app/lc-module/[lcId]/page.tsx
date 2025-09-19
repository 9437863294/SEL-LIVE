
'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Edit, Save, Loader2, Paperclip, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import type { LcEntry, Project } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';

export default function LcDetailsPage() {
  const { lcId } = useParams() as { lcId: string };
  const { toast } = useToast();
  const router = useRouter();
  const [lc, setLc] = useState<LcEntry | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!lcId) return;

    const fetchLcData = async () => {
      setIsLoading(true);
      try {
        const lcDocRef = doc(db, 'lcs', lcId);
        const lcDocSnap = await getDoc(lcDocRef);

        if (lcDocSnap.exists()) {
          const lcData = { id: lcDocSnap.id, ...lcDocSnap.data() } as LcEntry;
          setLc(lcData);

          if (lcData.projectId) {
            const projectDocRef = doc(db, 'projects', lcData.projectId);
            const projectDocSnap = await getDoc(projectDocRef);
            if(projectDocSnap.exists()) {
                setProject(projectDocSnap.data() as Project);
            }
          }
        } else {
          toast({ title: "Error", description: "LC record not found.", variant: "destructive" });
          router.push('/lc-module');
        }
      } catch (error) {
        console.error("Error fetching LC data:", error);
        toast({ title: "Error", description: "Failed to fetch LC details.", variant: "destructive" });
      }
      setIsLoading(false);
    };

    fetchLcData();
  }, [lcId, toast, router]);
  
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  };
  
  const DocumentLink = ({ url, label }: { url?: string; label: string }) => {
    if (!url) return <p className="text-sm text-muted-foreground">Not uploaded</p>;
    return (
        <a href={url} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm">
                <Download className="mr-2 h-4 w-4" /> {label}
            </Button>
        </a>
    );
  };
  
  if (isLoading) {
    return (
        <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <Skeleton className="h-10 w-64 mb-6" />
            <Skeleton className="h-48 mb-6" />
            <Skeleton className="h-96" />
        </div>
    )
  }

  if (!lc) return null;

  return (
    <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/lc-module"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
              <div>
                <h1 className="text-xl font-bold">LC Details</h1>
                <p className="text-muted-foreground">{lc.lcNo}</p>
              </div>
            </div>
            {/* Future buttons for payment tracking etc. can go here */}
        </div>
        
        <Card className="mb-6">
            <CardHeader>
                <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-6">
                <div><Label>Vendor</Label><p className="font-semibold">{lc.vendor}</p></div>
                <div><Label>Project</Label><p className="font-semibold">{project?.projectName || 'N/A'}</p></div>
                <div><Label>Bank</Label><p className="font-semibold">{lc.bank}</p></div>
                <div><Label>LC Amount</Label><p className="font-semibold">{formatCurrency(lc.lcAmount)}</p></div>
                <div><Label>SEL Calc.</Label><p className="font-semibold">{formatCurrency(lc.selCalculation)}</p></div>
                <div><Label>Bank Calc.</Label><p className="font-semibold">{formatCurrency(lc.bankCalculation)}</p></div>
                <div><Label>Difference</Label><p className="font-semibold">{formatCurrency(lc.difference)}</p></div>
                <div><Label>FD Margin</Label><p className="font-semibold">{formatCurrency(lc.fdMargin)}</p></div>
                <div><Label>Status</Label><p className="font-semibold">{lc.status}</p></div>
            </CardContent>
        </Card>
        
        <Card>
            <CardHeader>
                <CardTitle>Documents</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
               <div className="space-y-1"><Label>Purchase Order</Label><DocumentLink url={lc.poUrl} label="View PO" /></div>
               <div className="space-y-1"><Label>LC Application</Label><DocumentLink url={lc.applicationUrl} label="View Application" /></div>
               <div className="space-y-1"><Label>LC Copy</Label><DocumentLink url={lc.lcCopyUrl} label="View LC Copy" /></div>
            </CardContent>
        </Card>
    </div>
  );
}
