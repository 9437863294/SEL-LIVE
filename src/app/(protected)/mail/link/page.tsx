'use client';

/**
 * The link interstitial. Every web link in a displayed email points here first, so the reader sees
 * the real destination — and any warnings — before leaving the ERP. The ERP never fetches the link.
 */

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, ShieldCheck, ShieldX } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { mailApi } from '@/lib/mail-hub/client';

type Check = Awaited<ReturnType<typeof mailApi.linkCheck>>;

export default function MailLinkPage() {
  const params = useSearchParams();
  const url = params?.get('u') ?? '';
  const warning = params?.get('w');
  const [check, setCheck] = useState<Check | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;
    mailApi.linkCheck(url, warning).then(setCheck).catch((caught) => setError(caught instanceof Error ? caught.message : 'This link could not be checked.'));
  }, [url, warning]);

  const unsafe = check?.verdict === 'unsafe';
  return (
    <div className="mx-auto max-w-xl p-4 sm:p-8">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {unsafe ? <ShieldX className="h-5 w-5 text-rose-600" /> : check?.warnings.length ? <AlertTriangle className="h-5 w-5 text-amber-600" /> : <ShieldCheck className="h-5 w-5 text-emerald-600" />}
            You are leaving the ERP
          </CardTitle>
          <CardDescription>This link came from an email. Continue only if you trust where it goes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && <p className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          {check && (
            <>
              <div className="rounded-lg border bg-slate-50 p-3">
                <p className="text-xs text-muted-foreground">Website</p>
                <p className="break-all text-lg font-semibold">{check.host}</p>
                <p className="mt-1 break-all text-xs text-slate-600">{check.url}</p>
              </div>
              {unsafe && <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">Google Safe Browsing lists this site as dangerous ({check.threats.join(', ').toLowerCase().replace(/_/g, ' ')}). Do not open it.</p>}
              {check.warnings.length > 0 && (
                <ul className="list-disc space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 pl-8 text-sm text-amber-900">
                  {check.warnings.map((entry) => <li key={entry}>{entry}</li>)}
                </ul>
              )}
              {!check.checkedWithSafeBrowsing && <p className="text-xs text-muted-foreground">This server does not check links against a threat list.</p>}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => window.close()}>Close</Button>
                {!unsafe && (
                  <Button asChild variant={check.warnings.length ? 'outline' : 'default'}>
                    <a href={check.url} rel="noopener noreferrer nofollow">
                      Continue to {check.host} <ExternalLink className="ml-2 h-4 w-4" />
                    </a>
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
