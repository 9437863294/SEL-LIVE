

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ClipboardList,
  Truck,
  Calculator,
  FileEdit,
  BarChart3,
  FilePlus,
  HardHat,
  FolderOpen,
  ShieldAlert,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useParams, useRouter } from 'next/navigation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Project } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';

interface BillingReconCardProps {
  item: {
    icon: LucideIcon;
    text: string;
    href: string;
    description: string;
    disabled?: boolean;
  };
}

const slugify = (text: string) => {
    if (!text) return '';
    return text.toString().toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w\-]+/g, '')
      .replace(/\-\-+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '');
}


function BillingReconCard({ item }: BillingReconCardProps) {
    const cardContent = (
         <Card
            className={cn(
                "flex flex-col h-full transition-all duration-300 ease-in-out hover:shadow-lg bg-background rounded-xl border-border/80 hover:border-primary/50",
                item.href === '#' || item.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
            )}
            >
            <CardHeader className="flex-row items-center gap-4 space-y-0 p-4">
                <div className="bg-primary/10 p-3 rounded-lg">
                <item.icon className="w-6 h-6 text-primary" />
                </div>
                <div className="flex-1">
                    <CardTitle className="text-base font-bold">{item.text}</CardTitle>
                    <CardDescription className="text-xs">{item.description}</CardDescription>
                </div>
            </CardHeader>
        </Card>
    )

    if (item.href === '#' || item.disabled) {
        return <div className="h-full">{cardContent}</div>;
    }
    
    return (
       <Link href={item.href} className="no-underline h-full">
            {cardContent}
        </Link>
    )
}


export default function ProjectDashboardPage() {
  const { project: projectSlug } = useParams() as { project: string };
  const router = useRouter();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  useEffect(() => {
    if(isAuthLoading) return;

    const fetchProjects = async () => {
        setIsLoading(true);
        try {
            const q = query(collection(db, 'projects'), where('billingRequired', '==', true));
            const querySnapshot = await getDocs(q);
            const projectsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));
            setProjects(projectsData);
        } catch (error) {
            console.error("Error fetching projects: ", error);
        }
        setIsLoading(false);
    };
    fetchProjects();
  }, [isAuthLoading]);

  const handleProjectChange = (slug: string) => {
    router.push(`/billing-recon/${slug}`);
  };

  const currentProject = projects.find(p => slugify(p.projectName) === projectSlug);
  const projectName = currentProject?.projectName || projectSlug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  
  const billingItems = [
    { icon: ClipboardList, text: 'BOQ', href: `/billing-recon/${projectSlug}/boq`, description: 'Manage Bill of Quantities.', disabled: !can('View', 'Billing Recon.BOQ') },
    { icon: Truck, text: 'MVAC', href: `/billing-recon/${projectSlug}/mvac`, description: 'Record supply and JMC details.', disabled: !can('View', 'Billing Recon.MVAC') },
    { icon: HardHat, text: 'JMC', href: `/billing-recon/${projectSlug}/jmc`, description: 'Manage the civil workstream.', disabled: !can('View', 'Billing Recon.JMC') },
    { icon: Calculator, text: 'Billing', href: `/billing-recon/${projectSlug}/billing`, description: 'Generate and manage bills.', disabled: !can('View', 'Billing Recon.Billing') },
    { icon: FileEdit, text: 'Amendment Entry', href: '#', description: 'Manage amendments and revisions.' },
    { icon: BarChart3, text: 'Reports', href: '#', description: 'View and generate billing reports.' },
    { icon: FilePlus, text: 'Create ARD', href: '#', description: 'Create Abstract of Rate Document.' },
  ];

  if (isLoading || isAuthLoading) {
      return (
        <div className="w-full px-4 sm:px-6 lg:px-8">
            <Skeleton className="h-10 w-1/2 mb-8" />
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
            </div>
        </div>
      )
  }
  
  if(!can('View Module', 'Billing Recon')) {
    return (
        <div className="w-full px-4 sm:px-6 lg:px-8">
             <div className="mb-8 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Link href="/billing-recon"><Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button></Link>
                    <h1 className="text-2xl font-bold">{projectName}</h1>
                </div>
            </div>
            <Card>
                <CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to view this project dashboard.</CardDescription></CardHeader>
                <CardContent className="flex justify-center p-8"><ShieldAlert className="h-16 w-16 text-destructive" /></CardContent>
            </Card>
        </div>
    )
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-2">
            <Link href="/billing-recon">
                <Button variant="ghost" size="icon">
                    <ArrowLeft className="h-6 w-6" />
                </Button>
            </Link>
            <h1 className="text-2xl font-bold">{projectName}</h1>
        </div>
        <div className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-muted-foreground" />
             <Select value={projectSlug} onValueChange={handleProjectChange}>
                <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Select Project" />
                </SelectTrigger>
                <SelectContent>
                    {projects.map(p => (
                        <SelectItem key={p.id} value={slugify(p.projectName)}>{p.projectName}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {billingItems.map((item) => (
          <BillingReconCard key={item.text} item={item} />
        ))}
      </div>
    </div>
  );
}
