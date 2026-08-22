'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AlertTriangle, Building2, CalendarCheck, CheckCircle2, Clock, FileText, Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/**
 * The candidate offer portal of spec section 30.
 *
 * A public, unauthenticated page: the person reading it does not have a login yet, and demanding one
 * is how an offer sits unanswered. Everything goes through `/api/hr/offer`, so the page never touches
 * Firestore and the token is the only credential — the API decides what a candidate may see and do.
 *
 * Deliberately plain. This is the first thing a new joiner sees of the company's systems, and a
 * decorated dashboard chrome around a legal document reads wrong.
 */

interface OfferView {
  offerNumber: string;
  candidateName: string;
  designation: string;
  jobTitle: string;
  grade: string;
  departmentName: string;
  projectName: string;
  location: string;
  reportingToName: string;
  employmentType: string;
  offeredCtc: number;
  ctcBreakup: Array<{ component: string; annualAmount: number; monthlyAmount?: number }>;
  joiningBonus: number;
  probationMonths: number | null;
  employmentConditions: string;
  specialConditions: string;
  joiningDate: string;
  validUntil: string;
  letterUrl: string;
  status: string;
}

const rupees = (value: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(
    Number(value) || 0,
  );

const prettyDate = (value: string) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
};

export default function CandidateOfferPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token || '';

  const [offer, setOffer] = useState<OfferView | null>(null);
  const [canRespond, setCanRespond] = useState(false);
  const [validityMessage, setValidityMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const [mode, setMode] = useState<'idle' | 'accepting' | 'declining'>('idle');
  const [declaration, setDeclaration] = useState(false);
  const [signedOfferUrl, setSignedOfferUrl] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<'ACCEPTED' | 'REJECTED' | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch(`/api/hr/offer?token=${encodeURIComponent(token)}`);
      const data = await response.json();
      if (!response.ok) {
        setError(data?.error || 'This offer link is not valid.');
      } else {
        setOffer(data.offer);
        setCanRespond(Boolean(data.canRespond));
        setValidityMessage(data.validity?.message || '');
        if (data.offer?.status === 'ACCEPTED') setOutcome('ACCEPTED');
        if (data.offer?.status === 'REJECTED') setOutcome('REJECTED');
      }
    } catch {
      setError('We could not load your offer. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const respond = async (decision: 'accept' | 'reject') => {
    setSubmitting(true);
    try {
      const response = await fetch('/api/hr/offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          decision,
          declaration: decision === 'accept' ? 'Accepted through the candidate offer portal.' : undefined,
          signedOfferUrl: decision === 'accept' ? signedOfferUrl || undefined : undefined,
          reason: decision === 'reject' ? reason : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data?.error || 'We could not record your response. Please contact HR.');
      } else {
        setOutcome(decision === 'accept' ? 'ACCEPTED' : 'REJECTED');
        setCanRespond(false);
      }
    } catch {
      setError('We could not record your response. Please contact HR.');
    } finally {
      setSubmitting(false);
      setMode('idle');
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-7 w-7 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (error && !offer) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Card className="w-full max-w-md">
          <CardContent className="space-y-3 py-12 text-center">
            <AlertTriangle className="mx-auto h-12 w-12 text-amber-500" />
            <p className="font-semibold text-slate-800">{error}</p>
            <p className="text-sm text-muted-foreground">
              If you believe this is a mistake, please reply to the email you received from our HR team.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!offer) return null;

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="text-center">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
            Your offer of employment
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {offer.offerNumber} · prepared for {offer.candidateName}
          </p>
        </div>

        {outcome === 'ACCEPTED' && (
          <Card className="border-emerald-200 bg-emerald-50">
            <CardContent className="flex items-start gap-3 py-4">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              <div>
                <p className="font-medium text-emerald-900">Thank you — your acceptance is recorded.</p>
                <p className="mt-0.5 text-sm text-emerald-800">
                  Our HR team will be in touch about the documents to bring, and we look forward to seeing you on{' '}
                  {prettyDate(offer.joiningDate)}.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {outcome === 'REJECTED' && (
          <Card className="border-slate-200 bg-white">
            <CardContent className="flex items-start gap-3 py-4">
              <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" />
              <div>
                <p className="font-medium text-slate-800">Your response is recorded.</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Thank you for letting us know. We wish you well, and we would be glad to hear from you again.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {error && offer && (
          <Card className="border-rose-200 bg-rose-50">
            <CardContent className="py-3 text-sm text-rose-800">{error}</CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{offer.jobTitle}</CardTitle>
            <CardDescription>
              {offer.employmentType}
              {offer.grade ? ` · Grade ${offer.grade}` : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {[
                ['Designation', offer.designation],
                ['Department', offer.departmentName || '—'],
                ['Project / site', offer.projectName || '—'],
                ['Location', offer.location || '—'],
                ['Reporting to', offer.reportingToName || '—'],
                ['Annual CTC', rupees(offer.offeredCtc)],
                ['Joining bonus', offer.joiningBonus ? rupees(offer.joiningBonus) : '—'],
                ['Probation', offer.probationMonths ? `${offer.probationMonths} months` : '—'],
                ['Date of joining', prettyDate(offer.joiningDate)],
                ['Offer valid until', prettyDate(offer.validUntil)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
                  <dd className="mt-0.5 text-sm font-medium text-slate-800">{value}</dd>
                </div>
              ))}
            </dl>

            {offer.ctcBreakup.length > 0 && (
              <div className="mt-5 border-t border-slate-100 pt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Compensation breakup
                </p>
                <div className="space-y-1.5">
                  {offer.ctcBreakup.map(line => (
                    <div key={line.component} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-slate-700">{line.component}</span>
                      <span className="tabular-nums font-medium text-slate-800">{rupees(line.annualAmount)}</span>
                    </div>
                  ))}
                  <div className="flex items-baseline justify-between gap-3 border-t border-slate-100 pt-1.5 text-sm font-semibold">
                    <span>Total</span>
                    <span className="tabular-nums">{rupees(offer.offeredCtc)}</span>
                  </div>
                </div>
              </div>
            )}

            {(offer.employmentConditions || offer.specialConditions) && (
              <div className="mt-5 space-y-3 border-t border-slate-100 pt-4">
                {offer.employmentConditions && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Terms of employment
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{offer.employmentConditions}</p>
                  </div>
                )}
                {offer.specialConditions && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Special conditions
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{offer.specialConditions}</p>
                  </div>
                )}
              </div>
            )}

            {offer.letterUrl && (
              <div className="mt-5 border-t border-slate-100 pt-4">
                <Button asChild variant="outline" className="gap-2">
                  <a href={offer.letterUrl} target="_blank" rel="noreferrer">
                    <FileText className="h-4 w-4" /> Open the full offer letter
                  </a>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {canRespond && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Your response</CardTitle>
              <CardDescription className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" /> {validityMessage}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {mode === 'idle' && (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button className="flex-1 gap-2" onClick={() => setMode('accepting')}>
                    <CheckCircle2 className="h-4 w-4" /> Accept this offer
                  </Button>
                  <Button variant="outline" className="flex-1 gap-2" onClick={() => setMode('declining')}>
                    <XCircle className="h-4 w-4" /> Decline
                  </Button>
                </div>
              )}

              {mode === 'accepting' && (
                <div className="space-y-3">
                  <label className="flex items-start gap-2.5">
                    <Checkbox checked={declaration} onCheckedChange={value => setDeclaration(value === true)} />
                    <span className="text-sm text-slate-700">
                      I accept this offer of employment on the terms set out above, and confirm that the information
                      I have provided during the recruitment process is true and complete.
                    </span>
                  </label>

                  <div>
                    <Label className="text-xs">Signed copy (optional)</Label>
                    <Input
                      value={signedOfferUrl}
                      onChange={event => setSignedOfferUrl(event.target.value)}
                      placeholder="A link to your signed copy, if you have one"
                    />
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button className="flex-1 gap-2" disabled={!declaration || submitting} onClick={() => respond('accept')}>
                      {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      Confirm acceptance
                    </Button>
                    <Button variant="ghost" className="flex-1" onClick={() => setMode('idle')} disabled={submitting}>
                      Go back
                    </Button>
                  </div>
                </div>
              )}

              {mode === 'declining' && (
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs">Would you tell us why? (optional)</Label>
                    <Textarea
                      rows={3}
                      value={reason}
                      onChange={event => setReason(event.target.value)}
                      placeholder="It helps us understand how we compare."
                    />
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button variant="destructive" className="flex-1 gap-2" disabled={submitting} onClick={() => respond('reject')}>
                      {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                      Confirm decline
                    </Button>
                    <Button variant="ghost" className="flex-1" onClick={() => setMode('idle')} disabled={submitting}>
                      Go back
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {!canRespond && !outcome && (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="flex items-start gap-3 py-4">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div className="text-sm text-amber-900">
                <p className="font-medium">This offer is not open for a response.</p>
                <p className="mt-0.5">{validityMessage || 'Please contact our HR team.'}</p>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex items-center justify-center gap-1.5 pb-4 text-[11px] text-muted-foreground">
          <Building2 className="h-3 w-3" />
          <span>Questions? Reply to the email you received from our HR team.</span>
          <CalendarCheck className="h-3 w-3" />
        </div>
      </div>
    </div>
  );
}
