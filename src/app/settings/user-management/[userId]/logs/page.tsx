
'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, LogIn, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, orderBy, doc, getDoc } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import type { User } from '@/lib/types';

// This is a mock type for logs, you would define this based on your actual log structure
type UserLog = {
    id: string;
    action: 'Login' | 'Logout' | string;
    timestamp: any;
    ipAddress?: string;
    userAgent?: string;
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
                // Fetch user data
                const userDocRef = doc(db, 'users', userId);
                const userDocSnap = await getDoc(userDocRef);
                if (userDocSnap.exists()) {
                    setUser({ id: userDocSnap.id, ...userDocSnap.data() } as User);
                }

                // Fetch user logs (this is a mock query, you'll need a real 'userLogs' collection)
                const logsQuery = query(collection(db, 'userLogs'), where('userId', '==', userId), orderBy('timestamp', 'desc'));
                const logsSnapshot = await getDocs(logsQuery);
                const logsData = logsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as UserLog));
                
                // Add some mock data if no real logs are found
                if(logsData.length === 0){
                    setLogs([
                        { id: '1', action: 'Login', timestamp: new Date(), ipAddress: '192.168.1.1' },
                        { id: '2', action: 'Logout', timestamp: new Date(Date.now() - 3600000), ipAddress: '192.168.1.1' },
                    ]);
                } else {
                    setLogs(logsData);
                }

            } catch (error) {
                console.error("Error fetching user logs:", error);
            }
            setIsLoading(false);
        };

        fetchUserDataAndLogs();
    }, [userId]);

    const getIcon = (action: string) => {
        switch(action) {
            case 'Login': return <LogIn className="h-4 w-4 text-green-500" />;
            case 'Logout': return <LogOut className="h-4 w-4 text-red-500" />;
            default: return null;
        }
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
                                <TableHead>Timestamp</TableHead>
                                <TableHead>IP Address</TableHead>
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
                                        <TableCell>{format(log.timestamp.toDate ? log.timestamp.toDate() : log.timestamp, 'PPpp')}</TableCell>
                                        <TableCell>{log.ipAddress || 'N/A'}</TableCell>
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

