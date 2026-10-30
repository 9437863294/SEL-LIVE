'use client';

/**
 * Settings › Working Hours — the company's working week (`settings/workingHours`, under `schedule`)
 * and its holidays (`holidays`, one document each with a `yyyy-MM-dd` date). The rows and the list
 * are `working-week-editor.tsx`.
 */

import { useEffect, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { CalendarDays, Clock, Copy, Loader2, Plus, RotateCcw, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { FormDialog } from '@/components/shared/form-dialog';
import { PageHeader } from '@/components/shared/page-header';
import { SettingsAccessDenied, SettingsNotice, SettingsPage, SettingsSection } from '@/components/settings/settings-ui';
import {
  HolidayRegister,
  INITIAL_SCHEDULE,
  WORK_WEEK,
  WeekScheduleList,
  dateOf,
  hoursOf,
  hoursText,
  todayIso,
} from '@/components/settings/working-week-editor';
import { useBackNavigation } from '@/hooks/use-back-navigation';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import type { Holiday, WorkingHours } from '@/lib/types';

async function loadHolidays(): Promise<Holiday[]> {
  const snapshot = await getDocs(collection(db, 'holidays'));
  return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as Holiday).sort((a, b) => a.date.localeCompare(b.date));
}

/** The stored week, or `null` before one is first saved. */
async function loadSchedule(): Promise<WorkingHours | null> {
  const snapshot = await getDoc(doc(db, 'settings', 'workingHours'));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  // Older documents hold the days at the top level rather than under `schedule`.
  return { ...INITIAL_SCHEDULE, ...((data.schedule ?? data) as WorkingHours) };
}

export default function WorkingHoursPage() {
  const back = useBackNavigation('/settings');
  const { toast } = useToast();
  const { can } = useAuthorization();
  const canView = can('View', 'Settings.Working Hrs');
  const canEdit = can('Edit', 'Settings.Working Hrs');

  const [schedule, setSchedule] = useState<WorkingHours>(INITIAL_SCHEDULE);
  const [savedSchedule, setSavedSchedule] = useState<WorkingHours>(INITIAL_SCHEDULE);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingSchedule, setSavingSchedule] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDate, setNewDate] = useState('');
  const [adding, setAdding] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Holiday | null>(null);

  useEffect(() => {
    if (!canView) return;
    let live = true;
    Promise.all([loadSchedule(), loadHolidays()])
      .then(([stored, list]) => {
        if (!live) return;
        if (stored) {
          setSchedule(stored);
          setSavedSchedule(stored);
        }
        setHolidays(list);
      })
      .catch((error) => {
        console.error('Error loading working hours: ', error);
        toast({ title: 'Could not load working hours', description: 'Check your connection and reload the page.', variant: 'destructive' });
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [canView, toast]);

  if (!canView) return <SettingsAccessDenied title="Working Hours" icon={Clock} />;

  const today = todayIso();
  const upcomingCount = holidays.filter((holiday) => holiday.date >= today).length;
  const workDays = WORK_WEEK.filter((day) => schedule[day]?.isWorkDay);
  const invalidDays = workDays.filter((day) => hoursOf(schedule[day].startTime, schedule[day].endTime) === null);
  const weeklyHours = workDays.reduce((sum, day) => sum + (hoursOf(schedule[day].startTime, schedule[day].endTime) ?? 0), 0);
  const dirty = JSON.stringify(WORK_WEEK.map((day) => schedule[day])) !== JSON.stringify(WORK_WEEK.map((day) => savedSchedule[day]));
  const firstWorkDay = workDays[0];

  const changeDay = (day: string, patch: Partial<WorkingHours[string]>) =>
    setSchedule((current) => ({ ...current, [day]: { ...current[day], ...patch } }));

  const copyFirstDay = () => {
    if (!firstWorkDay) return;
    const { startTime, endTime } = schedule[firstWorkDay];
    setSchedule((current) => Object.fromEntries(WORK_WEEK.map((day) => [day, current[day].isWorkDay ? { ...current[day], startTime, endTime } : current[day]])));
  };

  const saveSchedule = async () => {
    if (!canEdit || invalidDays.length) return;
    setSavingSchedule(true);
    try {
      await setDoc(doc(db, 'settings', 'workingHours'), { schedule });
      setSavedSchedule(schedule);
      toast({ title: 'Working week saved', description: `${workDays.length} working days, ${hoursText(weeklyHours)} a week.` });
    } catch (error) {
      console.error('Error saving working hours: ', error);
      toast({ title: 'Not saved', description: 'Check your connection and try again.', variant: 'destructive' });
    }
    setSavingSchedule(false);
  };

  const openAdd = () => {
    setNewName('');
    setNewDate('');
    setAddOpen(true);
  };

  const addHoliday = async () => {
    if (!canEdit || !newName.trim() || !newDate) return;
    setAdding(true);
    try {
      await addDoc(collection(db, 'holidays'), { name: newName.trim(), date: newDate });
      setHolidays(await loadHolidays());
      setAddOpen(false);
      toast({ title: 'Holiday added', description: `${newName.trim()} · ${dateOf(newDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` });
    } catch (error) {
      console.error('Error adding holiday: ', error);
      toast({ title: 'Not added', description: 'Check your connection and try again.', variant: 'destructive' });
    }
    setAdding(false);
  };

  const removeHoliday = async () => {
    if (!deleteTarget || !canEdit) return;
    try {
      await deleteDoc(doc(db, 'holidays', deleteTarget.id));
      setHolidays((current) => current.filter((holiday) => holiday.id !== deleteTarget.id));
      toast({ title: 'Holiday removed', description: deleteTarget.name });
    } catch (error) {
      console.error('Error deleting holiday: ', error);
      toast({ title: 'Not removed', description: 'Check your connection and try again.', variant: 'destructive' });
      throw error;
    }
  };

  const duplicateDate = newDate !== '' && holidays.some((holiday) => holiday.date === newDate);

  return (
    <SettingsPage>
      <PageHeader
        title="Working Hours"
        description="The company's working week and its holidays."
        icon={Clock}
        backHref={back.href}
        backLabel={back.label}
        onBackClick={back.onClick}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] xl:items-start">
        <SettingsSection
          title="Working week"
          icon={Clock}
          description={loading ? 'Loading…' : `${workDays.length} working day${workDays.length === 1 ? '' : 's'} · ${hoursText(weeklyHours)} a week`}
          action={
            canEdit && firstWorkDay && workDays.length > 1 ? (
              <Button variant="outline" size="sm" onClick={copyFirstDay} disabled={loading}>
                <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Use {firstWorkDay}&rsquo;s hours for all
              </Button>
            ) : undefined
          }
          footer={
            canEdit ? (
              <>
                {dirty && (
                  <Button variant="ghost" onClick={() => setSchedule(savedSchedule)} disabled={savingSchedule}>
                    <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
                    Undo changes
                  </Button>
                )}
                <Button onClick={() => void saveSchedule()} disabled={savingSchedule || !dirty || invalidDays.length > 0}>
                  {savingSchedule ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="mr-2 h-4 w-4" aria-hidden="true" />}
                  Save week
                </Button>
              </>
            ) : undefined
          }
        >
          {loading ? (
            <div className="space-y-2">
              {WORK_WEEK.map((day) => <Skeleton key={day} className="h-12 rounded-lg" />)}
            </div>
          ) : (
            <WeekScheduleList schedule={schedule} disabled={!canEdit} onChangeDay={changeDay} />
          )}
          {invalidDays.length > 0 && (
            <SettingsNotice tone="danger" title="The end of the day must come after its start">
              Check {invalidDays.join(', ')}.
            </SettingsNotice>
          )}
          {!canEdit && <SettingsNotice>Your role can see the working week but not change it (Working Hrs › Edit).</SettingsNotice>}
        </SettingsSection>

        <SettingsSection
          title="Holidays"
          icon={CalendarDays}
          description={loading ? 'Loading…' : upcomingCount ? `${upcomingCount} coming up` : 'None coming up'}
          action={
            canEdit ? (
              <Button size="sm" onClick={openAdd} disabled={loading}>
                <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Add holiday
              </Button>
            ) : undefined
          }
          flush
        >
          {loading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2].map((row) => <Skeleton key={row} className="h-12 rounded-lg" />)}
            </div>
          ) : (
            <HolidayRegister holidays={holidays} today={today} canEdit={canEdit} onDelete={setDeleteTarget} />
          )}
        </SettingsSection>
      </div>

      <FormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        size="sm"
        title="Add a holiday"
        description="It is added to the company's list of holidays."
        submitLabel="Add holiday"
        submitting={adding}
        submitDisabled={!newName.trim() || !newDate}
        onSubmit={addHoliday}
      >
        <div className="space-y-1.5">
          <Label htmlFor="holiday-name">Name</Label>
          <Input id="holiday-name" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="e.g. Durga Puja" autoFocus maxLength={80} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="holiday-date">Date</Label>
          <Input id="holiday-date" type="date" value={newDate} onChange={(event) => setNewDate(event.target.value)} />
          {duplicateDate && <p className="text-xs font-medium text-amber-700">There is already a holiday on this date.</p>}
        </div>
      </FormDialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        destructive
        title="Remove this holiday?"
        description={deleteTarget ? `${deleteTarget.name} on ${dateOf(deleteTarget.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} will be removed.` : undefined}
        confirmLabel="Remove holiday"
        onConfirm={removeHoliday}
      />
    </SettingsPage>
  );
}
