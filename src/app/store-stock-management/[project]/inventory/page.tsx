
'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

export default function InventoryPage() {
  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Inventory</h1>
      <Card>
        <CardHeader>
          <CardTitle>Inventory Management</CardTitle>
        </CardHeader>
        <CardContent>
          <p>Inventory management interface will be here.</p>
        </CardContent>
      </Card>
    </div>
  );
}
