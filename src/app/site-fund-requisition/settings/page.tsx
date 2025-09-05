
'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function SiteFundRequisitionSettingsPage() {
  return (
    <div className="w-full max-w-6xl mx-auto">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/site-fund-requisition">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-6 w-6" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">Site Fund Requisition Settings</h1>
      </div>
      <div>
        <p className="text-muted-foreground">
          Configuration options for the Site Fund Requisition module will be available here.
        </p>
      </div>
    </div>
  );
}
