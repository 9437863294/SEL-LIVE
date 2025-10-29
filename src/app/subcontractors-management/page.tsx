
'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Home } from 'lucide-react';

export default function SubcontractorsManagementPage() {
  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/">
                <Button variant="ghost" size="icon">
                  <Home className="h-6 w-6" />
                </Button>
              </Link>
              <h1 className="text-2xl font-bold">Subcontractors Management</h1>
            </div>
        </div>
        <Card>
            <CardHeader>
                <CardTitle>Under Construction</CardTitle>
                <CardDescription>
                    This module is currently under development.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <p>The functionality to manage subcontractors will be available here soon.</p>
            </CardContent>
        </Card>
    </div>
  );
}
