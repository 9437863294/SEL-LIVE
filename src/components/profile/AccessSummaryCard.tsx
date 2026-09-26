'use client';

/**
 * "Roles and access" on the Profile page — what the signed-in account can do, and why. Read-only.
 *
 * ── Where every value comes from ────────────────────────────────────────────────────────────────
 *
 *   useAuth().effectiveAccess     `resolveEffectiveAccess` (`src/lib/access-control.ts`), already
 *                                 computed and kept live by AuthProvider: base role, additional
 *                                 roles, temporary grants and their windows, project / department /
 *                                 designation scopes, and per-permission provenance (`sources`).
 *   useAuthorization().can        `can('View Module', name)` over `Object.keys(permissionModules)` —
 *                                 the same test the Module Hub uses to decide which cards to show.
 *   MODULE_LABELS (Breadcrumbs)   route segment → module name, inverted here to link each chip.
 *   projects/{id}, departments/{id}
 *                                 one `getDoc` per scope id whose name the grant provenance does not
 *                                 already carry — usually none, because a project grant records its
 *                                 `projectName`. Capped, and a failed read degrades to a count.
 *
 * This card never grants, requests or revokes anything: every change goes through an administrator
 * on Access Management, which is where the conflict checks and the audit trail live.
 */

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { doc, getDoc } from 'firebase/firestore';
import {
  Building2,
  CircleX,
  Clock,
  Eye,
  FolderKanban,
  Info,
  KeyRound,
  LayoutGrid,
  ShieldCheck,
  TriangleAlert,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { MODULE_LABELS } from '@/components/app/Breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import {
  daysUntilExpiry,
  formatGrantDate,
  type EffectiveAccess,
  type PermissionSource,
} from '@/lib/access-control';
import { db } from '@/lib/firebase';
import { permissionModules } from '@/lib/permissions';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------------------------------------
 * Module routes
 * ---------------------------------------------------------------------------------------------- */

/**
 * Module name → its route, inverted from the breadcrumb map.
 *
 * Later entries win, which is what the LC module needs: its two legacy segments come first in
 * `MODULE_LABELS` and only redirect, and `letter-of-credit` comes last.
 */
const MODULE_ROUTES: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [segment, label] of Object.entries(MODULE_LABELS)) out[label] = `/${segment}`;
  return out;
})();

/**
 * The route for a module, or null when none is known.
 *
 * Falls back to the Module Hub's own slug rule for names whose folder is spelled like the module
 * ("Site Fund Requisition 2" → `/site-fund-requisition-2`), but only when that folder is one the
 * breadcrumb map knows — a guessed URL that 404s is worse than a chip that does not link.
 */
function moduleRoute(name: string): string | null {
  if (MODULE_ROUTES[name]) return MODULE_ROUTES[name];
  const slug = name.toLowerCase().replace(/\s+/g, '-');
  return MODULE_LABELS[slug] ? `/${slug}` : null;
}

const MODULE_NAMES = Object.keys(permissionModules);

/** Chips shown before "Show all" — about three rows at 360px. */
const MODULES_COLLAPSED = 12;

/* ------------------------------------------------------------------------------------------------
 * Reading the provenance
 * ---------------------------------------------------------------------------------------------- */

type ScopeKind = 'Project' | 'Department';

interface SourceSummary {
  /** Additional role name → the earliest expiry of any assignment of it. */
  roleExpiry: Map<string, string>;
  /** `${kind}:${id}` → the name the grant recorded for it. */
  scopeNames: Map<string, string>;
  /** Distinct `resource::action` pairs held through a direct grant. */
  directCount: number;
}

const scopeKey = (kind: ScopeKind, id: string) => `${kind}:${id}`;

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * One pass over `sources`.
 *
 * The same source object is attached to every permission its grant gives, so it is visited once per
 * permission but read once per grant.
 */
function summariseSources(access: EffectiveAccess | null): SourceSummary {
  const roleExpiry = new Map<string, string>();
  const scopeNames = new Map<string, string>();
  const direct = new Set<string>();
  const seen = new Set<PermissionSource>();

  for (const [key, list] of Object.entries(access?.sources ?? {})) {
    for (const source of list) {
      if (source.kind === 'Direct Permission') direct.add(key);
      if (seen.has(source)) continue;
      seen.add(source);

      if (source.kind === 'Additional Role' && source.expiresAt) {
        const previous = roleExpiry.get(source.label);
        if (!previous || Date.parse(source.expiresAt) < Date.parse(previous)) {
          roleExpiry.set(source.label, source.expiresAt);
        }
      }
      if ((source.kind === 'Project' || source.kind === 'Department') && source.refId) {
        const label = text(source.label);
        if (label && label !== source.refId) scopeNames.set(scopeKey(source.kind, source.refId), label);
      }
    }
  }
  return { roleExpiry, scopeNames, directCount: direct.size };
}

/* ------------------------------------------------------------------------------------------------
 * Scope names the provenance does not carry
 * ---------------------------------------------------------------------------------------------- */

/** Enough for anyone's real assignments; beyond it the rest are counted rather than read. */
const MAX_NAME_LOOKUPS = 20;

async function readScopeName(kind: ScopeKind, id: string): Promise<string> {
  try {
    const snapshot = await getDoc(doc(db, kind === 'Project' ? 'projects' : 'departments', id));
    if (!snapshot.exists()) return '';
    const data = snapshot.data();
    return kind === 'Project' ? text(data.projectName) || text(data.siteCode) : text(data.name);
  } catch {
    // A rules denial or an offline read: the chip list falls back to a count.
    return '';
  }
}

function useScopeNames(
  projectIds: readonly string[],
  departmentIds: readonly string[],
  known: Map<string, string>,
): { names: Map<string, string>; pending: boolean } {
  const lookupKey = useMemo(() => {
    const wanted: Array<[ScopeKind, string]> = [];
    for (const id of projectIds) if (!known.has(scopeKey('Project', id))) wanted.push(['Project', id]);
    for (const id of departmentIds) if (!known.has(scopeKey('Department', id))) wanted.push(['Department', id]);
    return JSON.stringify(wanted.slice(0, MAX_NAME_LOOKUPS));
  }, [projectIds, departmentIds, known]);

  const [lookup, setLookup] = useState<{ key: string; names: Record<string, string> } | null>(null);

  useEffect(() => {
    const wanted = JSON.parse(lookupKey) as Array<[ScopeKind, string]>;
    if (!wanted.length) return;
    let cancelled = false;
    void Promise.all(
      wanted.map(async ([kind, id]) => [scopeKey(kind, id), await readScopeName(kind, id)] as const),
    ).then((entries) => {
      if (cancelled) return;
      const names: Record<string, string> = {};
      for (const [key, name] of entries) if (name) names[key] = name;
      setLookup({ key: lookupKey, names });
    });
    return () => {
      cancelled = true;
    };
  }, [lookupKey]);

  const settled = lookup?.key === lookupKey ? lookup.names : null;
  const names = useMemo(() => {
    if (!settled) return known;
    const merged = new Map(known);
    for (const [key, name] of Object.entries(settled)) merged.set(key, name);
    return merged;
  }, [known, settled]);

  return { names, pending: lookupKey !== '[]' && !settled };
}

/* ------------------------------------------------------------------------------------------------
 * Presentation pieces
 * ---------------------------------------------------------------------------------------------- */

function SectionHeading({ id, icon: Icon, children }: { id: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <h3 id={id} className="flex items-center gap-1.5 text-sm font-semibold">
      <Icon aria-hidden className="h-4 w-4 text-muted-foreground" />
      {children}
    </h3>
  );
}

const TAG_CLASS = 'rounded-full border bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground';

/** "until 12-Oct-2026", flagged with an icon and words when it is close — never colour alone. */
function Expiry({ at, prefix = 'until' }: { at: string; prefix?: string }) {
  const days = daysUntilExpiry({ expiresAt: at });
  const soon = prefix === 'until' && days !== null && days <= 3;
  const Icon = soon ? TriangleAlert : Clock;
  return (
    <span className={cn('flex items-center gap-1 text-xs', soon ? 'text-warning' : 'text-muted-foreground')}>
      <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <span>
        {prefix} {formatGrantDate(at)}
        {soon && days !== null && (
          <span className="font-medium">
            {' '}
            — {days <= 0 ? 'ends today' : `ends in ${days} ${days === 1 ? 'day' : 'days'}`}
          </span>
        )}
      </span>
    </span>
  );
}

function RoleRow({
  name,
  tag,
  children,
}: {
  name: string;
  tag: string;
  children?: ReactNode;
}) {
  return (
    <li className="rounded-md border px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 break-words text-sm font-medium">{name}</span>
        <span className={TAG_CLASS}>{tag}</span>
      </div>
      {children && <div className="mt-1 space-y-0.5">{children}</div>}
    </li>
  );
}

const CHIP_CLASS =
  'inline-flex max-w-full items-center rounded-full border bg-muted/40 px-2.5 py-1 text-xs font-medium';

function ScopeGroup({
  icon,
  label,
  noun,
  kind,
  ids,
  names,
  pending,
}: {
  icon: LucideIcon;
  label: string;
  noun: [string, string];
  kind: ScopeKind;
  ids: readonly string[];
  names: Map<string, string>;
  pending: boolean;
}) {
  const headingId = useId();
  if (!ids.length) return null;
  const named = ids.map((id) => names.get(scopeKey(kind, id))).filter((name): name is string => Boolean(name));
  const unnamed = ids.length - named.length;
  const Icon = icon;

  return (
    <div className="space-y-1.5">
      <p id={headingId} className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon aria-hidden className="h-3.5 w-3.5" />
        {label} ({ids.length})
      </p>
      <ul aria-labelledby={headingId} className="flex flex-wrap gap-1.5">
        {named.map((name) => (
          <li key={name} className={CHIP_CLASS}>
            <span className="truncate">{name}</span>
          </li>
        ))}
        {unnamed > 0 &&
          (pending ? (
            <li aria-hidden>
              <Skeleton className="h-6 w-24 rounded-full" />
            </li>
          ) : (
            <li className={cn(CHIP_CLASS, 'text-muted-foreground')}>
              {named.length ? `+${unnamed} more` : `${unnamed} ${unnamed === 1 ? noun[0] : noun[1]}`}
            </li>
          ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * The card
 * ---------------------------------------------------------------------------------------------- */

const EMPTY_IDS: readonly string[] = [];

export function AccessSummaryCard({ className }: { className?: string }) {
  const { user, effectiveAccess, loading, isImpersonating, originalUser } = useAuth();
  const { can } = useAuthorization();
  const titleId = useId();
  const rolesId = useId();
  const scopeId = useId();
  const modulesId = useId();
  const [showAllModules, setShowAllModules] = useState(false);

  const summary = useMemo(() => summariseSources(effectiveAccess), [effectiveAccess]);
  const projectIds = effectiveAccess?.projectIds ?? EMPTY_IDS;
  const departmentIds = effectiveAccess?.departmentIds ?? EMPTY_IDS;
  const designations = effectiveAccess?.designations ?? EMPTY_IDS;
  const { names, pending } = useScopeNames(projectIds, departmentIds, summary.scopeNames);

  const modules = useMemo(() => MODULE_NAMES.filter((name) => can('View Module', name)), [can]);

  const baseRole = text(effectiveAccess?.baseRoleName) || text(user?.role);
  const additionalRoles = (effectiveAccess?.additionalRoleNames ?? []).filter((name) => name !== baseRole);
  const temporaryActive = effectiveAccess?.temporaryActive ?? [];
  const temporaryUpcoming = effectiveAccess?.temporaryUpcoming ?? [];
  const hasRoles =
    Boolean(baseRole) ||
    additionalRoles.length > 0 ||
    temporaryActive.length > 0 ||
    temporaryUpcoming.length > 0 ||
    summary.directCount > 0;
  const hasScopes = projectIds.length > 0 || departmentIds.length > 0 || designations.length > 0;

  const visibleModules =
    showAllModules || modules.length <= MODULES_COLLAPSED ? modules : modules.slice(0, MODULES_COLLAPSED);

  const whose = isImpersonating ? 'This account' : 'You';

  let body: ReactNode;
  if (loading) {
    body = (
      <div role="status" aria-live="polite" className="space-y-4">
        <span className="sr-only">Loading roles and access…</span>
        <div className="space-y-2" aria-hidden>
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
        <div className="space-y-2" aria-hidden>
          <Skeleton className="h-4 w-32" />
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-6 w-24 rounded-full" />
            ))}
          </div>
        </div>
      </div>
    );
  } else if (!user) {
    body = (
      <p className="flex items-start gap-2 text-sm">
        <CircleX aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
        <span>Your access could not be loaded. Refresh the page to try again.</span>
      </p>
    );
  } else {
    body = (
      <div className="space-y-5">
        {/* ── Roles ── */}
        <section aria-labelledby={rolesId} className="space-y-2">
          <SectionHeading id={rolesId} icon={KeyRound}>
            Roles
          </SectionHeading>
          {hasRoles ? (
            <ul className="space-y-1.5">
              {baseRole && <RoleRow name={baseRole} tag="Base role" />}
              {additionalRoles.map((name) => {
                const expiry = summary.roleExpiry.get(name);
                return (
                  <RoleRow key={`additional-${name}`} name={name} tag="Additional role">
                    {expiry && <Expiry at={expiry} />}
                  </RoleRow>
                );
              })}
              {temporaryActive.map((grant) => (
                <RoleRow key={`temporary-${grant.id}`} name={grant.roleName || 'Temporary access'} tag="Temporary">
                  <Expiry at={grant.expiresAt} />
                  {grant.reason && <p className="break-words text-xs text-muted-foreground">Reason: {grant.reason}</p>}
                </RoleRow>
              ))}
              {temporaryUpcoming.map((grant) => (
                <RoleRow key={`upcoming-${grant.id}`} name={grant.roleName || 'Temporary access'} tag="Scheduled">
                  <Expiry at={grant.startAt} prefix="starts" />
                  <Expiry at={grant.expiresAt} />
                </RoleRow>
              ))}
              {summary.directCount > 0 && (
                <RoleRow name="Individual permissions" tag="Direct">
                  <p className="text-xs text-muted-foreground">
                    {summary.directCount} {summary.directCount === 1 ? 'permission' : 'permissions'} granted to{' '}
                    {isImpersonating ? 'this account' : 'you'} directly, outside any role.
                  </p>
                </RoleRow>
              )}
            </ul>
          ) : (
            <p className="rounded-md border border-dashed bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
              No role is assigned to {isImpersonating ? 'this account' : 'your account'} yet.
            </p>
          )}
        </section>

        {/* ── Scopes ── */}
        <section aria-labelledby={scopeId} className="space-y-2">
          <SectionHeading id={scopeId} icon={FolderKanban}>
            Projects and departments
          </SectionHeading>
          {hasScopes ? (
            <div className="space-y-3">
              <ScopeGroup
                icon={FolderKanban}
                label="Projects and sites"
                noun={['project', 'projects']}
                kind="Project"
                ids={projectIds}
                names={names}
                pending={pending}
              />
              <ScopeGroup
                icon={Building2}
                label="Departments"
                noun={['department', 'departments']}
                kind="Department"
                ids={departmentIds}
                names={names}
                pending={pending}
              />
              {designations.length > 0 && (
                <div className="space-y-1.5">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Users aria-hidden className="h-3.5 w-3.5" />
                    Designation groups ({designations.length})
                  </p>
                  <ul aria-label="Designation groups" className="flex flex-wrap gap-1.5">
                    {designations.map((name) => (
                      <li key={name} className={CHIP_CLASS}>
                        <span className="truncate">{name}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No project or department assignments. {whose === 'You' ? 'Your' : 'Its'} access comes from the roles
              above.
            </p>
          )}
        </section>

        {/* ── Modules ── */}
        <section aria-labelledby={modulesId} className="space-y-2">
          <SectionHeading id={modulesId} icon={LayoutGrid}>
            Modules {isImpersonating ? 'this account' : 'you'} can open
            <span className={TAG_CLASS}>
              <span className="sr-only">Count: </span>
              {modules.length}
            </span>
          </SectionHeading>
          {modules.length ? (
            <>
              <ul className="flex flex-wrap gap-1.5">
                {visibleModules.map((name) => {
                  const href = moduleRoute(name);
                  return (
                    <li key={name} className="max-w-full">
                      {href ? (
                        <Link
                          href={href}
                          className={cn(
                            CHIP_CLASS,
                            'transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          )}
                        >
                          <span className="truncate">{name}</span>
                        </Link>
                      ) : (
                        <span className={CHIP_CLASS}>
                          <span className="truncate">{name}</span>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              {modules.length > MODULES_COLLAPSED && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="-ml-2"
                  aria-expanded={showAllModules}
                  onClick={() => setShowAllModules((value) => !value)}
                >
                  {showAllModules ? 'Show fewer' : `Show all ${modules.length}`}
                </Button>
              )}
            </>
          ) : (
            <p className="rounded-md border border-dashed bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
              {whose} can&apos;t open any modules yet.
            </p>
          )}
        </section>
      </div>
    );
  }

  return (
    <Card role="region" className={cn('min-w-0', className)} aria-labelledby={titleId}>
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ShieldCheck aria-hidden className="h-5 w-5" />
          </span>
          <div className="min-w-0 space-y-1">
            <CardTitle id={titleId} role="heading" aria-level={2} className="text-base">
              Roles and access
            </CardTitle>
            <CardDescription>
              {isImpersonating
                ? 'What this account can open, and where that access comes from.'
                : 'What you can open, and where that access comes from.'}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isImpersonating && user && (
          <p className="flex items-start gap-2 rounded-md border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            <Eye aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              You&apos;re viewing <span className="font-medium text-foreground">{user.name || 'this user'}</span>
              &apos;s account{originalUser?.name ? ` as ${originalUser.name}` : ''}. This is their access, not yours.
            </span>
          </p>
        )}

        {body}

        {!loading && user && (
          <p className="flex items-start gap-2 border-t pt-3 text-xs text-muted-foreground">
            <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              To change {isImpersonating ? 'this' : 'your'} access, ask an administrator. Temporary access ends on
              its own on the date shown.
            </span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
