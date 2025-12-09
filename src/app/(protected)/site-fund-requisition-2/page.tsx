
'use client';

import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { FileText, BarChart3, Settings } from 'lucide-react';
import Link from 'next/link';

export default function SiteFundRequisition2Page() {
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <h1 className="text-3xl font-bold mb-6">Site Fund Requisition 2</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        <Link href="/site-fund-requisition-2/requests" className="block hover:shadow-lg transition-shadow rounded-xl">
            <Card>
              <CardHeader className="flex flex-row items-start gap-4 space-y-0 p-4">
                  <div className="bg-primary/10 p-3 rounded-lg">
                    <FileText className="w-6 h-6 text-primary" />
                  </div>
                  <div className="flex-1">
                      <CardTitle className="text-base font-bold">Manage Requests</CardTitle>
                      <CardDescription className="text-xs">Manage all requests for this module.</CardDescription>
                  </div>
              </CardHeader>
            </Card>
        </Link>
         <Link href="#" className="block hover:shadow-lg transition-shadow rounded-xl">
            <Card>
              <CardHeader className="flex flex-row items-start gap-4 space-y-0 p-4">
                  <div className="bg-primary/10 p-3 rounded-lg">
                    <BarChart3 className="w-6 h-6 text-primary" />
                  </div>
                  <div className="flex-1">
                      <CardTitle className="text-base font-bold">Reports</CardTitle>
                      <CardDescription className="text-xs">View reports for this module.</CardDescription>
                  </div>
              </CardHeader>
            </Card>
        </Link>
         <Link href="#" className="block hover:shadow-lg transition-shadow rounded-xl">
            <Card>
              <CardHeader className="flex flex-row items-start gap-4 space-y-0 p-4">
                  <div className="bg-primary/10 p-3 rounded-lg">
                    <Settings className="w-6 h-6 text-primary" />
                  </div>
                  <div className="flex-1">
                      <CardTitle className="text-base font-bold">Settings</CardTitle>
                      <CardDescription className="text-xs">Configure settings for this module.</CardDescription>
                  </div>
              </CardHeader>
            </Card>
        </Link>
      </div>
    </div>
  );
}
