'use client';

/**
 * The identity half of a user's profile — name, mobile, base role, password reset.
 *
 * ── Why this is here and not on a screen of its own ────────────────────────────────────────────
 *
 * It used to be a dialog on `/settings/user-management`, a screen that existed alongside this one
 * and overlapped it heavily: both listed every user, both filtered by role and status, both linked
 * out to greytHR linking. What it did *not* share was this — editing the user record itself. The
 * two screens were merged rather than kept in step, and this is the piece that had nowhere else to
 * go.
 *
 * It sits on the profile page rather than in a dialog on the register for the same reason the role
 * builder and the add-user form are pages: "change Amit's base role" is a considered action with an
 * address, and the profile is already the page that answers "what can Amit do".
 *
 * ── The base role is still not an additive grant ───────────────────────────────────────────────
 *
 * Everything else on this page adds access on top of `users.role`. This card is the one place that
 * writes the field itself, which is why it goes through `updateUserIdentity` and its own
 * administration guard rather than through `grantAccess`. Merging the screens did not merge that
 * distinction — see the note on `updateUserIdentity`.
 */

import * as React from 'react';
import { useMemo, useState } from 'react';
import { KeyRound, Loader2, Save } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import type { Role, User } from '@/lib/types';
import {
  updateUserIdentity,
  type AccessActor,
  type AccessDirectory,
} from '@/lib/access-control-service';
import { AccessCard } from './access-ui';

export interface UserIdentityCardProps {
  user: User;
  roles: Role[];
  directory: Pick<AccessDirectory, 'users' | 'roles' | 'grants' | 'scopeGrants'>;
  actor: AccessActor;
  /** `Settings.User Management · Edit` — the same permission the old screen required. */
  canEdit: boolean;
  /** Refreshes the directory so the rest of the profile re-derives from the new base role. */
  onSaved: () => void | Promise<void>;
}

export function UserIdentityCard({
  user,
  roles,
  directory,
  actor,
  canEdit,
  onSaved,
}: UserIdentityCardProps) {
  const { toast } = useToast();

  const [name, setName] = useState(user.name ?? '');
  const [mobile, setMobile] = useState(user.mobile ?? '');
  const [role, setRole] = useState(user.role ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [isSendingReset, setIsSendingReset] = useState(false);

  // Set when saving would move the signed-in administrator off a role that can still manage users.
  // `updateUserIdentity` independently refuses to strand the *system*; this is the softer case that
  // guard allows — you remain recoverable because somebody else can fix it, but you would not be
  // able to fix it yourself, and it is easy to do by accident.
  const [pendingSelfRoleChange, setPendingSelfRoleChange] = useState<string | null>(null);

  const isSelf = user.id === actor.userId;
  const knownRoleNames = useMemo(() => new Set(roles.map((r) => r.name)), [roles]);

  const dirty =
    name.trim() !== (user.name ?? '') || mobile.trim() !== (user.mobile ?? '') || role !== (user.role ?? '');

  const roleGrantsUserAdministration = (roleName: string) => {
    const match = roles.find((r) => r.name === roleName);
    if (!match) return false;
    return (match.permissions?.['Settings.User Management'] ?? []).includes('Edit');
  };

  const persist = async () => {
    setPendingSelfRoleChange(null);
    setIsSaving(true);
    try {
      const result = await updateUserIdentity(user, { name, mobile, role }, directory, actor);
      if (!result.ok) {
        toast({ title: 'Cannot save', description: result.message, variant: 'destructive' });
        return;
      }
      toast({ title: 'Saved', description: `${name.trim() || user.email} has been updated.` });
      await onSaved();
    } catch (error) {
      console.error('Error updating user identity: ', error);
      toast({ title: 'Error', description: 'Failed to update the user.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast({ title: 'Name is required', variant: 'destructive' });
      return;
    }
    if (isSelf && role !== (user.role ?? '') && !roleGrantsUserAdministration(role)) {
      setPendingSelfRoleChange(role);
      return;
    }
    await persist();
  };

  const sendPasswordReset = async () => {
    if (!user.email) return;
    setIsSendingReset(true);
    try {
      await fetch('/api/send-password-reset-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email }),
      });
      toast({
        title: 'Reset email sent',
        description: `If ${user.email} has an account, a password reset link was sent to it.`,
      });
    } catch (error) {
      console.error('Error sending password reset email: ', error);
      toast({ title: 'Error', description: 'Failed to send password reset email.', variant: 'destructive' });
    } finally {
      setIsSendingReset(false);
    }
  };

  return (
    <>
      <AccessCard>
        <CardHeader className="px-4 py-3">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm">Account</CardTitle>
            {isSelf && (
              <Badge variant="outline" className="border-sky-200 bg-sky-50 text-xs text-sky-700">
                This is you
              </Badge>
            )}
          </div>
          <CardDescription className="text-xs">
            The user's own record. The base role is stored here, not granted — everything else on this
            page adds on top of it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 px-4 pb-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="identity-name" className="text-xs">
                Name
              </Label>
              <Input
                id="identity-name"
                value={name}
                disabled={!canEdit}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="identity-email" className="text-xs">
                Email
              </Label>
              {/* The Identity Toolkit login. Changing it here would desynchronise the two records. */}
              <Input id="identity-email" type="email" value={user.email ?? ''} disabled />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="identity-mobile" className="text-xs">
                Mobile no
              </Label>
              <Input
                id="identity-mobile"
                value={mobile}
                disabled={!canEdit}
                onChange={(event) => setMobile(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="identity-role" className="text-xs">
                Base role
              </Label>
              <Select value={role} disabled={!canEdit} onValueChange={setRole}>
                <SelectTrigger id="identity-role">
                  <SelectValue placeholder="No primary role assigned" />
                </SelectTrigger>
                <SelectContent>
                  {/* A role can be renamed or disabled out from under a user; show what the record
                      actually says rather than an empty select that would silently overwrite it. */}
                  {role && !knownRoleNames.has(role) && (
                    <SelectItem value={role} disabled>
                      {role} (no longer exists)
                    </SelectItem>
                  )}
                  {roles.map((option) => (
                    <SelectItem key={option.id} value={option.name}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {canEdit && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-3.5 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-700">Forgot their password?</p>
                <p className="truncate text-xs text-slate-500">Sends a reset link to {user.email}.</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 bg-white"
                disabled={isSendingReset || !user.email}
                onClick={sendPasswordReset}
              >
                {isSendingReset ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <KeyRound className="mr-2 h-4 w-4" />
                )}
                Send reset email
              </Button>
            </div>
          )}

          {canEdit && (
            <div className="flex justify-end">
              <Button size="sm" disabled={!dirty || isSaving} onClick={handleSave}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save changes
              </Button>
            </div>
          )}
        </CardContent>
      </AccessCard>

      <AlertDialog
        open={!!pendingSelfRoleChange}
        onOpenChange={(open) => !open && setPendingSelfRoleChange(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change your own base role?</AlertDialogTitle>
            <AlertDialogDescription>
              You're changing your own role to &quot;{pendingSelfRoleChange}&quot;, which does not include
              Edit access to User Management. If you continue, you may not be able to manage users or roles
              yourself afterward — you'd need another administrator to fix it. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void persist()}>Continue</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
