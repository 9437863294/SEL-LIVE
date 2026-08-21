'use client';

import { useState } from 'react';
import { addDoc, collection, deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/components/auth/AuthProvider';
import {
  CITY_CLASSES,
  DEFAULT_TRAVEL_APPROVAL_STAGES,
  DEFAULT_TRAVEL_ENTITLEMENTS,
  TOUR_TYPES,
  TT_COLLECTIONS,
  type CityClass,
  type FlightClass,
  type OutstandingAdvanceAction,
  type TrainClass,
  type TravelApprovalRule,
  type TravelCityClass,
  type TravelEntitlement,
  type TravelGradeMapping,
  type TravelSettings,
} from '@/lib/tour-travel';
import { TT_PERMISSION_MODULE } from './module-layout-shell';
import { useTravelCollection, useTravelConfig, useTravelOrganization } from './use-travel-config';
import { TravelAccessDenied, TravelEmptyState, TravelLoader, TravelPageHeader, TravelSection } from './travel-ui';

const FLIGHT_CLASSES: FlightClass[] = ['None', 'Economy', 'Premium Economy', 'Business'];
const TRAIN_CLASSES: TrainClass[] = ['None', 'SL', 'CC', '3A', 'EC', '2A', '1A'];
const OUTSTANDING_POLICIES: OutstandingAdvanceAction[] = ['Allow', 'Warn', 'Block', 'Require Finance override', 'Require Director approval'];

/**
 * Settings for the module (spec section 45).
 *
 * Everything here is data the policy engine reads — nothing in `tour-travel-policy.ts` hardcodes a
 * rupee figure or an approval chain. That's the point: an organization changes its travel policy by
 * editing these tables, not by a release.
 *
 * The entitlement grid is the one screen worth seeding, so a fresh organization can raise a tour on
 * day one; "Load default grid" writes the illustrative rows from the module plan, clearly marked as
 * figures to be replaced.
 */
export default function TourTravelSettings() {
  const { can } = useAuthorization();
  const { toast } = useToast();
  const { user } = useAuth();
  const { organizationId, organizationName } = useTravelOrganization();
  const config = useTravelConfig();

  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<TravelSettings | null>(null);

  const canEdit = can('Edit', `${TT_PERMISSION_MODULE}.Settings`);
  const canManageEntitlements = can('Manage Entitlements', `${TT_PERMISSION_MODULE}.Settings`);
  const canManageMatrix = can('Manage Approval Matrix', `${TT_PERMISSION_MODULE}.Settings`);
  const canManageCities = can('Manage City Classification', `${TT_PERMISSION_MODULE}.Settings`);

  const settings = draft || config.settings;
  const patch = (section: keyof TravelSettings, values: Record<string, unknown>) =>
    setDraft(current => {
      const base = current || config.settings;
      return { ...base, [section]: { ...(base[section] as object), ...values } } as TravelSettings;
    });

  const saveSettings = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await setDoc(
        doc(db, TT_COLLECTIONS.settings, organizationId),
        {
          ...draft,
          organizationId,
          organizationName: organizationName || draft.organizationName,
          updatedAt: serverTimestamp(),
          updatedBy: user?.id || null,
        },
        { merge: true },
      );
      toast({ title: 'Settings saved' });
      setDraft(null);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could not save settings', description: error instanceof Error ? error.message : '' });
    } finally {
      setSaving(false);
    }
  };

  if (config.loading) return <TravelLoader label="Loading settings…" />;
  if (!can('View', `${TT_PERMISSION_MODULE}.Settings`)) return <TravelAccessDenied what="travel settings" />;

  return (
    <div className="space-y-4">
      <TravelPageHeader
        title="Travel Settings"
        description="Entitlement, approval matrix, city classification and controls. Everything the policy engine reads lives here."
        actions={
          draft && (
            <Button onClick={saveSettings} disabled={saving || !canEdit} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save changes
            </Button>
          )
        }
      />

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="entitlements">Entitlements</TabsTrigger>
          <TabsTrigger value="grades">Grades</TabsTrigger>
          <TabsTrigger value="cities">City Classes</TabsTrigger>
          <TabsTrigger value="matrix">Approval Matrix</TabsTrigger>
          <TabsTrigger value="accounting">Accounting</TabsTrigger>
        </TabsList>

        {/* ── General ────────────────────────────────────────────────────────────────────────── */}
        <TabsContent value="general" className="mt-3 space-y-4">
          <TravelSection title="Controls" description="The compulsory rules of the module. Disable with care.">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ToggleRow
                label="Require an approved tour before expenses"
                hint="When off, a claim can exist with no prior tour approval."
                checked={settings.general.requireApprovedTour}
                disabled={!canEdit}
                onChange={value => patch('general', { requireApprovedTour: value })}
              />
              <ToggleRow
                label="Require an approval rule to match"
                hint="When on, a tour with no matching rule is rejected rather than using the default chain."
                checked={settings.general.requireApprovalRule}
                disabled={!canEdit}
                onChange={value => patch('general', { requireApprovalRule: value })}
              />
              <ToggleRow
                label="Flag duplicate bills"
                checked={settings.controls.flagDuplicateBills}
                disabled={!canEdit}
                onChange={value => patch('controls', { flagDuplicateBills: value })}
              />
              <ToggleRow
                label="Require an exception reason above entitlement"
                checked={settings.controls.requireExceptionReason}
                disabled={!canEdit}
                onChange={value => patch('controls', { requireExceptionReason: value })}
              />
              <ToggleRow
                label="Lock financial fields once a tour is closed"
                checked={settings.controls.lockClosedTours}
                disabled={!canEdit}
                onChange={value => patch('controls', { lockClosedTours: value })}
              />
              <ToggleRow
                label="Allow emergency tours"
                hint="Travel first, post-facto approval."
                checked={settings.general.allowEmergencyTours}
                disabled={!canEdit}
                onChange={value => patch('general', { allowEmergencyTours: value })}
              />
              <ToggleRow
                label="Allow raising a tour on behalf of another employee"
                checked={settings.general.allowRequestOnBehalf}
                disabled={!canEdit}
                onChange={value => patch('general', { allowRequestOnBehalf: value })}
              />
              <ToggleRow
                label="Calculate daily allowance automatically"
                checked={settings.allowances.autoCalculateDa}
                disabled={!canEdit}
                onChange={value => patch('allowances', { autoCalculateDa: value })}
              />
            </div>
          </TravelSection>

          <TravelSection title="Deadlines & Thresholds">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <NumberField
                label="Claim submission deadline (days after return)"
                value={settings.general.claimSubmissionDeadlineDays}
                disabled={!canEdit}
                onChange={value => patch('general', { claimSubmissionDeadlineDays: value })}
              />
              <NumberField
                label="Advance settlement deadline (days after payment)"
                value={settings.general.advanceSettlementDeadlineDays}
                disabled={!canEdit}
                onChange={value => patch('general', { advanceSettlementDeadlineDays: value })}
              />
              <NumberField
                label="Expense date tolerance (days either side of the tour)"
                value={settings.general.expenseDateToleranceDays}
                disabled={!canEdit}
                onChange={value => patch('general', { expenseDateToleranceDays: value })}
              />
              <NumberField
                label="Bill required above"
                value={settings.controls.requireBillAbove}
                disabled={!canEdit}
                onChange={value => patch('controls', { requireBillAbove: value })}
              />
              <div>
                <Label className="text-xs">When an old advance is overdue</Label>
                <Select
                  value={settings.general.outstandingAdvancePolicy}
                  onValueChange={value => patch('general', { outstandingAdvancePolicy: value as OutstandingAdvanceAction })}
                  disabled={!canEdit}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OUTSTANDING_POLICIES.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Default city class for unmapped cities</Label>
                <Select
                  value={settings.general.defaultCityClass}
                  onValueChange={value => patch('general', { defaultCityClass: value as CityClass })}
                  disabled={!canEdit}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CITY_CLASSES.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Default grade for unmapped designations</Label>
                <Input
                  value={settings.general.defaultGrade}
                  onChange={event => patch('general', { defaultGrade: event.target.value })}
                  disabled={!canEdit}
                />
              </div>
            </div>
          </TravelSection>

          <TravelSection
            title="Daily Allowance Slabs"
            description="A trailing part-day of at least this many hours earns this percentage of a full day's DA. Whole 24-hour blocks always pay in full."
          >
            <div className="space-y-2">
              {settings.allowances.daSlabs.map((slab, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    type="number" inputMode="decimal"
                    min={0}
                    className="w-24"
                    value={slab.minHours}
                    disabled={!canEdit}
                    onChange={event => {
                      const next = [...settings.allowances.daSlabs];
                      next[index] = { ...slab, minHours: Number(event.target.value) };
                      patch('allowances', { daSlabs: next });
                    }}
                  />
                  <span className="text-xs text-muted-foreground">hours or more →</span>
                  <Input
                    type="number" inputMode="decimal"
                    min={0}
                    max={100}
                    className="w-24"
                    value={slab.percent}
                    disabled={!canEdit}
                    onChange={event => {
                      const next = [...settings.allowances.daSlabs];
                      next[index] = { ...slab, percent: Number(event.target.value) };
                      patch('allowances', { daSlabs: next });
                    }}
                  />
                  <span className="text-xs text-muted-foreground">% of a day</span>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-rose-600"
                      onClick={() => patch('allowances', { daSlabs: settings.allowances.daSlabs.filter((_, i) => i !== index) })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
              {canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => patch('allowances', { daSlabs: [...settings.allowances.daSlabs, { minHours: 6, percent: 50 }] })}
                >
                  <Plus className="h-3.5 w-3.5" /> Add slab
                </Button>
              )}
            </div>
          </TravelSection>
        </TabsContent>

        {/* ── Entitlements ───────────────────────────────────────────────────────────────────── */}
        <TabsContent value="entitlements" className="mt-3">
          <EntitlementsTab organizationId={organizationId} canEdit={canManageEntitlements} />
        </TabsContent>

        <TabsContent value="grades" className="mt-3">
          <GradesTab organizationId={organizationId} canEdit={canManageEntitlements} />
        </TabsContent>

        <TabsContent value="cities" className="mt-3">
          <CitiesTab organizationId={organizationId} canEdit={canManageCities} />
        </TabsContent>

        <TabsContent value="matrix" className="mt-3">
          <ApprovalMatrixTab organizationId={organizationId} canEdit={canManageMatrix} />
        </TabsContent>

        {/* ── Accounting ─────────────────────────────────────────────────────────────────────── */}
        <TabsContent value="accounting" className="mt-3">
          <TravelSection title="Ledger Mapping" description="Expense category → GL code, used when a claim is posted to accounts.">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(['Airfare', 'Train', 'Bus', 'Hotel', 'Daily Allowance', 'Local Conveyance', 'Taxi', 'Auto', 'Fuel', 'Miscellaneous'] as const).map(category => (
                <div key={category}>
                  <Label className="text-xs">{category}</Label>
                  <Input
                    value={settings.accounting.categoryLedgers?.[category] || ''}
                    disabled={!canEdit}
                    onChange={event =>
                      patch('accounting', {
                        categoryLedgers: { ...settings.accounting.categoryLedgers, [category]: event.target.value },
                      })
                    }
                  />
                </div>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3">
              <div>
                <Label className="text-xs">Employee advance ledger</Label>
                <Input value={settings.accounting.advanceLedger} disabled={!canEdit} onChange={event => patch('accounting', { advanceLedger: event.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Employee payable ledger</Label>
                <Input value={settings.accounting.employeePayableLedger} disabled={!canEdit} onChange={event => patch('accounting', { employeePayableLedger: event.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Bank ledger</Label>
                <Input value={settings.accounting.bankLedger} disabled={!canEdit} onChange={event => patch('accounting', { bankLedger: event.target.value })} />
              </div>
            </div>
          </TravelSection>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Entitlement grid
 * ---------------------------------------------------------------------------------------------- */

function EntitlementsTab({ organizationId, canEdit }: { organizationId: string; canEdit: boolean }) {
  const { toast } = useToast();
  const { records, loading } = useTravelCollection<TravelEntitlement>(TT_COLLECTIONS.entitlements);
  const [busy, setBusy] = useState(false);

  const addRow = async () => {
    await addDoc(collection(db, TT_COLLECTIONS.entitlements), {
      organizationId,
      grade: 'New Grade',
      cityClass: 'Any',
      flightClass: 'None',
      trainClass: '3A',
      hotelLimitPerNight: 0,
      daPerDay: 0,
      mileage: { bike: 0, car: 0 },
      localConveyancePerDay: 0,
      active: true,
      createdAt: serverTimestamp(),
    });
  };

  const seedDefaults = async () => {
    setBusy(true);
    try {
      await Promise.all(
        DEFAULT_TRAVEL_ENTITLEMENTS.map(row =>
          addDoc(collection(db, TT_COLLECTIONS.entitlements), { ...row, organizationId, createdAt: serverTimestamp() }),
        ),
      );
      toast({ title: 'Default grid loaded', description: 'These are illustrative figures — review every row before use.' });
    } finally {
      setBusy(false);
    }
  };

  const update = (id: string, values: Record<string, unknown>) =>
    updateDoc(doc(db, TT_COLLECTIONS.entitlements, id), { ...values, updatedAt: serverTimestamp() });

  if (loading) return <TravelLoader />;

  return (
    <TravelSection
      title="Grade Entitlements"
      description="What each grade may spend, per city class. A row with city class 'Any' is the grade's baseline."
      actions={
        canEdit && (
          <div className="flex gap-2">
            {records.length === 0 && (
              <Button variant="outline" size="sm" onClick={seedDefaults} disabled={busy} className="gap-1">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Load default grid
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={addRow} className="gap-1">
              <Plus className="h-3.5 w-3.5" /> Add row
            </Button>
          </div>
        )
      }
    >
      {records.length === 0 ? (
        <TravelEmptyState
          title="No entitlements configured"
          description="Without an entitlement row, every expense for that grade needs an exception. Load the default grid to start."
        />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Grade</TableHead>
                <TableHead>City class</TableHead>
                <TableHead>Flight</TableHead>
                <TableHead>Train</TableHead>
                <TableHead>Hotel / night</TableHead>
                <TableHead>DA / day</TableHead>
                <TableHead>Local / day</TableHead>
                <TableHead>Bike ₹/km</TableHead>
                <TableHead>Car ₹/km</TableHead>
                <TableHead>Active</TableHead>
                {canEdit && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {records
                .slice()
                .sort((a, b) => a.grade.localeCompare(b.grade) || a.cityClass.localeCompare(b.cityClass))
                .map(row => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Input className="h-8 w-28" defaultValue={row.grade} disabled={!canEdit} onBlur={event => update(row.id, { grade: event.target.value })} />
                    </TableCell>
                    <TableCell>
                      <Select value={row.cityClass} disabled={!canEdit} onValueChange={value => update(row.id, { cityClass: value })}>
                        <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Any">Any</SelectItem>
                          {CITY_CLASSES.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select value={row.flightClass} disabled={!canEdit} onValueChange={value => update(row.id, { flightClass: value })}>
                        <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {FLIGHT_CLASSES.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select value={row.trainClass} disabled={!canEdit} onValueChange={value => update(row.id, { trainClass: value })}>
                        <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {TRAIN_CLASSES.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input type="number" inputMode="decimal" className="h-8 w-24" defaultValue={row.hotelLimitPerNight} disabled={!canEdit} onBlur={event => update(row.id, { hotelLimitPerNight: Number(event.target.value) })} />
                    </TableCell>
                    <TableCell>
                      <Input type="number" inputMode="decimal" className="h-8 w-24" defaultValue={row.daPerDay} disabled={!canEdit} onBlur={event => update(row.id, { daPerDay: Number(event.target.value) })} />
                    </TableCell>
                    <TableCell>
                      <Input type="number" inputMode="decimal" className="h-8 w-24" defaultValue={row.localConveyancePerDay} disabled={!canEdit} onBlur={event => update(row.id, { localConveyancePerDay: Number(event.target.value) })} />
                      <p className="text-[10px] text-muted-foreground">0 = uncapped</p>
                    </TableCell>
                    <TableCell>
                      <Input type="number" inputMode="decimal" className="h-8 w-20" defaultValue={row.mileage?.bike || 0} disabled={!canEdit} onBlur={event => update(row.id, { mileage: { ...row.mileage, bike: Number(event.target.value) } })} />
                    </TableCell>
                    <TableCell>
                      <Input type="number" inputMode="decimal" className="h-8 w-20" defaultValue={row.mileage?.car || 0} disabled={!canEdit} onBlur={event => update(row.id, { mileage: { ...row.mileage, car: Number(event.target.value) } })} />
                    </TableCell>
                    <TableCell>
                      <Switch checked={row.active !== false} disabled={!canEdit} onCheckedChange={value => update(row.id, { active: value })} />
                    </TableCell>
                    {canEdit && (
                      <TableCell>
                        <Button variant="ghost" size="sm" className="text-rose-600" onClick={() => deleteDoc(doc(db, TT_COLLECTIONS.entitlements, row.id))}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      )}
    </TravelSection>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Designation → grade mapping
 * ---------------------------------------------------------------------------------------------- */

function GradesTab({ organizationId, canEdit }: { organizationId: string; canEdit: boolean }) {
  const { records, loading } = useTravelCollection<TravelGradeMapping>(TT_COLLECTIONS.gradeMappings);
  const update = (id: string, values: Record<string, unknown>) =>
    updateDoc(doc(db, TT_COLLECTIONS.gradeMappings, id), { ...values, updatedAt: serverTimestamp() });

  if (loading) return <TravelLoader />;

  return (
    <TravelSection
      title="Designation → Grade"
      description="The Employee Master has no grade field, so travel grade is derived from designation. Add an Employee ID to override one person."
      actions={
        canEdit && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => addDoc(collection(db, TT_COLLECTIONS.gradeMappings), { organizationId, designation: '', grade: '', createdAt: serverTimestamp() })}
          >
            <Plus className="h-3.5 w-3.5" /> Add mapping
          </Button>
        )
      }
    >
      {records.length === 0 ? (
        <TravelEmptyState
          title="No grade mappings"
          description="Until a designation is mapped, every employee resolves to the default grade set under General."
        />
      ) : (
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Designation</TableHead>
              <TableHead>Travel grade</TableHead>
              <TableHead>Employee ID override</TableHead>
              {canEdit && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map(row => (
              <TableRow key={row.id}>
                <TableCell>
                  <Input className="h-8" defaultValue={row.designation} disabled={!canEdit} onBlur={event => update(row.id, { designation: event.target.value })} placeholder="Site Engineer" />
                </TableCell>
                <TableCell>
                  <Input className="h-8" defaultValue={row.grade} disabled={!canEdit} onBlur={event => update(row.id, { grade: event.target.value })} placeholder="Engineer" />
                </TableCell>
                <TableCell>
                  <Input className="h-8" defaultValue={row.employeeId || ''} disabled={!canEdit} onBlur={event => update(row.id, { employeeId: event.target.value })} placeholder="Optional" />
                </TableCell>
                {canEdit && (
                  <TableCell>
                    <Button variant="ghost" size="sm" className="text-rose-600" onClick={() => deleteDoc(doc(db, TT_COLLECTIONS.gradeMappings, row.id))}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      )}
    </TravelSection>
  );
}

/* ------------------------------------------------------------------------------------------------
 * City classification
 * ---------------------------------------------------------------------------------------------- */

function CitiesTab({ organizationId, canEdit }: { organizationId: string; canEdit: boolean }) {
  const { records, loading } = useTravelCollection<TravelCityClass>(TT_COLLECTIONS.cityClasses);
  const update = (id: string, values: Record<string, unknown>) =>
    updateDoc(doc(db, TT_COLLECTIONS.cityClasses, id), { ...values, updatedAt: serverTimestamp() });

  if (loading) return <TravelLoader />;

  return (
    <TravelSection
      title="City Classification"
      description="Hotel and DA caps follow the city, not just the grade. An unlisted city falls back to the default class under General — never to a higher one."
      actions={
        canEdit && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => addDoc(collection(db, TT_COLLECTIONS.cityClasses), { organizationId, city: '', cityClass: 'Tier 2', active: true, createdAt: serverTimestamp() })}
          >
            <Plus className="h-3.5 w-3.5" /> Add city
          </Button>
        )
      }
    >
      {records.length === 0 ? (
        <TravelEmptyState title="No cities classified" description="Add the cities and project sites your employees travel to." />
      ) : (
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>City</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Class</TableHead>
              <TableHead>Active</TableHead>
              {canEdit && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {records
              .slice()
              .sort((a, b) => a.city.localeCompare(b.city))
              .map(row => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Input className="h-8" defaultValue={row.city} disabled={!canEdit} onBlur={event => update(row.id, { city: event.target.value })} />
                  </TableCell>
                  <TableCell>
                    <Input className="h-8" defaultValue={row.state || ''} disabled={!canEdit} onBlur={event => update(row.id, { state: event.target.value })} />
                  </TableCell>
                  <TableCell>
                    <Select value={row.cityClass} disabled={!canEdit} onValueChange={value => update(row.id, { cityClass: value })}>
                      <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CITY_CLASSES.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Switch checked={row.active !== false} disabled={!canEdit} onCheckedChange={value => update(row.id, { active: value })} />
                  </TableCell>
                  {canEdit && (
                    <TableCell>
                      <Button variant="ghost" size="sm" className="text-rose-600" onClick={() => deleteDoc(doc(db, TT_COLLECTIONS.cityClasses, row.id))}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
          </TableBody>
        </Table>
        </div>
      )}
    </TravelSection>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Approval matrix
 * ---------------------------------------------------------------------------------------------- */

function ApprovalMatrixTab({ organizationId, canEdit }: { organizationId: string; canEdit: boolean }) {
  const { records, loading } = useTravelCollection<TravelApprovalRule>(TT_COLLECTIONS.approvalRules);
  const { users } = useAuth();
  const [expanded, setExpanded] = useState<string | null>(null);

  const update = (id: string, values: Record<string, unknown>) =>
    updateDoc(doc(db, TT_COLLECTIONS.approvalRules, id), { ...values, updatedAt: serverTimestamp() });

  if (loading) return <TravelLoader />;

  return (
    <div className="space-y-3">
      <TravelSection
        title="Approval Matrix"
        description="Rules map a tour's size and shape to an approval chain. The most specific matching rule wins, so a narrow override always beats a broad amount band."
        actions={
          canEdit && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() =>
                addDoc(collection(db, TT_COLLECTIONS.approvalRules), {
                  organizationId,
                  name: 'New rule',
                  minAmount: 0,
                  maxAmount: null,
                  tourTypes: [],
                  international: null,
                  stages: DEFAULT_TRAVEL_APPROVAL_STAGES,
                  active: true,
                  createdAt: serverTimestamp(),
                })
              }
            >
              <Plus className="h-3.5 w-3.5" /> Add rule
            </Button>
          )
        }
      >
        {records.length === 0 ? (
          <TravelEmptyState
            title="No approval rules"
            description="With no rules, tours use the default chain: Reporting Manager → HOD → Finance."
          />
        ) : (
          <div className="space-y-2">
            {records
              .slice()
              .sort((a, b) => Number(a.minAmount) - Number(b.minAmount))
              .map(rule => (
                <div key={rule.id} className="rounded-lg border border-slate-200">
                  <div className="grid grid-cols-2 items-end gap-3 p-3 sm:grid-cols-5">
                    <div className="col-span-2 sm:col-span-1">
                      <Label className="text-[11px]">Rule name</Label>
                      <Input className="h-8" defaultValue={rule.name} disabled={!canEdit} onBlur={event => update(rule.id, { name: event.target.value })} />
                    </div>
                    <div>
                      <Label className="text-[11px]">Min amount</Label>
                      <Input type="number" inputMode="decimal" className="h-8" defaultValue={rule.minAmount} disabled={!canEdit} onBlur={event => update(rule.id, { minAmount: Number(event.target.value) })} />
                    </div>
                    <div>
                      <Label className="text-[11px]">Max amount</Label>
                      <Input
                        type="number" inputMode="decimal"
                        className="h-8"
                        defaultValue={rule.maxAmount ?? ''}
                        placeholder="No limit"
                        disabled={!canEdit}
                        onBlur={event => update(rule.id, { maxAmount: event.target.value === '' ? null : Number(event.target.value) })}
                      />
                    </div>
                    <div>
                      <Label className="text-[11px]">Scope</Label>
                      <Select
                        value={rule.international == null ? 'any' : rule.international ? 'international' : 'domestic'}
                        disabled={!canEdit}
                        onValueChange={value => update(rule.id, { international: value === 'any' ? null : value === 'international' })}
                      >
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="any">Domestic & international</SelectItem>
                          <SelectItem value="domestic">Domestic only</SelectItem>
                          <SelectItem value="international">International only</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch checked={rule.active !== false} disabled={!canEdit} onCheckedChange={value => update(rule.id, { active: value })} />
                      <Label className="text-[11px]">Active</Label>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-3 py-2">
                    <span className="text-xs text-muted-foreground">Chain:</span>
                    {(rule.stages || []).map((stage, index) => (
                      <span key={stage.id} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs">
                        {index + 1}. {stage.name} <span className="text-muted-foreground">({stage.assignmentType})</span>
                      </span>
                    ))}
                    <div className="ml-auto flex gap-1">
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setExpanded(expanded === rule.id ? null : rule.id)}>
                        {expanded === rule.id ? 'Hide stages' : 'Edit stages'}
                      </Button>
                      {canEdit && (
                        <Button variant="ghost" size="sm" className="h-7 text-rose-600" onClick={() => deleteDoc(doc(db, TT_COLLECTIONS.approvalRules, rule.id))}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {expanded === rule.id && (
                    <div className="space-y-2 border-t border-slate-100 bg-slate-50/50 p-3">
                      {(rule.stages || []).map((stage, index) => (
                        <div key={stage.id} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-4">
                          <div>
                            <Label className="text-[11px]">Stage {index + 1} name</Label>
                            <Input
                              className="h-8"
                              defaultValue={stage.name}
                              disabled={!canEdit}
                              onBlur={event => {
                                const stages = [...rule.stages];
                                stages[index] = { ...stage, name: event.target.value };
                                update(rule.id, { stages });
                              }}
                            />
                          </div>
                          <div>
                            <Label className="text-[11px]">Assigned by</Label>
                            <Select
                              value={stage.assignmentType}
                              disabled={!canEdit}
                              onValueChange={value => {
                                const stages = [...rule.stages];
                                stages[index] = { ...stage, assignmentType: value as typeof stage.assignmentType };
                                update(rule.id, { stages });
                              }}
                            >
                              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Reporting Manager">Reporting Manager</SelectItem>
                                <SelectItem value="HOD">HOD</SelectItem>
                                <SelectItem value="Project Manager">Project Manager</SelectItem>
                                <SelectItem value="User-based">Specific user</SelectItem>
                                <SelectItem value="Role-based">Role</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-[11px]">
                              {stage.assignmentType === 'Role-based' ? 'Role' : stage.assignmentType === 'User-based' ? 'User' : 'Resolved from the tour'}
                            </Label>
                            {stage.assignmentType === 'User-based' ? (
                              <Select
                                value={stage.assignedTo[0] || ''}
                                disabled={!canEdit}
                                onValueChange={value => {
                                  const stages = [...rule.stages];
                                  stages[index] = { ...stage, assignedTo: [value] };
                                  update(rule.id, { stages });
                                }}
                              >
                                <SelectTrigger className="h-8"><SelectValue placeholder="Select user" /></SelectTrigger>
                                <SelectContent>
                                  {users.map(entry => <SelectItem key={entry.id} value={entry.id}>{entry.name}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            ) : stage.assignmentType === 'Role-based' ? (
                              <Input
                                className="h-8"
                                defaultValue={stage.assignedTo[0] || ''}
                                disabled={!canEdit}
                                placeholder="Finance"
                                onBlur={event => {
                                  const stages = [...rule.stages];
                                  stages[index] = { ...stage, assignedTo: [event.target.value] };
                                  update(rule.id, { stages });
                                }}
                              />
                            ) : (
                              <Input className="h-8" value="Automatic" disabled />
                            )}
                          </div>
                          <div className="flex items-end gap-2">
                            <div className="flex-1">
                              <Label className="text-[11px]">TAT (hours)</Label>
                              <Input
                                type="number" inputMode="decimal"
                                className="h-8"
                                defaultValue={stage.tat}
                                disabled={!canEdit}
                                onBlur={event => {
                                  const stages = [...rule.stages];
                                  stages[index] = { ...stage, tat: Number(event.target.value) };
                                  update(rule.id, { stages });
                                }}
                              />
                            </div>
                            {canEdit && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-rose-600"
                                onClick={() => update(rule.id, { stages: rule.stages.filter((_, i) => i !== index) })}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                      {canEdit && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1"
                          onClick={() =>
                            update(rule.id, {
                              stages: [
                                ...(rule.stages || []),
                                { id: `${Date.now()}`, name: 'New stage', assignmentType: 'User-based', assignedTo: [], tat: 24 },
                              ],
                            })
                          }
                        >
                          <Plus className="h-3.5 w-3.5" /> Add stage
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
          </div>
        )}
      </TravelSection>

      <TravelSection title="Tour Type Reference" description="Rules can be narrowed to specific tour types; leave empty to apply to all.">
        <div className="flex flex-wrap gap-1.5">
          {TOUR_TYPES.map(type => (
            <span key={type} className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">{type}</span>
          ))}
        </div>
      </TravelSection>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Small field helpers
 * ---------------------------------------------------------------------------------------------- */

function ToggleRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800">{label}</p>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

function NumberField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input type="number" inputMode="decimal" min={0} value={value} disabled={disabled} onChange={event => onChange(Number(event.target.value))} />
    </div>
  );
}
