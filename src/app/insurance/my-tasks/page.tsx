
'use client';

import Link from 'next/link';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';

export default function MyTasksPage() {
    const { can, isLoading } = useAuthorization();
    const canViewPage = can('View My Tasks', 'Insurance');

    if (isLoading) {
        return (
            <div className="w-full">
                <Skeleton className="h-10 w-64 mb-6" />
                <Skeleton className="h-48 w-full" />
            </div>
        );
    }
    
    if (!canViewPage) {
        return (
            <div className="w-full">
                <Card>
                    <CardHeader>
                        <CardTitle>Access Denied</CardTitle>
                        <CardDescription>You do not have permission to view this page.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex justify-center p-8">
                        <ShieldAlert className="h-16 w-16 text-destructive" />
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="w-full">
            <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Link href="/insurance">
                        <Button variant="ghost" size="icon">
                            <ArrowLeft className="h-6 w-6" />
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-xl font-bold">My Insurance Tasks</h1>
                        <p className="text-sm text-muted-foreground">
                            A list of all insurance-related tasks assigned to you.
                        </p>
                    </div>
                </div>
            </div>
            <Card>
                <CardContent className="p-6 text-center text-muted-foreground">
                    My Tasks functionality will be implemented here.
                </CardContent>
            </Card>
        </div>
    );
}
