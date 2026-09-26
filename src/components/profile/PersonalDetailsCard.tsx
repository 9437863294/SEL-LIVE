'use client';

import { useEffect, useId, useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { Check, Copy, Loader2, Lock, Mail, Phone, Save, Undo2, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/components/auth/AuthProvider';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { cleanDisplayName } from './profile-photo';

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-8 w-8 shrink-0"
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard blocked (insecure context or permission): nothing to do.
        }
      }}
    >
      {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}

function ReadOnlyField({ id, label, value, icon: Icon, note }: { id: string; label: string; value: string; icon: typeof Mail; note: string }) {
  const noteId = `${id}-note`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="flex items-center gap-1.5">
        {label}
        <Lock className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
      </Label>
      <div className="flex items-center gap-1">
        <div className="relative min-w-0 flex-1">
          <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input id={id} value={value || 'Not on file'} readOnly aria-describedby={noteId} className="bg-muted/40 pl-9 text-muted-foreground" />
        </div>
        <CopyButton value={value} label={label.toLowerCase()} />
      </div>
      <p id={noteId} className="text-xs text-muted-foreground">
        {note}
      </p>
    </div>
  );
}

/**
 * The details a person can see and — for their display name — change.
 *
 * Email and mobile are shown but locked: the email is the sign-in identity, and the mobile number
 * is how Vehicle Management matches a login to its driver record, so letting anyone edit their
 * own would let them claim somebody else's. Both are changed by an administrator.
 */
export function PersonalDetailsCard() {
  const { user, isImpersonating, refreshUserData } = useAuth();
  const { toast } = useToast();
  const { log } = useActivityLogger('Settings');
  const nameId = useId();
  const errorId = useId();
  const saved = user?.name ?? '';
  const [draft, setDraft] = useState(saved);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  // A name saved elsewhere (another tab, an administrator) replaces an untouched field.
  const [shownSaved, setShownSaved] = useState(saved);
  if (saved !== shownSaved) {
    setShownSaved(saved);
    if (!touched) setDraft(saved);
  }

  const { name, error } = cleanDisplayName(draft);
  const dirty = name !== saved.trim();
  const showError = touched && error;

  // Leaving with an unsaved name asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (!user) return null;

  async function save() {
    setTouched(true);
    if (error || !user) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', user.id), { name });
      await refreshUserData();
      void log('Update profile', { changed: ['name'] });
      setTouched(false);
      setDraft(name);
      toast({ title: 'Profile updated', description: 'Your name is updated everywhere in SEL Live.' });
    } catch (e) {
      console.error('Updating the profile failed:', e);
      toast({ title: 'Not saved', description: 'Your change could not be saved. Please try again.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <UserRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <CardTitle className="text-base">Personal details</CardTitle>
        </div>
        <CardDescription>How you appear to colleagues across SEL Live.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="space-y-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Label htmlFor={nameId}>Display name</Label>
          <div className="relative">
            <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              id={nameId}
              value={draft}
              maxLength={90}
              autoComplete="name"
              disabled={isImpersonating || saving}
              aria-invalid={Boolean(showError)}
              aria-describedby={showError ? errorId : undefined}
              onChange={(event) => {
                setDraft(event.target.value);
                setTouched(true);
              }}
              className="pl-9 aria-[invalid=true]:border-danger"
            />
          </div>
          {showError ? (
            <p id={errorId} className="text-xs font-medium text-danger">
              {error}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">Shown on approvals, chats, tasks and reports.</p>
          )}
          {dirty && !isImpersonating && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="submit" size="sm" className="gap-1.5" disabled={saving || Boolean(error)}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                Save name
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="gap-1.5"
                disabled={saving}
                onClick={() => {
                  setDraft(saved);
                  setTouched(false);
                }}
              >
                <Undo2 className="h-4 w-4" aria-hidden="true" /> Discard
              </Button>
            </div>
          )}
        </form>

        <ReadOnlyField id="profile-email" label="Email address" value={user.email} icon={Mail} note="Your sign-in address. An administrator can change it." />
        <ReadOnlyField
          id="profile-mobile"
          label="Mobile number"
          value={user.mobile}
          icon={Phone}
          note="Used to match your driver and HR records, so only an administrator can change it."
        />
        {isImpersonating && (
          <p className="rounded-lg border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
            You are viewing this account as an administrator; its details cannot be edited from here.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
