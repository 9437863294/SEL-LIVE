
'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

export default function TransactionsPage() {
  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Transactions</h1>
      <Card>
        <CardHeader>
          <CardTitle>Transaction History</CardTitle>
        </CardHeader>
        <CardContent>
          <p>Transaction log will be displayed here.</p>
        </CardContent>
      </Card>
    </div>
  );
}
