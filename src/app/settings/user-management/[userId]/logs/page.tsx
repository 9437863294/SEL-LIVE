

'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, LogIn, LogOut, FilePlus, FilePen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, orderBy, doc, getDoc } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import type { User } from '@/lib/types';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

type UserLog = {
    id: string;
    action: 'Login' | 'Logout' | 'Create User' | 'Update User' | string;
    timestamp: any;
    details: Record<string, any>;
};

export default function UserLogsPage() {
    const { userId } = useParams() as { userId: string };
    const [user, setUser] = useState<User | null>(null);
    const [logs, setLogs] = useState<UserLog[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!userId) return;

        const fetchUserDataAndLogs = async () => {
            setIsLoading(true);
            try {
                const userDocRef = doc(db, 'users', userId);
                const userDocSnap = await getDoc(userDocRef);
                if (userDocSnap.exists()) {
                    setUser({ id: userDocSnap.id, ...userDocSnap.data() } as User);
                }

                const logsQuery = query(collection(db, 'userLogs'), where('userId', '==', userId), orderBy('timestamp', 'desc'));
                const logsSnapshot = await getDocs(logsQuery);
                const logsData = logsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as UserLog));
                setLogs(logsData);

            } catch (error: any) {
                console.error("Error fetching user logs:", error);
                 if (error.code === 'failed-precondition') {
                    // This error means a composite index is required by Firestore.
                    // You would typically create this in the Firebase console.
                    console.error("Firestore index required. Please create a composite index for 'userLogs' on 'userId' and 'timestamp'.");
                }
            }
            setIsLoading(false);
        };

        fetchUserDataAndLogs();
    }, [userId]);

    const getIcon = (action: string) => {
        switch(action) {
            case 'Login': return <LogIn className="h-4 w-4 text-green-500" />;
            case 'Logout': return <LogOut className="h-4 w-4 text-red-500" />;
            case 'Create User': return <FilePlus className="h-4 w-4 text-blue-500" />;
            case 'Update User': return <FilePen className="h-4 w-4 text-orange-500" />;
            default: return null;
        }
    };

    const renderDetails = (details: Record<string, any>) => {
      const entries = Object.entries(details);
      if (entries.length === 0) return 'N/A';
      
      const detailsString = entries.map(([key, value]) => `${key}: ${value}`).join(', ');

      if (detailsString.length < 50) return detailsString;

      return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger>
                    <p className="truncate max-w-xs">{detailsString}</p>
                </TooltipTrigger>
                <TooltipContent>
                    <div className="max-w-sm space-y-1">
                        {entries.map(([key, value]) => (
                            <div key={key} className="flex justify-between">
                                <span className="font-semibold mr-2">{key}:</span>
                                <span>{String(value)}</span>
                            </div>
                        ))}
                    </div>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
      );
    }


    return (
        <div className="w-full max-w-4xl mx-auto">
            <div className="mb-6 flex items-center gap-4">
                <Link href="/settings/user-management">
                    <Button variant="ghost" size="icon">
                        <ArrowLeft className="h-6 w-6" />
                    </Button>
                </Link>
                <div>
                    {isLoading ? <Skeleton className="h-8 w-48" /> : <h1 className="text-2xl font-bold">Logs for {user?.name}</h1>}
                    {isLoading ? <Skeleton className="h-4 w-64 mt-1" /> : <p className="text-muted-foreground">{user?.email}</p>}
                </div>
            </div>
            
            <Card>
                <CardHeader>
                    <CardTitle>Activity Logs</CardTitle>
                    <CardDescription>A record of the user's activities within the system.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[50px]"></TableHead>
                                <TableHead>Action</TableHead>
                                <TableHead>Details</TableHead>
                                <TableHead>Timestamp</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                Array.from({ length: 5 }).map((_, i) => (
                                    <TableRow key={i}>
                                        <TableCell colSpan={4}><Skeleton className="h-6" /></TableCell>
                                    </TableRow>
                                ))
                            ) : logs.length > 0 ? (
                                logs.map(log => (
                                    <TableRow key={log.id}>
                                        <TableCell>{getIcon(log.action)}</TableCell>
                                        <TableCell className="font-medium">{log.action}</TableCell>
                                        <TableCell>{renderDetails(log.details)}</TableCell>
                                        <TableCell>{format(log.timestamp.toDate(), 'PPpp')}</TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={4} className="h-24 text-center">
                                        No activity logs found for this user.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}


    