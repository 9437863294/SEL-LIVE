
'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { useParams } from 'next/navigation';

export default function SubcontractorsPage() {
    const params = useParams();
    const projectSlug = params.project as string;
    
    return (
        <div className="w-full px-4 sm:px-6 lg:px-8">
            <div className="mb-6 flex items-center gap-2">
                <Link href={`/billing-recon/${projectSlug}/jmc`}>
                    <Button variant="ghost" size="icon">
                        <ArrowLeft className="h-6 w-6" />
                    </Button>
                </Link>
                <h1 className="text-2xl font-bold">Subcontractors Management</h1>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Under Construction</CardTitle>
                    <CardDescription>This page is currently under development.</CardDescription>
                </CardHeader>
                <CardContent>
                    <p>The functionality to manage subcontractors will be available here soon.</p>
                </CardContent>
            </Card>
        </div>
    );
}
