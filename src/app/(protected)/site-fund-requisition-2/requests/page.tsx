
'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ManageRequestsPage() {
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <Link href="/site-fund-requisition-2">
            <Button variant="ghost" size="icon">
                <ArrowLeft className="h-6 w-6" />
            </Button>
        </Link>
      </div>
      <h1 className="text-3xl font-bold">Manage Requests</h1>
      <p className="text-muted-foreground mt-2">This is a blank page to manage requests.</p>
    </div>
  );
}
