
'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function SiteFundRequisition2Page() {
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <h1 className="text-3xl font-bold mb-6">Site Fund Requisition 2</h1>
      <Card>
        <CardHeader>
          <CardTitle>Manage Requests</CardTitle>
        </CardHeader>
        <CardContent>
          <p>Here you can manage all the requests for this module.</p>
        </CardContent>
      </Card>
    </div>
  );
}
