'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Plane, PlaneTakeoff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import {
  TOUR_STATUSES,
  TOUR_TYPES,
  TT_COLLECTIONS,
  matchesTravelScope,
  roundMoney,
  travelStatusLabel,
  type TravelRequest,
} from '@/lib/tour-travel';
import { TT_PERMISSION_MODULE } from './module-layout-shell';
import { useTravelCollection } from './use-travel-config';
import { useGlobalScopes } from '@/components/recurring-payments/use-global-scopes';
import { Money, TravelEmptyState, TravelLoader } from './travel-ui';
import { PageHeader } from '@/components/shared/page-header';
import { CellLink, DataList } from '@/components/shared/data-list';
import { FilterBar } from '@/components/shared/filter-bar';
import { StatusBadge } from '@/components/shared/status-badge';
import { TableCard } from '@/components/shared/table-card';

/**
 * The organization-wide tour register.
 *
 * Scoped by `View All`: without it a user sees only tours they travel on or approve, which is what
 * makes this route safe to expose to every employee rather than maintaining a second "my tours"
 * query. Project and department filters go through `matchesTravelScope` so a project renamed after a
 * tour was raised still matches.
 */
export default function TourRequestRegister() {
  const { user } = useAuth();
  const { can } = useAuthorization();
  const { records, loading } = useTravelCollection<TravelRequest>(TT_COLLECTIONS.requests);
  const { activeProjects, departments } = useGlobalScopes();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [tourType, setTourType] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const canViewAll = can('View All', `${TT_PERMISSION_MODULE}.Tour Requests`);

  const visible = useMemo(() => {
    const mine = (request: TravelRequest) =>
      request.employeeUserId === user?.id ||
      request.createdBy === user?.id ||
      (request.currentApprovers || []).includes(user?.id || '');
    return records.filter(request => !request.deleted && (canViewAll || mine(request)));
  }, [records, canViewAll, user?.id]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return visible
      .filter(request => {
        if (status !== 'all' && request.status !== status) return false;
        if (tourType !== 'all' && request.tourType !== tourType) return false;
        if (!matchesTravelScope(projectFilter, { id: request.projectId, name: request.projectName }, activeProjects.map(p => ({ id: p.id, name: p.projectName })))) return false;
        if (!matchesTravelScope(departmentFilter, { id: request.departmentId, name: request.departmentName }, departments.map(d => ({ id: d.id, name: d.name })))) return false;
        if (fromDate && request.departureDate < fromDate) return false;
        if (toDate && request.departureDate > toDate) return false;
        if (!needle) return true;
        return [request.referenceNumber, request.employeeName, request.projectName, request.purpose, request.tourType]
          .some(value => (value || '').toLowerCase().includes(needle));
      })
      .sort((a, b) => (b.departureDate || '').localeCompare(a.departureDate || ''));
  }, [visible, search, status, tourType, projectFilter, departmentFilter, fromDate, toDate, activeProjects, departments]);

  const totals = useMemo(
    () => ({
      count: filtered.length,
      estimate: roundMoney(filtered.reduce((sum, request) => sum + Number(request.estimate?.total || 0), 0)),
    }),
    [filtered],
  );

  if (loading) return <TravelLoader label="Loading tour requests…" />;

  return (
    <div className="space-y-3">
      <PageHeader
        title="Tour Requests"
        description={canViewAll ? 'Every tour raised in the organization.' : 'Tours you travel on, raised or approve.'}
        actions={
          <Button asChild className="gap-2 bg-gradient-to-r from-sky-500 to-cyan-600">
            <Link href="/tour-travel/requests/new">
              <PlaneTakeoff className="h-4 w-4" /> New Tour Request
            </Link>
          </Button>
        }
      />

      <TableCard
        title="Tours"
        icon={Plane}
        count={totals.count}
        total={visible.length}
        noun="tour"
        toolbar={
          <FilterBar
            search={{ value: search, onChange: setSearch, placeholder: 'Reference, employee, project, purpose' }}
            activeCount={
              [status !== 'all', tourType !== 'all', projectFilter !== 'all', departmentFilter !== 'all', !!fromDate, !!toDate].filter(Boolean).length
            }
            onClear={() => {
              setSearch('');
              setStatus('all');
              setTourType('all');
              setProjectFilter('all');
              setDepartmentFilter('all');
              setFromDate('');
              setToDate('');
            }}
            summary={`Estimated ${totals.estimate.toLocaleString('en-IN')}`}
          >
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {TOUR_STATUSES.map(value => <SelectItem key={value} value={value}>{value.replace(/_/g, ' ')}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={tourType} onValueChange={setTourType}>
              <SelectTrigger aria-label="Tour type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {TOUR_TYPES.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={projectFilter} onValueChange={setProjectFilter}>
              <SelectTrigger aria-label="Project"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All projects</SelectItem>
                {activeProjects.map(project => <SelectItem key={project.id} value={project.id}>{project.projectName}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
              <SelectTrigger aria-label="Department"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {departments.map(department => <SelectItem key={department.id} value={department.id}>{department.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="date" aria-label="Departure from" title="Departure from" value={fromDate} onChange={event => setFromDate(event.target.value)} />
            <Input type="date" aria-label="Departure to" title="Departure to" value={toDate} onChange={event => setToDate(event.target.value)} />
          </FilterBar>
        }
      >
        <div className="p-3 sm:p-0">
          <DataList
            frameless
            rows={filtered}
            cardHref={request => `/tour-travel/requests/${request.id}`}
            empty={
              <TravelEmptyState
                title="No tour requests match"
                description="Adjust the filters, or raise a new tour request."
                icon={Plane}
                action={
                  <Button asChild size="sm">
                    <Link href="/tour-travel/requests/new">New Tour Request</Link>
                  </Button>
                }
              />
            }
            columns={[
              {
                header: 'Reference',
                mobile: 'title',
                cell: request => (
                  <>
                    <CellLink href={`/tour-travel/requests/${request.id}`} className="font-medium text-sky-700 hover:underline">
                      {request.referenceNumber}
                    </CellLink>
                    {request.isEmergency && <p className="text-[11px] font-medium text-amber-700">Emergency</p>}
                  </>
                ),
              },
              {
                header: 'Employee',
                mobile: 'title',
                cell: request => (
                  <>
                    {request.employeeName}
                    {request.designation && <span className="text-muted-foreground"> · {request.designation}</span>}
                  </>
                ),
              },
              { header: 'Status', mobile: 'aside', cell: request => <StatusBadge status={request.status}>{travelStatusLabel(request.status)}</StatusBadge> },
              {
                header: 'Type / Project',
                className: 'hidden md:table-cell',
                cell: request => (
                  <>
                    {request.tourType}
                    {request.projectName && <p className="text-[11px] text-muted-foreground">{request.projectName}</p>}
                  </>
                ),
              },
              { header: 'Departure', cell: request => <span className="tabular-nums">{request.departureDate}</span> },
              { header: 'Return', className: 'hidden lg:table-cell', cell: request => <span className="tabular-nums">{request.returnDate}</span> },
              { header: 'Estimate', align: 'right', cell: request => <Money value={request.estimate?.total || 0} /> },
            ]}
          />
        </div>
      </TableCard>
    </div>
  );
}
