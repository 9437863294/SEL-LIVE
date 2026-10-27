'use client';

// TEMPORARY verification probe — delete before committing. No data, no Firestore.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { PageHeader } from '@/components/shared/page-header';
import { markReplaceOnPlainClick, useBackNavigation } from '@/hooks/use-back-navigation';
import { markNextNavigationAsReplace, noteAddressChange } from '@/lib/navigation-history';

const B = '/back-probe';
const TABS = ['overview', 'users', 'assign'];

// A copy of the Access Control Center's `keepTabInAddress`.
function keepTabInAddress(tab: string) {
  const url = new URL(window.location.href);
  url.searchParams.delete('assignTo');
  if (tab === 'overview') url.searchParams.delete('tab');
  else url.searchParams.set('tab', tab);
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (next === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
  window.history.replaceState(null, '', next);
  noteAddressChange();
}

const FALLBACK: Record<string, string> = {
  '': '/',
  other: '/',
  dept: B,
  access: B,
  'access/users/U1': `${B}/access?tab=users`,
  'access/users/new': `${B}/access`,
  appearance: B,
  'appearance/themes': B,
};

export default function BackProbe() {
  const params = useParams<{ slug?: string[] }>();
  const path = (params?.slug ?? []).join('/');
  const router = useRouter();
  const back = useBackNavigation(FALLBACK[path] ?? B, { replace: path === 'access/users/new' });

  const [tab, setTabState] = useState('overview');
  const setTab = useCallback((next: string) => {
    setTabState(next);
    keepTabInAddress(next);
  }, []);
  useEffect(() => {
    if (path !== 'access') return;
    const search = new URLSearchParams(window.location.search);
    if (search.get('assignTo')) {
      setTab('assign');
      return;
    }
    const requested = search.get('tab');
    if (requested && TABS.includes(requested)) setTab(requested);
  }, [path, setTab]);
  useEffect(() => {
    const follow = () => setTabState(new URLSearchParams(window.location.search).get('tab') ?? 'overview');
    window.addEventListener('popstate', follow);
    return () => window.removeEventListener('popstate', follow);
  }, []);

  const section = (id: string, href: string) => (
    <Link id={id} href={href} replace onClick={markReplaceOnPlainClick}>
      {id}
    </Link>
  );

  return (
    <div className="space-y-3 p-6">
      <PageHeader title={path || 'hub'} backHref={back.href} backLabel={back.label} onBackClick={back.onClick} />
      <pre id="probe-result">{JSON.stringify({ path, tab: path === 'access' ? tab : null, backHref: back.href, backLabel: back.label })}</pre>
      <nav className="flex flex-wrap gap-3">
        <Link id="to-hub" href={B}>hub</Link>
        <Link id="to-other" href={`${B}/other`}>other</Link>
        <Link id="to-dept" href={`${B}/dept`}>dept</Link>
        <Link id="to-access" href={`${B}/access`}>access</Link>
        <Link id="to-appearance" href={`${B}/appearance`}>appearance</Link>
      </nav>
      {path === 'access' && (
        <div className="flex gap-3">
          {TABS.map((id) => (
            <button key={id} id={`tab-${id}`} type="button" onClick={() => setTab(id)}>
              {id}
            </button>
          ))}
          <Link id="to-user" href={`${B}/access/users/U1`}>user U1</Link>
          <Link id="to-new" href={`${B}/access/users/new?returnTo=${encodeURIComponent(`${B}/access`)}`}>new user</Link>
        </div>
      )}
      {path === 'access/users/U1' && (
        <Link id="add-access" href={`${B}/access?assignTo=U1`}>add access</Link>
      )}
      {path === 'access/users/new' && (
        <div className="flex gap-3">
          <button
            id="create"
            type="button"
            onClick={() => {
              markNextNavigationAsReplace();
              router.replace(`${B}/access?assignTo=N1`);
            }}
          >
            create
          </button>
          <button id="cancel" type="button" onClick={() => back.go()}>
            cancel
          </button>
        </div>
      )}
      {path.startsWith('appearance') && (
        <div className="flex gap-3">
          {section('sec-my', `${B}/appearance`)}
          {section('sec-themes', `${B}/appearance/themes`)}
        </div>
      )}
    </div>
  );
}
