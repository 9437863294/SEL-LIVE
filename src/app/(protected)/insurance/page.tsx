'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { collection, getDocs } from 'firebase/firestore';
import { ArrowRight, ClipboardCheck, HardHat, ShieldHalf, Users, type LucideIcon } from 'lucide-react';
import { db } from '@/lib/firebase';
import { cn } from '@/lib/utils';
import { useAuthorization } from '@/hooks/useAuthorization';
import { PERSONAL_POLICIES, PROJECT_POLICIES } from '@/lib/insurance-service';
import { personalPolicyState, projectPolicyState } from '@/lib/insurance';
import type { InsurancePolicy, ProjectInsurancePolicy } from '@/lib/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AccessDenied } from '@/components/insurance/insurance-ui';

/** One live count on a section card; `alert` turns it red when it is above zero. */
interface Figure {
  label: string;
  value: number;
  alert?: boolean;
}

const PERSONAL_HREF = '/insurance/dashboard/personal';
const PROJECT_HREF = '/insurance/dashboard/project';
const TASKS_HREF = '/insurance/my-tasks';

/**
 * The module's entry point. Personal and project insurance are separate books, each with its own
 * dashboard and pages, so `/insurance` asks which one to open. The shell renders this route without
 * a sidebar, so the page carries its own header and gutters. Someone who may see only one book is
 * sent straight to it — older links and notifications to /insurance still land.
 */
export default function InsuranceHomePage() {
  const router = useRouter();
  const { can, isLoading } = useAuthorization();

  const canModule = can('View Module', 'Insurance');
  const canPersonal = canModule && can('View', 'Insurance.Personal Insurance');
  const canProject = canModule && can('View', 'Insurance.Project Insurance');
  const canTasks = can('View', 'Insurance.My Tasks');

  // Where to send a viewer who has nothing to choose between; null shows the chooser or the denial.
  const redirect = isLoading ? null
    : canPersonal && canProject ? null
    : canPersonal ? PERSONAL_HREF
    : canProject ? PROJECT_HREF
    : canTasks ? TASKS_HREF
    : null;
  const showChooser = !isLoading && canPersonal && canProject;

  useEffect(() => {
    if (redirect) router.replace(redirect);
  }, [redirect, router]);

  const [personal, setPersonal] = useState<Figure[] | null>(null);
  const [project, setProject] = useState<Figure[] | null>(null);
  const [personalFailed, setPersonalFailed] = useState(false);
  const [projectFailed, setProjectFailed] = useState(false);

  useEffect(() => {
    if (!showChooser) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(collection(db, PERSONAL_POLICIES));
        if (cancelled) return;
        const now = new Date();
        const counts = { inForce: 0, dueSoon: 0, overdue: 0 };
        snap.forEach(d => {
          const state = personalPolicyState(d.data() as InsurancePolicy, now);
          if (state === 'active' || state === 'due-soon' || state === 'grace') counts.inForce++;
          if (state === 'due-soon') counts.dueSoon++;
          if (state === 'grace' || state === 'lapsed') counts.overdue++;
        });
        setPersonal([
          { label: 'In force', value: counts.inForce },
          { label: 'Due in 30 days', value: counts.dueSoon },
          { label: 'Overdue', value: counts.overdue, alert: true },
        ]);
      } catch (e) {
        console.error('Insurance chooser: personal figures failed', e);
        if (!cancelled) setPersonalFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [showChooser]);

  useEffect(() => {
    if (!showChooser) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(collection(db, PROJECT_POLICIES));
        if (cancelled) return;
        const now = new Date();
        const counts = { live: 0, expiring: 0, expired: 0 };
        snap.forEach(d => {
          const state = projectPolicyState(d.data() as ProjectInsurancePolicy, now);
          if (state === 'active' || state === 'expiring') counts.live++;
          if (state === 'expiring') counts.expiring++;
          if (state === 'expired') counts.expired++;
        });
        setProject([
          { label: 'Live policies', value: counts.live },
          { label: 'Expiring (30d)', value: counts.expiring },
          { label: 'Expired', value: counts.expired, alert: true },
        ]);
      } catch (e) {
        console.error('Insurance chooser: project figures failed', e);
        if (!cancelled) setProjectFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [showChooser]);

  if (isLoading || redirect) return <ChooserSkeleton />;
  if (!showChooser) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <AccessDenied what="access the Insurance module" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col px-4 py-8 sm:px-6 sm:py-12">
      <ChooserHeader />

      <div className="mt-8 grid grid-cols-1 gap-4 sm:mt-10 sm:grid-cols-2 sm:gap-6">
        <SectionCard
          href={PERSONAL_HREF}
          icon={Users}
          tone="violet"
          title="Personal Insurance"
          description="Life, health and term policies for people — premiums, maturities and claims."
          figures={personal}
          failed={personalFailed}
        />
        <SectionCard
          href={PROJECT_HREF}
          icon={HardHat}
          tone="emerald"
          title="Project Insurance"
          description="Cover for projects and properties — sites, renewals and expiries."
          figures={project}
          failed={projectFailed}
        />
      </div>

      {canTasks && (
        <div className="mt-6 flex justify-center">
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
            <Link href={TASKS_HREF}>
              <ClipboardCheck className="mr-2 h-4 w-4" aria-hidden />
              My Tasks
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}

function ChooserHeader() {
  return (
    <div className="flex flex-col items-center text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600" aria-hidden>
        <ShieldHalf className="h-6 w-6" />
      </span>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">Insurance</h1>
      <p className="mt-1 text-sm text-muted-foreground sm:text-base">Choose where you want to go</p>
    </div>
  );
}

const TONES = {
  violet: { tile: 'bg-violet-50 text-violet-600', link: 'text-violet-600' },
  emerald: { tile: 'bg-emerald-50 text-emerald-600', link: 'text-emerald-600' },
} as const;

/** A whole-card link into one book, with its live figures. */
function SectionCard({
  href, icon: Icon, tone, title, description, figures, failed,
}: {
  href: string;
  icon: LucideIcon;
  tone: keyof typeof TONES;
  title: string;
  description: string;
  figures: Figure[] | null;
  failed: boolean;
}) {
  const colors = TONES[tone];
  return (
    <Link
      href={href}
      className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
    >
      <Card className="flex h-full flex-col overflow-hidden border-border/60 bg-card transition-all group-hover:-translate-y-0.5 group-hover:shadow-md">
        <CardContent className="flex flex-1 flex-col gap-5 p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-xl', colors.tile)} aria-hidden>
              <Icon className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold leading-tight">{title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            </div>
          </div>

          {!failed && <FigureRow figures={figures} />}

          <div className={cn('mt-auto flex items-center gap-1.5 text-sm font-medium', colors.link)}>
            Open {title}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

/** Three counts side by side; placeholders until the policies have been read. */
function FigureRow({ figures }: { figures: Figure[] | null }) {
  return (
    <dl className="grid grid-cols-3 gap-2 rounded-lg border border-border/60 p-3">
      {figures
        ? figures.map(f => (
            <div key={f.label} className="min-w-0">
              <dt className="truncate text-xs text-muted-foreground">{f.label}</dt>
              <dd className={cn('mt-0.5 text-xl font-semibold tabular-nums', f.alert && f.value > 0 && 'text-red-600')}>
                {f.value.toLocaleString('en-IN')}
              </dd>
            </div>
          ))
        : [0, 1, 2].map(i => (
            <div key={i} className="min-w-0 space-y-1.5">
              <Skeleton className="h-3 w-14" />
              <Skeleton className="h-6 w-8" />
            </div>
          ))}
    </dl>
  );
}

function ChooserSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex flex-col items-center gap-3">
        <Skeleton className="h-12 w-12 rounded-2xl" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-52" />
      </div>
      <div className="mt-8 grid grid-cols-1 gap-4 sm:mt-10 sm:grid-cols-2 sm:gap-6">
        {[0, 1].map(i => <Skeleton key={i} className="h-60 w-full rounded-xl" />)}
      </div>
    </div>
  );
}
