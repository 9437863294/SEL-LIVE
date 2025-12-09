
'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import AllRequisitionsTab from '@/components/AllRequisitionsTab';

export function SiteFundDashboard() {
  return (
    <div className="flex flex-col w-full h-full">
        <Card>
            <CardHeader>
                <CardTitle>All Requisitions</CardTitle>
                <CardDescription>
                    Browse and manage all site fund requisitions.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <AllRequisitionsTab />
            </CardContent>
        </Card>
    </div>
  );
}
