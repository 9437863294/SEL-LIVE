'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, onSnapshot } from 'firebase/firestore';
import { AlertTriangle, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { Department, Employee, Project, User } from '@/lib/types';
import {
  ACCOMMODATION_ARRANGEMENTS,
  TOUR_TYPES,
  TRAVEL_MODES,
  estimateTourCost,
  exceedsClassEntitlement,
  nightsBetween,
  type TravelAccommodationPlan,
  type TravelItineraryLeg,
  type TravelMode,
} from '@/lib/tour-travel';
import { TravelControlError, createTravelRequest, checkOutstandingAdvances } from '@/lib/tour-travel-service';
import { TT_PERMISSION_MODULE } from './module-layout-shell';
import { useTravelActor, useTravelConfig, useTravelOrganization } from './use-travel-config';
import { Money, TravelField, TravelLoader, TravelPageHeader, TravelSection } from './travel-ui';

const uid = () => Math.random().toString(36).slice(2, 10);
const todayIso = () => new Date().toISOString().slice(0, 10);

const emptyLeg = (date: string): TravelItineraryLeg => ({
  id: uid(),
  date,
  fromCity: '',
  toCity: '',
  mode: 'Train',
  travelClass: '',
  departureTime: '',
  arrivalTime: '',
  estimatedCost: 0,
  remarks: '',
});

const emptyStay = (checkIn: string): TravelAccommodationPlan => ({
  id: uid(),
  city: '',
  checkIn,
  checkOut: checkIn,
  nights: 0,
  hotelRequired: true,
  arrangement: 'Employee Booking',
  estimatedTariffPerNight: 0,
  remarks: '',
});

/**
 * Tour request form (spec sections 3–6).
 *
 * The form's job is to make the *approved budget* correct before anyone travels, so three things
 * happen live as the user types rather than at submission:
 *
 *   • the estimate recomputes from the itinerary, nights and the traveller's grade entitlement,
 *     so the figure an approver eventually sees is already policy-shaped;
 *   • any leg booked above the grade's class entitlement is flagged inline, with a reason field,
 *     instead of being discovered by Finance at settlement;
 *   • the traveller's outstanding-advance position is checked as soon as they're selected, because
 *     that is what decides whether an advance can be requested at all.
 *
 * "On behalf of" is a first-class case (spec section 42): an EA raising a Director's tour picks the
 * traveller, and both identities are recorded — the traveller on `employeeId`, the author via
 * `withCreateAudit`.
 */
export default function TourRequestForm() {
  const router = useRouter();
  const { toast } = useToast();
  const { user, users } = useAuth();
  const { can } = useAuthorization();
  const { organizationId } = useTravelOrganization();
  const actor = useTravelActor();
  const config = useTravelConfig();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [saving, setSaving] = useState(false);

  const canActOnBehalf = can('Create On Behalf', `${TT_PERMISSION_MODULE}.Tour Requests`) && config.settings.general.allowRequestOnBehalf;

  // Core fields
  const [employeeId, setEmployeeId] = useState('');
  const [tourType, setTourType] = useState<(typeof TOUR_TYPES)[number]>('Project/Site Visit');
  const [purpose, setPurpose] = useState('');
  const [isInternational, setIsInternational] = useState(false);
  const [isEmergency, setIsEmergency] = useState(false);
  const [emergencyReason, setEmergencyReason] = useState('');
  const [projectId, setProjectId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [reportingManagerId, setReportingManagerId] = useState('');
  const [hodId, setHodId] = useState('');
  const [projectManagerId, setProjectManagerId] = useState('');
  const [costCentre, setCostCentre] = useState('');

  const [departureDate, setDepartureDate] = useState(todayIso());
  const [returnDate, setReturnDate] = useState(todayIso());
  const [departureTime, setDepartureTime] = useState('09:00');
  const [returnTime, setReturnTime] = useState('18:00');

  const [itinerary, setItinerary] = useState<TravelItineraryLeg[]>([emptyLeg(todayIso())]);
  const [accommodation, setAccommodation] = useState<TravelAccommodationPlan[]>([]);

  const [localTransport, setLocalTransport] = useState(0);
  const [fuel, setFuel] = useState(0);
  const [miscellaneous, setMiscellaneous] = useState(0);

  const [advanceRequired, setAdvanceRequired] = useState(false);
  const [advanceRequestedAmount, setAdvanceRequestedAmount] = useState(0);
  const [exceptionReason, setExceptionReason] = useState('');

  const [advanceCheck, setAdvanceCheck] = useState<Awaited<ReturnType<typeof checkOutstandingAdvances>> | null>(null);

  useEffect(() => {
    const stopEmployees = onSnapshot(collection(db, 'employees'), snapshot =>
      setEmployees(snapshot.docs.map(entry => ({ id: entry.id, ...entry.data() }) as Employee).filter(employee => employee.status !== 'Inactive')));
    const stopProjects = onSnapshot(collection(db, 'projects'), snapshot =>
      setProjects(snapshot.docs.map(entry => ({ id: entry.id, ...entry.data() }) as Project).filter(project => project.status !== 'Inactive')));
    const stopDepartments = onSnapshot(collection(db, 'departments'), snapshot =>
      setDepartments(snapshot.docs.map(entry => ({ id: entry.id, ...entry.data() }) as Department)));
    return () => {
      stopEmployees();
      stopProjects();
      stopDepartments();
    };
  }, []);

  /**
   * Default the traveller to the signed-in user, matched by email because `Employee` and `User` are
   * separate records with no shared key. Someone without an employee record can still raise a tour
   * on behalf of others, they just don't get a default.
   */
  useEffect(() => {
    if (employeeId || !employees.length || !user?.email) return;
    const mine = employees.find(employee => employee.email?.toLowerCase() === user.email?.toLowerCase());
    if (mine) setEmployeeId(mine.id);
  }, [employees, user?.email, employeeId]);

  const employee = useMemo(() => employees.find(entry => entry.id === employeeId), [employees, employeeId]);
  const project = useMemo(() => projects.find(entry => entry.id === projectId), [projects, projectId]);
  const grade = useMemo(
    () => config.gradeFor({ employeeId: employee?.employeeId, designation: employee?.designation }),
    [config, employee?.employeeId, employee?.designation],
  );

  // Department follows the employee master unless the user overrides it.
  useEffect(() => {
    if (!employee?.department || departmentId) return;
    const match = departments.find(entry => entry.name === employee.department);
    if (match) setDepartmentId(match.id);
  }, [employee?.department, departments, departmentId]);

  useEffect(() => {
    if (!employee || !organizationId) {
      setAdvanceCheck(null);
      return;
    }
    let cancelled = false;
    checkOutstandingAdvances(employee.id, organizationId)
      .then(result => {
        if (!cancelled) setAdvanceCheck(result);
      })
      .catch(() => {
        if (!cancelled) setAdvanceCheck(null);
      });
    return () => {
      cancelled = true;
    };
  }, [employee, organizationId]);

  /** The destination that governs entitlement — the last leg's arrival city. */
  const destinationCity = itinerary[itinerary.length - 1]?.toCity || itinerary[0]?.toCity || '';
  const entitlement = config.entitlementFor(grade, destinationCity);
  const destinationClass = config.cityClassFor(destinationCity);

  const totalNights = useMemo(
    () => accommodation.reduce((sum, stay) => sum + nightsBetween(stay.checkIn, stay.checkOut), 0),
    [accommodation],
  );
  const travelCost = useMemo(
    () => itinerary.reduce((sum, leg) => sum + (Number(leg.estimatedCost) || 0), 0),
    [itinerary],
  );
  const hotelTariff = useMemo(() => {
    const entered = accommodation.filter(stay => Number(stay.estimatedTariffPerNight) > 0);
    if (!entered.length) return null;
    // Weighted by nights, so a one-night Metro stay doesn't set the rate for a week at a site.
    const nights = entered.reduce((sum, stay) => sum + Math.max(1, nightsBetween(stay.checkIn, stay.checkOut)), 0);
    const total = entered.reduce((sum, stay) => sum + Number(stay.estimatedTariffPerNight) * Math.max(1, nightsBetween(stay.checkIn, stay.checkOut)), 0);
    return nights > 0 ? total / nights : null;
  }, [accommodation]);

  const estimate = useMemo(
    () =>
      estimateTourCost({
        travel: travelCost,
        nights: totalNights,
        hotelRatePerNight: hotelTariff,
        entitlement,
        departureAt: `${departureDate}T${departureTime}`,
        returnAt: `${returnDate}T${returnTime}`,
        daSlabs: config.settings.allowances.daSlabs,
        localTransport,
        fuel,
        miscellaneous,
      }),
    [travelCost, totalNights, hotelTariff, entitlement, departureDate, departureTime, returnDate, returnTime, config.settings.allowances.daSlabs, localTransport, fuel, miscellaneous],
  );

  /** Legs booked above the grade's class entitlement, and the hotel tariff if it exceeds the cap. */
  const policyExceptions = useMemo(() => {
    const exceptions: Array<{ category: string; claimed: number; entitled: number; excess: number; reason: string }> = [];
    for (const leg of itinerary) {
      if (exceedsClassEntitlement(leg.mode, leg.travelClass, entitlement)) {
        exceptions.push({
          category: `${leg.mode} class (${leg.travelClass})`,
          claimed: Number(leg.estimatedCost) || 0,
          entitled: 0,
          excess: 0,
          reason: exceptionReason,
        });
      }
    }
    if (entitlement && hotelTariff && hotelTariff > entitlement.hotelLimitPerNight) {
      exceptions.push({
        category: 'Hotel tariff per night',
        claimed: Math.round(hotelTariff),
        entitled: entitlement.hotelLimitPerNight,
        excess: Math.round(hotelTariff - entitlement.hotelLimitPerNight),
        reason: exceptionReason,
      });
    }
    return exceptions;
  }, [itinerary, entitlement, hotelTariff, exceptionReason]);

  const setLeg = (id: string, patch: Partial<TravelItineraryLeg>) =>
    setItinerary(current => current.map(leg => (leg.id === id ? { ...leg, ...patch } : leg)));
  const setStay = (id: string, patch: Partial<TravelAccommodationPlan>) =>
    setAccommodation(current =>
      current.map(stay => {
        if (stay.id !== id) return stay;
        const next = { ...stay, ...patch };
        return { ...next, nights: nightsBetween(next.checkIn, next.checkOut) };
      }),
    );

  const handleSubmit = async (submitForApproval: boolean) => {
    if (!actor) {
      toast({ variant: 'destructive', title: 'Not signed in', description: 'Sign in again to raise a tour request.' });
      return;
    }
    if (!employee) {
      toast({ variant: 'destructive', title: 'Select the traveller', description: 'Choose the employee this tour is for.' });
      return;
    }
    if (policyExceptions.length && config.settings.controls.requireExceptionReason && !exceptionReason.trim()) {
      toast({ variant: 'destructive', title: 'Exception reason required', description: 'This tour exceeds entitlement — explain why before submitting.' });
      return;
    }

    setSaving(true);
    try {
      const result = await createTravelRequest(
        {
          employeeId: employee.id,
          // Link to the login account by email, so approvals and "my travel" resolve to a real user.
          employeeUserId: users.find((entry: User) => entry.email?.toLowerCase() === employee.email?.toLowerCase())?.id || user?.id || '',
          employeeName: employee.name,
          employeeCode: employee.employeeId || employee.employeeNo || '',
          designation: employee.designation || '',
          grade,
          departmentId,
          departmentName: departments.find(entry => entry.id === departmentId)?.name || employee.department || '',
          reportingManagerId,
          hodId,
          costCentre,
          tourType,
          purpose,
          isInternational,
          isEmergency,
          emergencyReason,
          projectId,
          projectName: project?.projectName || '',
          projectCode: project?.siteCode || '',
          projectSiteName: project?.projectSite || '',
          clientId: project?.clientId || '',
          clientName: project?.clientName || '',
          projectManagerId,
          workOrderNo: project?.woNo || '',
          departureDate,
          returnDate,
          departureAt: `${departureDate}T${departureTime}`,
          returnAt: `${returnDate}T${returnTime}`,
          itinerary,
          accommodation: accommodation.map(stay => ({ ...stay, cityClass: config.cityClassFor(stay.city), nights: nightsBetween(stay.checkIn, stay.checkOut) })),
          estimate,
          advanceRequired,
          advanceRequestedAmount,
          policyExceptions: policyExceptions.map(exception => ({ ...exception, reason: exceptionReason })),
        },
        actor,
      );

      toast({ title: 'Tour request created', description: `${result.referenceNumber} saved as a draft.` });
      router.push(submitForApproval ? `/tour-travel/requests/${result.id}?submit=1` : `/tour-travel/requests/${result.id}`);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Could not save the tour request',
        description: error instanceof TravelControlError ? error.message : 'Something went wrong. Please try again.',
      });
    } finally {
      setSaving(false);
    }
  };

  if (config.loading) return <TravelLoader label="Loading travel policy…" />;

  return (
    <div className="space-y-4 pb-24">
      <TravelPageHeader
        title="New Tour Request"
        description="Raise the request before travelling — approval, entitlement and budget are all checked here."
      />

      {advanceCheck && advanceCheck.action !== 'Allow' && (
        <div
          className={
            advanceCheck.action === 'Warn'
              ? 'flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800'
              : 'flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800'
          }
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Outstanding travel advance</p>
            <p className="text-xs">{advanceCheck.message}</p>
            {advanceCheck.action !== 'Warn' && (
              <p className="mt-0.5 text-xs font-medium">A new advance will need: {advanceCheck.action.toLowerCase()}.</p>
            )}
          </div>
        </div>
      )}

      <TravelSection title="Traveller & Classification" description="Pulled from the Employee Master; grade decides entitlement.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label className="text-xs">Employee {canActOnBehalf && <span className="text-muted-foreground">(can raise on behalf)</span>}</Label>
            <Select value={employeeId} onValueChange={setEmployeeId} disabled={!canActOnBehalf && !!employeeId}>
              <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
              <SelectContent>
                {employees.map(entry => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.name} {entry.designation ? `— ${entry.designation}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <TravelField label="Employee ID">{employee?.employeeId || employee?.employeeNo}</TravelField>
          <TravelField label="Designation">{employee?.designation}</TravelField>
          <TravelField label="Travel Grade">
            <span className="rounded bg-sky-50 px-1.5 py-0.5 text-sky-700">{grade}</span>
            {!entitlement && <span className="ml-2 text-xs text-amber-700">No entitlement configured</span>}
          </TravelField>

          <div>
            <Label className="text-xs">Department</Label>
            <Select value={departmentId} onValueChange={setDepartmentId}>
              <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
              <SelectContent>
                {departments.map(entry => <SelectItem key={entry.id} value={entry.id}>{entry.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Cost Centre</Label>
            <Input value={costCentre} onChange={event => setCostCentre(event.target.value)} placeholder="Cost centre" />
          </div>

          <div>
            <Label className="text-xs">Tour Type</Label>
            <Select value={tourType} onValueChange={value => setTourType(value as typeof tourType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TOUR_TYPES.map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Reporting Manager (approver)</Label>
            <Select value={reportingManagerId} onValueChange={setReportingManagerId}>
              <SelectTrigger><SelectValue placeholder="Select approver" /></SelectTrigger>
              <SelectContent>
                {users.map((entry: User) => <SelectItem key={entry.id} value={entry.id}>{entry.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">HOD</Label>
            <Select value={hodId} onValueChange={setHodId}>
              <SelectTrigger><SelectValue placeholder="Select HOD" /></SelectTrigger>
              <SelectContent>
                {users.map((entry: User) => <SelectItem key={entry.id} value={entry.id}>{entry.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="sm:col-span-2 lg:col-span-3">
            <Label className="text-xs">Purpose of Tour</Label>
            <Textarea value={purpose} onChange={event => setPurpose(event.target.value)} rows={2} placeholder="What is this travel for?" />
          </div>

          <div className="flex items-center gap-3">
            <Switch id="international" checked={isInternational} onCheckedChange={setIsInternational} />
            <Label htmlFor="international" className="text-xs">International travel</Label>
          </div>

          {config.settings.general.allowEmergencyTours && (
            <div className="flex items-center gap-3">
              <Switch id="emergency" checked={isEmergency} onCheckedChange={setIsEmergency} />
              <Label htmlFor="emergency" className="text-xs">Emergency tour (travel first, approve after)</Label>
            </div>
          )}

          {isEmergency && (
            <div className="sm:col-span-2 lg:col-span-3">
              <Label className="text-xs">Emergency Reason</Label>
              <Textarea value={emergencyReason} onChange={event => setEmergencyReason(event.target.value)} rows={2} placeholder="Why could this not wait for approval?" />
              <p className="mt-1 text-xs text-amber-700">This tour will be created as in-progress and marked POST-FACTO APPROVAL REQUIRED.</p>
            </div>
          )}
        </div>
      </TravelSection>

      <TravelSection title="Project Linkage" description="Required for a project or site visit — this is how travel cost reaches the project ledger.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label className="text-xs">Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
              <SelectContent>
                {projects.map(entry => (
                  <SelectItem key={entry.id} value={entry.id}>{entry.projectName}{entry.siteCode ? ` (${entry.siteCode})` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <TravelField label="Project Code">{project?.siteCode}</TravelField>
          <TravelField label="Site">{project?.projectSite}</TravelField>
          <TravelField label="Client">{project?.clientName}</TravelField>
          <TravelField label="Work Order">{project?.woNo}</TravelField>
          <div>
            <Label className="text-xs">Project Manager (approver)</Label>
            <Select value={projectManagerId} onValueChange={setProjectManagerId}>
              <SelectTrigger><SelectValue placeholder="Select project manager" /></SelectTrigger>
              <SelectContent>
                {users.map((entry: User) => <SelectItem key={entry.id} value={entry.id}>{entry.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </TravelSection>

      <TravelSection
        title="Journey Itinerary"
        description={`Destination class: ${destinationClass}${entitlement ? ` — entitled to ${entitlement.trainClass} train / ${entitlement.flightClass} flight` : ''}`}
        actions={
          <Button variant="outline" size="sm" className="gap-1" onClick={() => setItinerary(current => [...current, emptyLeg(returnDate)])}>
            <Plus className="h-3.5 w-3.5" /> Add leg
          </Button>
        }
      >
        <div className="space-y-3">
          {itinerary.map((leg, index) => {
            const overClass = exceedsClassEntitlement(leg.mode, leg.travelClass, entitlement);
            return (
              <div key={leg.id} className={overClass ? 'rounded-lg border border-amber-300 bg-amber-50/50 p-3' : 'rounded-lg border border-slate-200 p-3'}>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-600">Leg {index + 1}</p>
                  {itinerary.length > 1 && (
                    <Button variant="ghost" size="sm" className="h-7 text-rose-600" onClick={() => setItinerary(current => current.filter(entry => entry.id !== leg.id))}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                  <div>
                    <Label className="text-[11px]">Date</Label>
                    <Input type="date" value={leg.date} onChange={event => setLeg(leg.id, { date: event.target.value })} />
                  </div>
                  <div>
                    <Label className="text-[11px]">From</Label>
                    <Input value={leg.fromCity} onChange={event => setLeg(leg.id, { fromCity: event.target.value })} placeholder="City" />
                  </div>
                  <div>
                    <Label className="text-[11px]">To</Label>
                    <Input value={leg.toCity} onChange={event => setLeg(leg.id, { toCity: event.target.value })} placeholder="City" />
                  </div>
                  <div>
                    <Label className="text-[11px]">Mode</Label>
                    <Select value={leg.mode} onValueChange={value => setLeg(leg.id, { mode: value as TravelMode })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {TRAVEL_MODES.map(mode => <SelectItem key={mode} value={mode}>{mode}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[11px]">Class</Label>
                    <Input value={leg.travelClass || ''} onChange={event => setLeg(leg.id, { travelClass: event.target.value })} placeholder="2A / Economy" />
                  </div>
                  <div>
                    <Label className="text-[11px]">Departure</Label>
                    <Input type="time" value={leg.departureTime || ''} onChange={event => setLeg(leg.id, { departureTime: event.target.value })} />
                  </div>
                  <div>
                    <Label className="text-[11px]">Est. cost</Label>
                    <Input type="number" inputMode="decimal" min={0} value={leg.estimatedCost || ''} onChange={event => setLeg(leg.id, { estimatedCost: Number(event.target.value) })} />
                  </div>
                </div>
                {overClass && (
                  <p className="mt-2 text-xs font-medium text-amber-800">
                    {leg.travelClass} exceeds the {grade} entitlement ({leg.mode === 'Flight' ? entitlement?.flightClass : entitlement?.trainClass}). An exception reason is required.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </TravelSection>

      <TravelSection
        title="Accommodation Plan"
        description={entitlement ? `Hotel entitlement: ${entitlement.hotelLimitPerNight}/night at ${destinationClass}` : 'No hotel entitlement configured for this grade.'}
        actions={
          <Button variant="outline" size="sm" className="gap-1" onClick={() => setAccommodation(current => [...current, emptyStay(departureDate)])}>
            <Plus className="h-3.5 w-3.5" /> Add stay
          </Button>
        }
      >
        {accommodation.length === 0 ? (
          <p className="py-3 text-center text-sm text-muted-foreground">No accommodation required, or add a stay above.</p>
        ) : (
          <div className="space-y-3">
            {accommodation.map(stay => {
              const cap = config.entitlementFor(grade, stay.city)?.hotelLimitPerNight;
              const overCap = !!cap && Number(stay.estimatedTariffPerNight) > cap;
              return (
                <div key={stay.id} className={overCap ? 'rounded-lg border border-amber-300 bg-amber-50/50 p-3' : 'rounded-lg border border-slate-200 p-3'}>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                    <div>
                      <Label className="text-[11px]">City</Label>
                      <Input value={stay.city} onChange={event => setStay(stay.id, { city: event.target.value })} />
                    </div>
                    <div>
                      <Label className="text-[11px]">Check-in</Label>
                      <Input type="date" value={stay.checkIn} onChange={event => setStay(stay.id, { checkIn: event.target.value })} />
                    </div>
                    <div>
                      <Label className="text-[11px]">Check-out</Label>
                      <Input type="date" value={stay.checkOut} onChange={event => setStay(stay.id, { checkOut: event.target.value })} />
                    </div>
                    <TravelField label="Nights">{nightsBetween(stay.checkIn, stay.checkOut)}</TravelField>
                    <div>
                      <Label className="text-[11px]">Tariff / night</Label>
                      <Input type="number" inputMode="decimal" min={0} value={stay.estimatedTariffPerNight || ''} onChange={event => setStay(stay.id, { estimatedTariffPerNight: Number(event.target.value) })} />
                    </div>
                    <div>
                      <Label className="text-[11px]">Arranged by</Label>
                      <Select value={stay.arrangement} onValueChange={value => setStay(stay.id, { arrangement: value as TravelAccommodationPlan['arrangement'] })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ACCOMMODATION_ARRANGEMENTS.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] text-muted-foreground">City class: {config.cityClassFor(stay.city)}{cap ? ` — cap ${cap}/night` : ''}</p>
                    <Button variant="ghost" size="sm" className="h-7 text-rose-600" onClick={() => setAccommodation(current => current.filter(entry => entry.id !== stay.id))}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {overCap && <p className="mt-1 text-xs font-medium text-amber-800">Tariff exceeds the {cap}/night entitlement for this city class.</p>}
                </div>
              );
            })}
          </div>
        )}
      </TravelSection>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TravelSection title="Travel Window" description="Departure and return times drive the daily allowance.">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Departure date</Label>
              <Input type="date" value={departureDate} onChange={event => setDepartureDate(event.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Departure time</Label>
              <Input type="time" value={departureTime} onChange={event => setDepartureTime(event.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Return date</Label>
              <Input type="date" value={returnDate} onChange={event => setReturnDate(event.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Return time</Label>
              <Input type="time" value={returnTime} onChange={event => setReturnTime(event.target.value)} />
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Local transport (est.)</Label>
              <Input type="number" inputMode="decimal" min={0} value={localTransport || ''} onChange={event => setLocalTransport(Number(event.target.value))} />
            </div>
            <div>
              <Label className="text-xs">Fuel (est.)</Label>
              <Input type="number" inputMode="decimal" min={0} value={fuel || ''} onChange={event => setFuel(Number(event.target.value))} />
            </div>
            <div>
              <Label className="text-xs">Miscellaneous (est.)</Label>
              <Input type="number" inputMode="decimal" min={0} value={miscellaneous || ''} onChange={event => setMiscellaneous(Number(event.target.value))} />
            </div>
          </div>
        </TravelSection>

        <TravelSection title="Estimated Tour Cost" description="This becomes the approved travel budget, compared against actuals later.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Expense</TableHead>
                <TableHead className="text-right">Estimated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <EstimateRow label="Flight / Train / Bus" value={estimate.travel} />
              <EstimateRow label={`Hotel (${totalNights} night${totalNights === 1 ? '' : 's'})`} value={estimate.hotel} />
              <EstimateRow label="Daily Allowance" value={estimate.dailyAllowance} />
              <EstimateRow label="Local Transport" value={estimate.localTransport} />
              <EstimateRow label="Fuel" value={estimate.fuel} />
              <EstimateRow label="Miscellaneous" value={estimate.miscellaneous} />
              <TableRow className="border-t-2 font-semibold">
                <TableCell>Total</TableCell>
                <TableCell className="text-right"><Money value={estimate.total} /></TableCell>
              </TableRow>
            </TableBody>
          </Table>

          <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
            <div className="flex items-center gap-3">
              <Switch id="advance" checked={advanceRequired} onCheckedChange={setAdvanceRequired} />
              <Label htmlFor="advance" className="text-xs">Travel advance required</Label>
            </div>
            {advanceRequired && (
              <div>
                <Label className="text-xs">Advance requested</Label>
                <Input
                  type="number" inputMode="decimal"
                  min={0}
                  max={estimate.total}
                  value={advanceRequestedAmount || ''}
                  onChange={event => setAdvanceRequestedAmount(Number(event.target.value))}
                />
                {advanceRequestedAmount > estimate.total && (
                  <p className="mt-1 text-xs text-rose-600">The advance cannot exceed the estimated cost.</p>
                )}
              </div>
            )}
          </div>
        </TravelSection>
      </div>

      {policyExceptions.length > 0 && (
        <TravelSection title="Policy Exceptions" description="This tour exceeds entitlement — the approver will see this reason.">
          <ul className="mb-3 space-y-1 text-sm">
            {policyExceptions.map((exception, index) => (
              <li key={index} className="flex items-center justify-between gap-3 rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-amber-900">
                <span>{exception.category}</span>
                {exception.excess > 0 && <span className="font-medium"><Money value={exception.excess} /> above entitlement</span>}
              </li>
            ))}
          </ul>
          <Label className="text-xs">Exception reason {config.settings.controls.requireExceptionReason && <span className="text-rose-600">*</span>}</Label>
          <Textarea value={exceptionReason} onChange={event => setExceptionReason(event.target.value)} rows={2} placeholder="Why is the entitlement being exceeded?" />
        </TravelSection>
      )}

      {/* `tt-sticky-actions` adds the home-indicator inset on a phone, so the buttons aren't sitting
          under the gesture bar. The two actions split the width evenly there rather than wrapping. */}
      <div className="tt-sticky-actions sticky bottom-0 -mx-3 border-t border-slate-200 bg-white/95 px-3 py-3 backdrop-blur sm:-mx-6 sm:flex sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 sm:px-6">
        <div className="mb-2 text-sm sm:mb-0">
          <span className="text-muted-foreground">Estimated total: </span>
          <span className="font-semibold text-slate-900"><Money value={estimate.total} /></span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Button variant="outline" disabled={saving} onClick={() => handleSubmit(false)} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Draft
          </Button>
          <Button disabled={saving} onClick={() => handleSubmit(true)} className="gap-2 bg-gradient-to-r from-sky-500 to-cyan-600">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save &amp; Submit
          </Button>
        </div>
      </div>
    </div>
  );
}

function EstimateRow({ label, value }: { label: string; value: number }) {
  return (
    <TableRow>
      <TableCell className="text-sm text-muted-foreground">{label}</TableCell>
      <TableCell className="text-right text-sm"><Money value={value} /></TableCell>
    </TableRow>
  );
}
