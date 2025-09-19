

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Send, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, deleteDoc, doc } from 'firebase/firestore';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { EmailAuthorization } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
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
import { sendEmailAuthorization } from '@/ai';

export default function EmailAuthorizationPage() {
  const { toast } = useToast();
  const [authorizations, setAuthorizations] = useState<EmailAuthorization[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [email, setEmail] = useState('');

  const fetchAuthorizations = async () => {
    setIsLoading(true);
    try {
      const querySnapshot = await getDocs(collection(db, 'emailAuthorizations'));
      setAuthorizations(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as EmailAuthorization)));
    } catch (error) {
      console.error("Error fetching authorizations: ", error);
      toast({ title: 'Error', description: 'Failed to fetch authorizations.', variant: 'destructive' });
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchAuthorizations();
  }, []);

  const handleSendRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      toast({ title: 'Email required', description: 'Please enter an email address.', variant: 'destructive' });
      return;
    }
    setIsSending(true);
    try {
      const result = await sendEmailAuthorization({ email });
      if (result.success) {
        toast({
          title: 'Request Sent',
          description: result.message,
        });
        setEmail('');
        fetchAuthorizations(); // Refresh list
      } else {
        toast({
          title: 'Request Failed',
          description: result.message,
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      console.error("Error sending request: ", error);
      toast({ title: 'Error', description: error.message || 'Failed to send authorization request.', variant: 'destructive' });
    }
    setIsSending(false);
  };

  const handleRevoke = async (id: string) => {
    try {
      await deleteDoc(doc(db, "emailAuthorizations", id));
      toast({ title: "Authorization Revoked", description: "The authorization has been successfully revoked." });
      fetchAuthorizations();
    } catch (error) {
      console.error("Error revoking authorization: ", error);
      toast({ title: "Error", description: "Failed to revoke authorization.", variant: "destructive" });
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/settings">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-6 w-6" />
          </Button>
        </Link>
        <h1 className="text-xl font-bold">Email Authorization</h1>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Authorize a New Employee</CardTitle>
          <CardDescription>Enter an employee's email to send them an authorization request. They will receive an email to grant access.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSendRequest} className="flex items-end gap-2">
            <div className="flex-grow space-y-2">
              <Label htmlFor="email-input">Employee Email</Label>
              <Input
                id="email-input"
                type="email"
                placeholder="employee@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isSending}
              />
            </div>
            <Button type="submit" disabled={isSending}>
              {isSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Send Request
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Authorized Employees</CardTitle>
          <CardDescription>This is a list of employees who have been sent an authorization request or have already granted access.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-8 w-20" /></TableCell>
                  </TableRow>
                ))
              ) : authorizations.length > 0 ? (
                authorizations.map((auth) => (
                  <TableRow key={auth.id}>
                    <TableCell className="font-medium">{auth.email}</TableCell>
                    <TableCell>
                      <Badge variant={auth.status === 'Authorized' ? 'default' : 'secondary'}>
                        {auth.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{new Date(auth.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                       <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="sm">
                              <Trash2 className="mr-2 h-4 w-4" /> Revoke
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will revoke the application's access to this user's email. They will need to re-authorize to grant access again.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleRevoke(auth.id)}>Revoke</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-center h-24">
                    No authorizations found.
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
