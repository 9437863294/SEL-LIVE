
'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

export default function StoreStockDashboard() {
  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Dashboard</h1>
      <Card>
        <CardHeader>
          <CardTitle>Welcome to Store & Stock Management</CardTitle>
        </CardHeader>
        <CardContent>
          <p>The dashboard content will be displayed here.</p>
        </CardContent>
      </Card>
    </div>
  );
}
