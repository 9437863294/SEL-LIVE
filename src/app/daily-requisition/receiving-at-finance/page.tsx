

'use client';

import React, { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  MoreHorizontal,
  Loader2,
  Search,
  ShieldAlert,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, writeBatch, Timestamp } from 'firebase/firestore';
import type { DailyRequisitionEntry, Project, User } from '@/lib/types';
import { format } from 'date-fns';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/components/auth/AuthProvider';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';

/** Display-only fields live alongside original Firestore fields */
type EnrichedEntry = DailyRequisitionEntry & {
  id: string;                    // doc id
  projectName: string;
  receivedByName?: string;       // display string
  dateText: string;              // display string
  receivedAtText?: string;       // display string
};

export default function ReceivingAtFinancePage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const [entries, setEntries] = useState<EnrichedEntry[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const canViewPage = can('View', 'Daily Requisition.Receiving at Finance');
  const canMarkAsReceived = can('Mark as Received', 'Daily Requisition.Receiving at Finance');
  const canReturnToPending = can('Return to Pending', 'Daily Requisition.Receiving at Finance');
  const canCancel = can('Reject', 'Daily Requisition.Receiving at Finance'); // maps to "Cancelled" status below

  const fetchData = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const [reqsSnap, projectsSnap, usersSnap] = await Promise.all([
        getDocs(collection(db, 'dailyRequisitions')),
        getDocs(collection(db, 'projects')),
        getDocs(collection(db, 'users')),
      ]);

      const projectsMap = new Map(
        projectsSnap.docs.map(d => [d.id, (d.data() as Project).projectName]),
      );

      const fetchedUsers = usersSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as User));
      const usersMap = new Map(fetchedUsers.map(u => [u.id, u.name]));
      setUsers(fetchedUsers);

      const data: EnrichedEntry[] = reqsSnap.docs.map(d => {
        const raw = d.data() as DailyRequisitionEntry & {
          receivedById?: string;
          receivedAt?: Timestamp | null;
          date?: Timestamp | string | number | Date;
          createdAt?: Timestamp;
        };

        const dateTs =
          (raw.date as any)?.toDate?.() instanceof Date
            ? (raw.date as Timestamp).toDate()
            : typeof raw.date === 'string' || typeof raw.date === 'number'
              ? new Date(raw.date)
              : raw.createdAt?.toDate
                ? raw.createdAt.toDate()
                : undefined;

        const receivedAtTs = raw.receivedAt?.toDate ? raw.receivedAt.toDate() : undefined;

        return {
          ...(raw as DailyRequisitionEntry),
          id: d.id,
          projectName: projectsMap.get(raw.projectId) || 'N/A',
          receivedByName: raw.receivedById ? usersMap.get(raw.receivedById) : undefined,
          dateText: dateTs ? format(dateTs, 'dd MMM, yyyy') : (raw.date ? String(raw.date) : ''),
          receivedAtText: receivedAtTs ? format(receivedAtTs, 'PPpp') : undefined,
        };
      });

      // Sort: most recent receivedAt first; fallback to createdAt, then date
      data.sort((a, b) => {
        const aMillis =
          (a.receivedAt && (a.receivedAt as Timestamp).toMillis?.()) ??
          (a.createdAt && (a.createdAt as Timestamp).toMillis?.()) ??
          0;
        const bMillis =
          (b.receivedAt && (b.receivedAt as Timestamp).toMillis?.()) ??
          (b.createdAt && (b.createdAt as Timestamp).toMillis?.()) ??
          0;
        return bMillis - aMillis;
      });

      setEntries(data);
    } catch (error: any) {
      console.error('Error fetching finance entries: ', error);
      if (error.code === 'failed-precondition') {
        toast({
          title: 'Database Index Required',
          description: 'This query requires a custom index. Please check the Firebase console for instructions.',
          variant: 'destructive',
          duration: 10000,
        });
      } else {
        toast({ title: 'Error', description: 'Failed to fetch entries.', variant: 'destructive' });
      }
    }
    setIsLoading(false);
  }, [toast]);

  useEffect(() => {
    if (!isAuthLoading && canViewPage) {
      fetchData();
    } else if (!isAuthLoading && !canViewPage) {
      setIsLoading(false);
    }
  }, [isAuthLoading, canViewPage, fetchData]);

  // IMPORTANT: Use only statuses that exist in your DailyRequisitionEntry['status'] union.
  // From the error, allowed values look like:
  // 'Pending' | 'Needs Review' | 'Verified' | 'Received' | 'Cancelled' | 'Received for Payment' | 'Paid'
  type AllowedStatus =
    | 'Pending'
    | 'Needs Review'
    | 'Verified'
    | 'Received'
    | 'Cancelled'
    | 'Received for Payment'
    | 'Paid';

  const handleStatusUpdate = async (ids: string[], newStatus: AllowedStatus) => {
    if (ids.length === 0) return;
    try {
      const batch = writeBatch(db);
      ids.forEach((id) => {
        const docRef = doc(db, 'dailyRequisitions', id);
        const updateData: Partial<DailyRequisitionEntry> & {
          receivedAt?: Timestamp | undefined;
          receivedById?: string | undefined;
        } = { status: newStatus };

        if (newStatus === 'Received') {
          updateData.receivedAt = Timestamp.now();
          updateData.receivedById = user?.id;
        } else if (newStatus === 'Pending') {
          updateData.receivedAt = undefined;
          updateData.receivedById = undefined;
        } else {
          // Other statuses: do not touch receivedAt/receivedById by default
        }

        batch.update(docRef, updateData as any);
      });

      await batch.commit();

      toast({
        title: 'Success',
        description: `${ids.length} entries marked as ${newStatus.toLowerCase()}.`,
      });
      setSelectedIds(new Set());
      fetchData();
    } catch (error) {
      console.error('Error updating entries: ', error);
      toast({
        title: 'Error',
        description: `Failed to mark entries as ${newStatus.toLowerCase()}.`,
        variant: 'destructive',
      });
    }
  };

  const renderTable = (data: EnrichedEntry[], type: 'pending' | 'received' | 'rejected') => {
    const filteredData = data.filter((entry) => {
      const t = searchTerm.toLowerCase();
      return (
        entry.receptionNo.toLowerCase().includes(t) ||
        entry.projectName.toLowerCase().includes(t) ||
        (entry.partyName || '').toLowerCase().includes(t)
      );
    });

    const handleSelectAll = (checked: boolean | 'indeterminate') => {
      if (checked === true) {
        setSelectedIds(new Set(filteredData.map((item) => item.id)));
      } else {
        setSelectedIds(new Set());
      }
    };

    return (
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-end mb-4">
            {type === 'pending' ? (
              <Button
                onClick={() => handleStatusUpdate(Array.from(selectedIds), 'Received')}
                disabled={selectedIds.size === 0 || !canMarkAsReceived}
              >
                Mark as Received
              </Button>
            ) : null}
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                {type === 'pending' && (
                  <TableHead className="w-[50px]">
                    <Checkbox
                      disabled={!canMarkAsReceived}
                      checked={selectedIds.size > 0 && selectedIds.size === filteredData.length}
                      onCheckedChange={handleSelectAll}
                    />
                  </TableHead>
                )}
                <TableHead>Reception No.</TableHead>
                {type === 'pending' ? <TableHead>Date</TableHead> : <TableHead>Received At</TableHead>}
                <TableHead>Project</TableHead>
                <TableHead>Party Name</TableHead>
                {type !== 'pending' && <TableHead>Received By</TableHead>}
                <TableHead className="text-right">Net Amount</TableHead>
                {type !== 'pending' && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>

            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={8}>
                      <Skeleton className="h-8" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filteredData.length > 0 ? (
                filteredData.map((entry) => (
                  <TableRow key={entry.id}>
                    {type === 'pending' && (
                      <TableCell>
                        <Checkbox
                          disabled={!canMarkAsReceived}
                          checked={selectedIds.has(entry.id)}
                          onCheckedChange={(checked) => {
                            const next = new Set(selectedIds);
                            if (checked === true) next.add(entry.id);
                            else next.delete(entry.id);
                            setSelectedIds(next);
                          }}
                        />
                      </TableCell>
                    )}

                    <TableCell>{entry.receptionNo}</TableCell>
                    <TableCell>{type === 'pending' ? entry.dateText : (entry.receivedAtText ?? '—')}</TableCell>
                    <TableCell>{entry.projectName}</TableCell>
                    <TableCell>{entry.partyName}</TableCell>
                    {type !== 'pending' && <TableCell>{entry.receivedByName || 'N/A'}</TableCell>}
                    <TableCell className="text-right">
                      {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(entry.netAmount)}
                    </TableCell>

                    {type !== 'pending' && (
                      <TableCell className="text-right">
                        <AlertDialog>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {canReturnToPending && (
                                <DropdownMenuItem
                                  onSelect={() => handleStatusUpdate([entry.id], 'Pending')}
                                >
                                  <RotateCcw className="mr-2 h-4 w-4" /> Return
                                </DropdownMenuItem>
                              )}
                              {type === 'received' && canCancel && (
                                <AlertDialogTrigger asChild>
                                  <DropdownMenuItem className="text-destructive">
                                    <XCircle className="mr-2 h-4 w-4" /> Cancel
                                  </DropdownMenuItem>
                                </AlertDialogTrigger>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>

                          {/* Confirm cancel dialog */}
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will mark the entry as <b>Cancelled</b>. You can move it back to Pending later.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Close</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleStatusUpdate([entry.id], 'Cancelled')}
                              >
                                Confirm
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={8} className="text-center h-24">
                    No entries found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    );
  };

  const pendingEntries = useMemo(
    () => entries.filter((e) => e.status === 'Pending'),
    [entries],
  );
  const receivedEntries = useMemo(
    () => entries.filter((e) => e.status === 'Received'),
    [entries],
  );
  // If your dataset actually uses 'Cancelled' instead of 'Rejected', keep this:
  const rejectedEntries = useMemo(
    () => entries.filter((e) => e.status === 'Cancelled'),
    [entries],
  );
  // If you truly have 'Rejected', change the AllowedStatus union and replace 'Cancelled' above.

  if (isAuthLoading || (isLoading && canViewPage)) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <Skeleton className="h-10 w-80 mb-6" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!canViewPage) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-2">
          <Link href="/daily-requisition">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">Receiving at Finance</h1>
        </div>
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
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-2">
        <Link href="/daily-requisition">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-6 w-6" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">Receiving at Finance</h1>
      </div>

      <Tabs defaultValue="pending">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="received">Received</TabsTrigger>
          <TabsTrigger value="rejected">Cancelled</TabsTrigger>
        </TabsList>

        <div className="mt-4">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search all lists by Reception No, Project, or Party Name..."
              className="pl-8"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <TabsContent value="pending" className="mt-4">
          {renderTable(pendingEntries, 'pending')}
        </TabsContent>
        <TabsContent value="received" className="mt-4">
          {renderTable(receivedEntries, 'received')}
        </TabsContent>
        <TabsContent value="rejected" className="mt-4">
          {renderTable(rejectedEntries, 'rejected')}
        </TabsContent>
      </Tabs>
    </div>
  );
}
