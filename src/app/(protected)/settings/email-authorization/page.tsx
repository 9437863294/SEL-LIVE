'use client';

import Link from 'next/link';
import { ArrowLeft, MailCheck, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuthorization } from '@/hooks/useAuthorization';
import { AuroraBackdrop } from '@/components/effects/AuroraBackdrop';

export default function EmailAuthorizationPage() {
  const { can, isLoading } = useAuthorization();

  const canView = can('View', 'Settings.Email Authorization');
  const canSend = can('Send Request', 'Settings.Email Authorization');
  const canRevoke = can('Revoke', 'Settings.Email Authorization');

  if (isLoading) {
    return (
      <div className="relative min-h-[calc(100vh-4rem)] overflow-hidden px-4 py-6 sm:px-6 lg:px-8">
        <AuroraBackdrop />
        <Card className="overflow-hidden rounded-2xl border border-white/70 bg-white/70 backdrop-blur">
          <CardContent className="p-8">
            <div className="h-6 w-56 rounded bg-slate-200/70" />
            <div className="mt-3 h-4 w-96 max-w-full rounded bg-slate-200/60" />
            <div className="mt-6 h-24 w-full rounded bg-slate-200/40" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="relative min-h-[calc(100vh-4rem)] overflow-hidden px-4 py-6 sm:px-6 lg:px-8">
        <AuroraBackdrop />
        <div className="mb-6 flex items-center gap-4">
          <Link href="/settings">
            <Button variant="ghost" size="icon" className="rounded-full bg-white/70 shadow-sm backdrop-blur hover:bg-white/90">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Email Authorization</h1>
        </div>
        <Card className="overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-[0_20px_70px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You do not have permission to view this page. Please contact an administrator.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center p-8">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-hidden px-4 py-6 sm:px-6 lg:px-8">
      <AuroraBackdrop />

      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-start gap-4">
          <Link href="/settings">
            <Button variant="ghost" size="icon" className="rounded-full bg-white/70 shadow-sm backdrop-blur hover:bg-white/90">
              <ArrowLeft className="h-6 w-6" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">Email Authorization</h1>
              <Badge variant="outline" className="border-white/70 bg-white/70 text-slate-700 backdrop-blur">
                Settings
              </Badge>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              Manage authorization requests for integrated email services.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button disabled={!canSend} className="shadow-[0_18px_60px_-45px_rgba(2,6,23,0.55)]">
            <MailCheck className="mr-2 h-4 w-4" />
            Send Request
          </Button>
          <Button variant="outline" className="bg-white/70 border-white/70" disabled={!canRevoke}>
            Revoke
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-[0_20px_70px_-55px_rgba(2,6,23,0.55)] backdrop-blur">
        <CardHeader>
          <CardTitle>Not Configured Yet</CardTitle>
          <CardDescription>
            This page is now available (no more 404), but the underlying email authorization workflow is not connected in this build.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-slate-700">
          <p className="rounded-xl border border-white/70 bg-white/70 p-4">
            When you are ready, we can wire this to your actual provider (Gmail / Outlook / SMTP) and store request state
            in Firestore.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

