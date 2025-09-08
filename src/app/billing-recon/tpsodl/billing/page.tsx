
'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function BillingPage() {

  return (
    <div className="w-full max-w-4xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
            <Link href="/billing-recon/tpsodl">
                <Button variant="ghost" size="icon">
                    <ArrowLeft className="h-6 w-6" />
                </Button>
            </Link>
            <h1 className="text-2xl font-bold">Billing</h1>
        </div>
      </div>

      <Card>
        <CardHeader>
            <CardTitle>Billing Management</CardTitle>
            <CardDescription>This section will contain functionality for generating and managing bills.</CardDescription>
        </CardHeader>
        <CardContent>
            <div className="text-center text-muted-foreground py-12">
                <p>Billing functionality to be implemented here.</p>
            </div>
        </CardContent>
      </Card>
    </div>
  );
}
