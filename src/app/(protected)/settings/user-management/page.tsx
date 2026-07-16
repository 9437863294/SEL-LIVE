

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CheckCheck, Copy, Plus, RefreshCw, ShieldAlert, Search, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle as CardTitleShad,
  CardDescription as CardDescriptionShad,
  CardContent as CardContentShad,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, updateDoc, setDoc } from 'firebase/firestore';
import type { User, Role } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useAuthorization } from '@/hooks/useAuthorization';
import { ScrollArea } from '@/components/ui/scroll-area';
import { logUserActivity } from '@/lib/activity-logger';
import { useAuth } from '@/components/auth/AuthProvider';
import { AuroraBackdrop } from '@/components/effects/AuroraBackdrop';


const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghjkmnpqrstuvwxyz';
const NUMS  = '23456789';
const SYMS  = '@#$%!&';

function generatePassword(): string {
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  const chars = [
    pick(UPPER), pick(UPPER), pick(UPPER),
    pick(LOWER), pick(LOWER), pick(LOWER), pick(LOWER),
    pick(NUMS),  pick(NUMS),  pick(NUMS),
    pick(SYMS),  pick(SYMS),
  ];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

const initialNewUserState = {
  name: '',
  email: '',
  password: '',
  mobile: 'N/A',
  role: '',
  status: 'Active' as 'Active' | 'Inactive',
};

export default function ManageUserPage() {
  const { toast } = useToast();
  const router = useRouter();
  const { user: adminUser } = useAuth();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [newUser, setNewUser] = useState(initialNewUserState);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isAddDialogOpen) {
      setNewUser(prev => ({ ...prev, password: generatePassword() }));
      setCopied(false);
    }
  }, [isAddDialogOpen]);

  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'Active' | 'Inactive'>('all');

  const canView = can('View', 'Settings.User Management');
  const canAdd = can('Add', 'Settings.User Management');
  const canEdit = can('Edit', 'Settings.User Management');

  useEffect(() => {
    if (!isAuthLoading && canView) {
      fetchUsersAndRoles();
    } else if (!isAuthLoading && !canView) {
        setIsLoading(false);
    }
  }, [isAuthLoading, canView]);

  const fetchUsersAndRoles = async () => {
    setIsLoading(true);
    try {
      const usersQuerySnapshot = await getDocs(collection(db, 'users'));
      const usersData: User[] = [];
      usersQuerySnapshot.forEach((doc) => {
        usersData.push({ id: doc.id, ...doc.data() } as User);
      });
      setUsers(usersData);

      const rolesQuerySnapshot = await getDocs(collection(db, 'roles'));
      const rolesData: Role[] = [];
      rolesQuerySnapshot.forEach((doc) => {
        rolesData.push({ id: doc.id, ...doc.data() } as Role);
      });
      setRoles(rolesData);

    } catch (error) {
      console.error("Error fetching data: ", error);
      toast({
        title: 'Error',
        description: 'Failed to fetch users or roles.',
        variant: 'destructive',
      });
    }
    setIsLoading(false);
  };
  
  const handleInputChange = (field: keyof typeof newUser, value: string) => {
    setNewUser(prev => ({ ...prev, [field]: value }));
  };
  
  const handleSelectChange = (field: keyof typeof newUser, value: string) => {
    setNewUser(prev => ({ ...prev, [field]: value as any }));
  };
  
  const resetAddDialog = () => {
    setNewUser(initialNewUserState);
    setIsAddDialogOpen(false);
  }

  const handleAddUser = async () => {
    if (!newUser.name.trim() || !newUser.email.trim() || !newUser.password.trim() || !newUser.role) {
      toast({
        title: 'Validation Error',
        description: 'Name, email, password, and role cannot be empty.',
        variant: 'destructive',
      });
      return;
    }
    if (!adminUser) {
        toast({ title: 'Authentication Error', description: 'Admin user not found.', variant: 'destructive'});
        return;
    }

    try {
      const res = await fetch('/api/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newUser.name,
          email: newUser.email,
          password: newUser.password,
          mobile: newUser.mobile,
          role: newUser.role,
          status: newUser.status,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: 'Error creating user', description: data?.error || 'An unexpected error occurred.', variant: 'destructive' });
        return;
      }

      // Write Firestore profile client-side — admin is still signed in here
      await setDoc(doc(db, 'users', data.uid), {
        name: newUser.name.trim(),
        email: newUser.email.trim().toLowerCase(),
        mobile: newUser.mobile || 'N/A',
        role: newUser.role,
        status: newUser.status || 'Active',
      });

      // Log this activity
      await logUserActivity({
          userId: adminUser.id,
          action: 'Create User',
          details: {
              createdUserName: newUser.name,
              createdUserEmail: newUser.email,
              assignedRole: newUser.role,
          }
      });

      // Send welcome email — non-blocking, don't fail user creation if this errors
      fetch('/api/send-welcome-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newUser.name,
          email: newUser.email,
          password: newUser.password,
          role: newUser.role,
        }),
      }).catch(() => {});

      toast({
        title: 'User Created',
        description: `"${newUser.name}" has been created. A welcome email with login credentials was sent to ${newUser.email}.`,
      });
      resetAddDialog();
      fetchUsersAndRoles(); 
    } catch (error: any) {
      console.error("Error adding user: ", error);
      toast({
        title: 'Error creating user',
        description: error.message || 'An unexpected error occurred.',
        variant: 'destructive',
      });
    }
  };
  
  const openEditDialog = (user: User) => {
    setEditingUser(user);
    setIsEditDialogOpen(true);
  };
  
  const handleUpdateUser = async () => {
    if (!editingUser || !adminUser) return;
  
    try {
      const userRef = doc(db, 'users', editingUser.id);
      const { id, ...dataToUpdate } = editingUser;
      await updateDoc(userRef, dataToUpdate);

      await logUserActivity({
          userId: adminUser.id,
          action: 'Update User',
          details: {
              updatedUserName: editingUser.name,
              updatedUserEmail: editingUser.email
          }
      });

      toast({
        title: 'Success',
        description: 'User updated successfully.',
      });
      setIsEditDialogOpen(false);
      setEditingUser(null);
      fetchUsersAndRoles();
    } catch (error) {
      console.error('Error updating user: ', error);
      toast({
        title: 'Error',
        description: 'Failed to update user.',
        variant: 'destructive',
      });
    }
  };

  const handleRowClick = (userId: string) => {
    router.push(`/settings/user-management/${userId}/logs`);
  };

  const displayedUsers = users.filter((u) => {
    const term = searchTerm.trim().toLowerCase();
    if (term) {
      const hay = `${u.name || ''} ${u.email || ''} ${u.mobile || ''} ${u.role || ''}`.toLowerCase();
      if (!hay.includes(term)) return false;
    }
    if (roleFilter !== 'all' && u.role !== roleFilter) return false;
    if (statusFilter !== 'all' && u.status !== statusFilter) return false;
    return true;
  });
  
  if (isAuthLoading || (isLoading && canView)) {
      return (
        <div className="relative min-h-[calc(100vh-4rem)] overflow-hidden px-4 py-3 sm:px-5">
            <AuroraBackdrop />
            <div className="w-full">
              <div className="mb-6 flex items-center justify-between">
                  <Skeleton className="h-10 w-48" />
                  <Skeleton className="h-10 w-32" />
              </div>
              <Card>
                  <CardContent className="p-0">
                      <Skeleton className="h-96 w-full" />
                  </CardContent>
              </Card>
            </div>
        </div>
      );
  }
  
  if (!canView) {
    return (
        <div className="relative min-h-[calc(100vh-4rem)] overflow-hidden px-4 py-3 sm:px-5">
            <AuroraBackdrop />
            <div className="w-full">
              <div className="mb-6 flex items-center gap-4">
                <Link href="/settings">
                  <Button variant="ghost" size="icon">
                    <ArrowLeft className="h-6 w-6" />
                  </Button>
                </Link>
                <h1 className="text-2xl font-bold">User Management</h1>
              </div>
              <Card>
                  <CardHeader>
                      <CardTitleShad>Access Denied</CardTitleShad>
                      <CardDescriptionShad>You do not have permission to view this page. Please contact an administrator.</CardDescriptionShad>
                  </CardHeader>
                  <CardContentShad className="flex justify-center p-8">
                      <ShieldAlert className="h-16 w-16 text-destructive" />
                  </CardContentShad>
              </Card>
            </div>
        </div>
    );
  }


  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-hidden px-4 py-3 sm:px-5">
      <AuroraBackdrop />

      <div className="w-full">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-start gap-4">
            <Link href="/settings">
              <Button variant="ghost" size="icon" className="rounded-full bg-white/70 shadow-sm backdrop-blur hover:bg-white/90">
                <ArrowLeft className="h-6 w-6" />
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">User Management</h1>
                <Badge variant="outline" className="border-white/70 bg-white/70 text-slate-700 backdrop-blur">
                  {users.length} users
                </Badge>
              </div>
              <p className="mt-1 text-sm text-slate-600">
                Create accounts, assign roles, and review activity logs with one click.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button disabled={!canAdd} className="shadow-[0_18px_60px_-45px_rgba(2,6,23,0.55)]">
                <Plus className="mr-2 h-4 w-4" />
                Add User
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-2xl" onPointerDownOutside={(e) => e.preventDefault()}>
              <DialogHeader>
                <DialogTitle>Add New User</DialogTitle>
                <DialogDescription>
                  Fill in the details below. A secure password is auto-generated and a welcome email with login credentials will be sent to the user.
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                <div className="space-y-2">
                    <Label htmlFor="name">Name</Label>
                    <Input id="name" placeholder="e.g. John Doe" value={newUser.name} onChange={(e) => handleInputChange('name', e.target.value)} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" placeholder="e.g. john@example.com" value={newUser.email} onChange={(e) => handleInputChange('email', e.target.value)} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Auto-generated Password</Label>
                    <span className="text-[11px] text-muted-foreground">Sent to user by email</span>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      id="password"
                      type="text"
                      value={newUser.password}
                      readOnly
                      className="font-mono tracking-widest text-base flex-1 bg-slate-50 border-dashed"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      title="Copy password"
                      onClick={() => {
                        navigator.clipboard.writeText(newUser.password);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                    >
                      {copied
                        ? <CheckCheck className="h-4 w-4 text-emerald-600" />
                        : <Copy className="h-4 w-4" />}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      title="Generate new password"
                      onClick={() => { handleInputChange('password', generatePassword()); setCopied(false); }}
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="mobile">Mobile No</Label>
                    <Input id="mobile" placeholder="e.g. N/A" value={newUser.mobile} onChange={(e) => handleInputChange('mobile', e.target.value)} />
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="role">Role</Label>
                    <Select value={newUser.role} onValueChange={(value) => handleSelectChange('role', value)}>
                        <SelectTrigger id="role"><SelectValue placeholder="Select a role" /></SelectTrigger>
                        <SelectContent>
                          {roles.map(role => (
                            <SelectItem key={role.id} value={role.name}>{role.name}</SelectItem>
                          ))}
                        </SelectContent>
                    </Select>
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="status">Status</Label>
                    <Select value={newUser.status} onValueChange={(value) => handleSelectChange('status', value)}>
                        <SelectTrigger id="status"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="Active">Active</SelectItem>
                            <SelectItem value="Inactive">Inactive</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline" onClick={resetAddDialog}>Cancel</Button>
                </DialogClose>
                <Button onClick={handleAddUser}>Add User</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Badge className="hidden sm:inline-flex bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white shadow-sm">
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            Refined UI
          </Badge>
        </div>
      </div>

      <Card className="mb-4 overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-[0_20px_70px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search name, email, role..."
                className="pl-9 bg-white/80 border-white/70"
              />
            </div>
            <div className="grid grid-cols-2 gap-3 md:col-span-2">
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="bg-white/80 border-white/70">
                  <SelectValue placeholder="All Roles" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Roles</SelectItem>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.name}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
                <SelectTrigger className="bg-white/80 border-white/70">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Mobile card list — hidden on md and above */}
      <div className="md:hidden space-y-3 mb-4">
        {displayedUsers.length === 0 ? (
          <p className="text-center text-sm text-slate-600 py-8">No users found.</p>
        ) : (
          displayedUsers.map((user) => (
            <div key={user.id} className="rounded-2xl border border-white/70 bg-white/70 p-4 shadow-sm backdrop-blur space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {user.name?.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase() || '?'}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-sm text-slate-900 truncate">{user.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {user.role && <Badge variant="outline" className="text-xs">{user.role}</Badge>}
                <Badge
                  variant={user.status === 'Active' ? 'default' : 'outline'}
                  className={user.status === 'Active' ? 'bg-emerald-500 text-white text-xs border-0' : 'text-xs'}
                >
                  {user.status || 'Active'}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
                <Link href={`/settings/user-management/${user.id}/logs`}>
                  <Button variant="outline" size="sm" className="w-full h-9 bg-white/70 text-xs">Logs</Button>
                </Link>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canEdit}
                  onClick={() => openEditDialog(user)}
                  className="h-9 bg-white/70 text-xs"
                >
                  Edit
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      <Card className="hidden md:block overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-[0_20px_70px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
        <CardContent className="p-0">
          <ScrollArea className="h-[calc(100vh-22rem)]" showHorizontalScrollbar>
            <Table className="min-w-[980px]">
              <TableHeader className="sticky top-0 z-10 bg-gradient-to-r from-white/90 via-white/80 to-white/90 backdrop-blur border-b border-white/70">
                <TableRow>
                  <TableHead className="text-slate-700">Name</TableHead>
                  <TableHead className="text-slate-700">Email</TableHead>
                  <TableHead className="text-slate-700">Mobile No</TableHead>
                  <TableHead className="text-slate-700">Role</TableHead>
                  <TableHead className="text-slate-700">Status</TableHead>
                  <TableHead className="text-right text-slate-700">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-7 w-20 rounded-full" /></TableCell>
                      <TableCell className="text-right">
                        <Skeleton className="h-8 w-16 inline-block" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : displayedUsers.length > 0 ? (
                  displayedUsers.map((user) => (
                    <TableRow
                      key={user.id}
                      onClick={() => handleRowClick(user.id)}
                      className="cursor-pointer hover:bg-slate-50/70"
                    >
                      <TableCell className="font-semibold text-slate-900">{user.name}</TableCell>
                      <TableCell className="text-slate-700">{user.email}</TableCell>
                      <TableCell className="text-slate-700">{user.mobile}</TableCell>
                      <TableCell className="text-slate-700">{user.role}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            user.status === 'Active'
                              ? 'border-emerald-200/80 bg-emerald-50 text-emerald-700'
                              : 'border-slate-200/80 bg-white/70 text-slate-700'
                          }
                        >
                          {user.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          className="bg-white/70 border-white/70"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditDialog(user);
                          }}
                          disabled={!canEdit}
                        >
                          Edit
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center h-24 text-slate-600">
                      No users found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>
              Update the details of the user. Note: Email and password cannot be changed from this dialog.
            </DialogDescription>
          </DialogHeader>
          {editingUser && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                 <div className="space-y-2">
                    <Label htmlFor="editName">Name</Label>
                    <Input id="editName" value={editingUser.name} onChange={(e) => setEditingUser({...editingUser, name: e.target.value})} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="editEmail">Email</Label>
                    <Input id="editEmail" type="email" value={editingUser.email} disabled />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="editMobile">Mobile No</Label>
                    <Input id="editMobile" value={editingUser.mobile} onChange={(e) => setEditingUser({...editingUser, mobile: e.target.value})} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="editRole">Role</Label>
                    <Select value={editingUser.role} onValueChange={(value: string) => setEditingUser({...editingUser, role: value})}>
                        <SelectTrigger id="editRole"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {roles.map(role => (
                              <SelectItem key={role.id} value={role.name}>{role.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="editStatus">Status</Label>
                    <Select value={editingUser.status} onValueChange={(value: 'Active' | 'Inactive') => setEditingUser({...editingUser, status: value})}>
                        <SelectTrigger id="editStatus"><SelectValue/></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="Active">Active</SelectItem>
                            <SelectItem value="Inactive">Inactive</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={handleUpdateUser}>Update User</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}

    

    
