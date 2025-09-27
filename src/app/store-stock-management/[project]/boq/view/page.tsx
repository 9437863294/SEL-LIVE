
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Trash2, Loader2, View, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { collection, getDocs, writeBatch, doc, deleteDoc, query, where } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
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
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from '@/components/ui/checkbox';
import { useParams } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { logUserActivity } from '@/lib/activity-logger';
import { Input } from '@/components/ui/input';

type BoqItem = {
    id: string;
    [key: string]: any;
};

export default function ViewBoqPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { project: projectSlug } = useParams() as { project: string };
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchBoqItems = async () => {
    if (!projectSlug) return;
    setIsLoading(true);
    try {
      const q = query(collection(db, 'boqItems'), where('projectSlug', '==', projectSlug));
      const boqSnapshot = await getDocs(q);

      const items = boqSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BoqItem));
      
      if (items.length > 0) {
        const allHeaders = items.reduce((acc, item) => {
            Object.keys(item).forEach(key => {
                if (!acc.includes(key)) {
                    acc.push(key);
                }
            });
            return acc;
        }, [] as string[]);
        
        // Remove internal fields and ensure a somewhat logical order
        const orderedHeaders = [
            'Sl No', 'Description', 'UNIT', 'BOQ QTY', 'UNIT PRICE', 'Project', 'Site', 'Scope'
        ].filter(h => allHeaders.includes(h));
        
        const remainingHeaders = allHeaders.filter(h => !orderedHeaders.includes(h) && h !== 'id' && h !== 'projectSlug');
        setHeaders([...orderedHeaders, ...remainingHeaders]);
      }

      setBoqItems(items);
      
    } catch (error: any) {
      console.error("Error fetching BOQ items: ", error);
       if (error.code === 'failed-precondition') {
          toast({
              title: 'Database Index Required',
              description: 'An index is required for this query. Please create a composite index on the `boqItems` collection for the `projectSlug` field.',
              variant: 'destructive',
              duration: 10000,
          });
      } else {
        toast({ title: 'Error', description: 'Failed to fetch BOQ items.', variant: 'destructive' });
      }
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchBoqItems();
  }, [projectSlug]);

  const filteredItems = boqItems.filter(item => {
      const search = searchTerm.toLowerCase();
      return Object.values(item).some(val => 
          String(val).toLowerCase().includes(search)
      );
  });

  const handleDeleteSelected = async () => {
    if (!user) return;
    setIsDeleting(true);
    const batch = writeBatch(db);
    selectedItemIds.forEach(id => {
        batch.delete(doc(db, 'boqItems', id));
    });

    try {
        await batch.commit();

        await logUserActivity({
            userId: user.id,
            action: 'Delete BOQ Items (Stock)',
            details: { project: projectSlug, deletedItemCount: selectedItemIds.length }
        });

        toast({
            title: 'Success',
            description: `${selectedItemIds.length} item(s) deleted successfully.`,
        });
        setSelectedItemIds([]);
        fetchBoqItems();
    } catch (error) {
        console.error("Error deleting selected items:", error);
        toast({ title: 'Error', description: 'Failed to delete selected items.', variant: 'destructive' });
    }
    setIsDeleting(false);
  };
  
  const handleSelectAll = (checked: boolean) => {
      setSelectedItemIds(checked ? filteredItems.map(item => item.id) : []);
  };
  
  const handleSelectRow = (id: string, checked: boolean) => {
      setSelectedItemIds(prev => checked ? [...prev, id] : prev.filter(itemId => itemId !== id));
  };


  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
            <Link href={`/store-stock-management/${projectSlug}/boq`}>
                <Button variant="ghost" size="icon">
                    <ArrowLeft className="h-6 w-6" />
                </Button>
            </Link>
            <h1 className="text-xl font-bold">View BOQ</h1>
        </div>
         <div className="flex items-center gap-2">
              <Input
                  placeholder="Search BOQ..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="max-w-sm"
              />
              {selectedItemIds.length > 0 && (
                  <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" disabled={isDeleting}>
                          {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                          Delete ({selectedItemIds.length})
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                          <AlertDialogHeader>
                              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                              <AlertDialogDescription>
                                  This will permanently delete {selectedItemIds.length} item(s). This action cannot be undone.
                              </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={handleDeleteSelected}>Continue</AlertDialogAction>
                          </AlertDialogFooter>
                      </AlertDialogContent>
                  </AlertDialog>
              )}
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
            <div className="overflow-x-auto rounded-lg border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[50px]">
                                <Checkbox 
                                    checked={selectedItemIds.length === filteredItems.length && filteredItems.length > 0}
                                    onCheckedChange={handleSelectAll}
                                />
                            </TableHead>
                            {headers.map((header) => (
                                <TableHead key={header} className="whitespace-nowrap px-4">{header}</TableHead>
                            ))}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            Array.from({ length: 5 }).map((_, i) => (
                            <TableRow key={i}>
                                <TableCell><Skeleton className="h-5 w-5" /></TableCell>
                                {headers.map((header) => (
                                    <TableCell key={header}><Skeleton className="h-5 w-full" /></TableCell>
                                ))}
                            </TableRow>
                            ))
                        ) : filteredItems.length > 0 ? (
                            filteredItems.map((item) => (
                                <TableRow 
                                key={item.id} 
                                data-state={selectedItemIds.includes(item.id) && "selected"}
                                >
                                    <TableCell>
                                        <Checkbox 
                                            checked={selectedItemIds.includes(item.id)}
                                            onCheckedChange={(checked) => handleSelectRow(item.id, !!checked)}
                                        />
                                    </TableCell>
                                    {headers.map(header => (
                                        <TableCell key={`${item.id}-${header}`}>
                                            {item[header]}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell colSpan={headers.length + 1} className="text-center h-24">
                                    No BOQ items found for this project.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
        </CardContent>
      </Card>
    </div>
  );
}
