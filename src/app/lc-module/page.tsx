
'use client';

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Home } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function LcModulePage() {
  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-2">
            <Link href="/">
                <Button variant="ghost" size="icon">
                    <Home className="h-6 w-6" />
                </Button>
            </Link>
            <h1 className="text-2xl font-bold">LC Module</h1>
        </div>
        <Card>
            <CardHeader>
                <CardTitle>Welcome to the LC Module</CardTitle>
                <CardDescription>This is a placeholder page for managing Letters of Credit.</CardDescription>
            </CardHeader>
            <CardContent>
                <p>Content for managing LCs will go here.</p>
            </CardContent>
        </Card>
    </div>
  );
}
