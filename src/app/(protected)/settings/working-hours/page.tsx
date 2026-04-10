
'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Trash2, Calendar as CalendarIcon, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, getDocs, addDoc, deleteDoc, doc, setDoc, getDoc } from 'firebase/firestore';
import type { Holiday, WorkingHours } from '@/lib/types';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useAuthorization } from '@/hooks/useAuthorization';

const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const initialWorkingHours: WorkingHours = daysOfWeek.reduce((acc, day) => {
  acc[day] = {
    isWorkDay: !['Saturday', 'Sunday'].includes(day),
    startTime: '09:30',
    endTime: '18:30',
  };
  return acc;
}, {} as WorkingHours);

export default function WorkingHoursPage() {
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  
  const [workingHours, setWorkingHours] = useState<WorkingHours>(initialWorkingHours);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [isAddHolidayOpen, setIsAddHolidayOpen] = useState(false);
  const [newHolidayName, setNewHolidayName] = useState('');
  const [newHolidayDate, setNewHolidayDate] = useState<Date | undefined>();
  
  const canView = can('View', 'Settings.Working Hrs');
  const canEdit = can('Edit', 'Settings.Working Hrs');


  const fetchWorkingHours = useCallback(async () => {
    const docRef = doc(db, 'settings', 'workingHours');
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      if(data.schedule) {
        setWorkingHours(data.schedule);
      } else {
        // Fallback for old data structure
        setWorkingHours(data as WorkingHours);
      }
    }
  }, []);

  const fetchHolidays = useCallback(async () => {
    const querySnapshot = await getDocs(collection(db, 'holidays'));
    const holidaysData: Holiday[] = [];
    querySnapshot.forEach((doc) => {
      holidaysData.push({ id: doc.id, ...doc.data() } as Holiday);
    });
    setHolidays(holidaysData.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()));
  }, []);

  useEffect(() => {
    if (canView) {
      setIsLoading(true);
      Promise.all([fetchWorkingHours(), fetchHolidays()]).finally(() => setIsLoading(false));
    }
  }, [canView, fetchWorkingHours, fetchHolidays]);
  
  const resetHolidayForm = () => {
    setNewHolidayName('');
    setNewHolidayDate(undefined);
    setIsAddHolidayOpen(false);
  }

  const handleWorkingHoursChange = (day: string, field: 'isWorkDay' | 'startTime' | 'endTime', value: boolean | string) => {
    setWorkingHours(prev => ({
      ...prev,
      [day]: { ...prev[day], [field]: value }
    }));
  };

  const handleSaveWorkingHours = async () => {
    if (!canEdit) {
      toast({ title: 'Permission Denied', description: 'You do not have permission to edit working hours.', variant: 'destructive' });
      return;
    }
    try {
      await setDoc(doc(db, 'settings', 'workingHours'), { schedule: workingHours });
      toast({ title: 'Success', description: 'Working hours have been saved.' });
    } catch (error) {
      console.error("Error saving working hours: ", error);
      toast({ title: 'Error', description: 'Failed to save working hours.', variant: 'destructive' });
    }
  };

  const handleAddHoliday = async () => {
     if (!canEdit) {
      toast({ title: 'Permission Denied', description: 'You do not have permission to add holidays.', variant: 'destructive' });
      return;
    }
    if (!newHolidayName.trim() || !newHolidayDate) {
      toast({ title: 'Validation Error', description: 'Holiday name and date are required.', variant: 'destructive' });
      return;
    }
    try {
      await addDoc(collection(db, 'holidays'), {
        name: newHolidayName,
        date: format(newHolidayDate, 'yyyy-MM-dd'),
      });
      toast({ title: 'Success', description: `Holiday "${newHolidayName}" added.` });
      resetHolidayForm();
      fetchHolidays();
    } catch (error) {
      console.error("Error adding holiday: ", error);
      toast({ title: 'Error', description: 'Failed to add holiday.', variant: 'destructive' });
    }
  };
  
  const handleDeleteHoliday = async (id: string) => {
     if (!canEdit) {
      toast({ title: 'Permission Denied', description: 'You do not have permission to delete holidays.', variant: 'destructive' });
      return;
    }
    try {
      await deleteDoc(doc(db, "holidays", id));
      toast({ title: "Success", description: "Holiday deleted successfully." });
      fetchHolidays();
    } catch (error) {
      console.error("Error deleting holiday: ", error);
      toast({ title: "Error", description: "Failed to delete holiday.", variant: "destructive" });
    }
  };
  
  if (isAuthLoading) {
      return (
        <div className="w-full max-w-6xl mx-auto">
            <div className="mb-6"><Skeleton className="h-10 w-64" /></div>
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">
                <Skeleton className="h-96 lg:col-span-3" />
                <Skeleton className="h-80 lg:col-span-2" />
            </div>
        </div>
      )
  }

  if (!canView) {
    return (
      <div className="w-full max-w-5xl mx-auto">
        <div className="mb-5 flex items-center gap-3">
          <Link href="/settings"><Button variant="ghost" size="icon" className="rounded-full"><ArrowLeft className="h-5 w-5" /></Button></Link>
          <h1 className="text-xl font-bold">Working Hours</h1>
        </div>
        <Card><CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to view this page.</CardDescription></CardHeader>
          <CardContent className="flex justify-center p-8"><ShieldAlert className="h-14 w-14 text-destructive" /></CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      {/* ── Background ── */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-teal-50/60 via-background to-cyan-50/40 dark:from-teal-950/20 dark:via-background dark:to-cyan-950/15" />
        <div className="animate-bb-orb-1 absolute top-[-10%] left-[-5%] w-[35vw] h-[35vw] rounded-full bg-teal-300/15 blur-3xl" />
        <div className="animate-bb-orb-2 absolute bottom-[-8%] right-[-6%] w-[35vw] h-[35vw] rounded-full bg-cyan-300/12 blur-3xl" />
        <div className="absolute inset-0 opacity-20 dark:opacity-12"
          style={{ backgroundImage: 'radial-gradient(circle, rgba(20,184,166,0.10) 1px, transparent 1px)', backgroundSize: '28px 28px' }}
        />
      </div>
    <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
      <div className="mb-5 flex items-center gap-3">
        <Link href="/settings">
          <Button variant="ghost" size="icon" className="rounded-full hover:bg-teal-50 dark:hover:bg-teal-950/30"><ArrowLeft className="h-5 w-5" /></Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold tracking-tight">Working Hours</h1>
          <p className="text-xs text-muted-foreground">Configure work schedule and holidays</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 items-start">
        <Card className="lg:col-span-3 border-teal-200/60 dark:border-teal-800/30 overflow-hidden">
          <div className="h-0.5 w-full bg-gradient-to-r from-teal-400 to-cyan-400" />
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Weekly Schedule</CardTitle>
            <CardDescription>Set working hours for each day of the week.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {isLoading ? (
               Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)
            ) : (
              daysOfWeek.map(day => (
                <div key={day} className="flex items-center justify-between">
                  <Label htmlFor={`switch-${day}`} className="w-24 font-medium">{day}</Label>
                  <div className="flex items-center gap-4">
                    <Switch
                      id={`switch-${day}`}
                      checked={workingHours[day]?.isWorkDay}
                      onCheckedChange={(checked) => handleWorkingHoursChange(day, 'isWorkDay', checked)}
                      disabled={!canEdit}
                    />
                    <span className="text-sm text-muted-foreground">{workingHours[day]?.isWorkDay ? 'Work' : 'Off'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="time"
                      value={workingHours[day]?.startTime || '00:00'}
                      onChange={(e) => handleWorkingHoursChange(day, 'startTime', e.target.value)}
                      disabled={!workingHours[day]?.isWorkDay || !canEdit}
                      className="w-32"
                    />
                    <Input
                      type="time"
                      value={workingHours[day]?.endTime || '00:00'}
                      onChange={(e) => handleWorkingHoursChange(day, 'endTime', e.target.value)}
                      disabled={!workingHours[day]?.isWorkDay || !canEdit}
                      className="w-32"
                    />
                  </div>
                </div>
              ))
            )}
            <Button onClick={handleSaveWorkingHours} className="w-full" disabled={!canEdit}>Save Hours</Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <Collapsible open={isAddHolidayOpen} onOpenChange={setIsAddHolidayOpen}>
            <CardHeader className="flex flex-row items-start justify-between">
              <div>
                <CardTitle>Holidays</CardTitle>
                <CardDescription>Manage company holidays.</CardDescription>
              </div>
              <CollapsibleTrigger asChild>
                <Button size="sm" disabled={!canEdit}>
                  <Plus className="mr-2 h-4 w-4" /> Add Holiday
                </Button>
              </CollapsibleTrigger>
            </CardHeader>
            <CollapsibleContent>
              <div className="px-6 pb-6 border-b">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="holiday-name">Holiday Name</Label>
                      <Input id="holiday-name" value={newHolidayName} onChange={(e) => setNewHolidayName(e.target.value)} placeholder="e.g. New Year's Day" />
                    </div>
                    <div className="space-y-2">
                      <Label>Date</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant={"outline"}
                            className={cn(
                              "w-full justify-start text-left font-normal",
                              !newHolidayDate && "text-muted-foreground"
                            )}
                          >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {newHolidayDate ? format(newHolidayDate, "PPP") : <span>Pick a date</span>}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                          <Calendar
                            mode="single"
                            selected={newHolidayDate}
                            onSelect={setNewHolidayDate}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={resetHolidayForm}>Cancel</Button>
                        <Button onClick={handleAddHoliday}>Add</Button>
                    </div>
                  </div>
              </div>
            </CollapsibleContent>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right w-[50px]">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={3} className="h-24 text-center"><Skeleton className="h-10 w-full" /></TableCell></TableRow>
                  ) : holidays.length > 0 ? (
                    holidays.map(holiday => (
                      <TableRow key={holiday.id}>
                        <TableCell className="font-medium">{holiday.name}</TableCell>
                        <TableCell>{format(new Date(holiday.date), 'dd MMM, yyyy')}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" onClick={() => handleDeleteHoliday(holiday.id)} disabled={!canEdit}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center h-24">No holidays added yet.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Collapsible>
        </Card>
      </div>
    </div>
    </>
  );
}
