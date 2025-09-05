
'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Trash2, Calendar as CalendarIcon } from 'lucide-react';
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
  const [workingHours, setWorkingHours] = useState<WorkingHours>(initialWorkingHours);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [isAddHolidayOpen, setIsAddHolidayOpen] = useState(false);
  const [newHolidayName, setNewHolidayName] = useState('');
  const [newHolidayDate, setNewHolidayDate] = useState<Date | undefined>();

  const fetchWorkingHours = useCallback(async () => {
    const docRef = doc(db, 'settings', 'workingHours');
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      setWorkingHours(docSnap.data() as WorkingHours);
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
    setIsLoading(true);
    Promise.all([fetchWorkingHours(), fetchHolidays()]).finally(() => setIsLoading(false));
  }, [fetchWorkingHours, fetchHolidays]);
  
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
    try {
      await setDoc(doc(db, 'settings', 'workingHours'), workingHours);
      toast({ title: 'Success', description: 'Working hours have been saved.' });
    } catch (error) {
      console.error("Error saving working hours: ", error);
      toast({ title: 'Error', description: 'Failed to save working hours.', variant: 'destructive' });
    }
  };

  const handleAddHoliday = async () => {
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
    try {
      await deleteDoc(doc(db, "holidays", id));
      toast({ title: "Success", description: "Holiday deleted successfully." });
      fetchHolidays();
    } catch (error) {
      console.error("Error deleting holiday: ", error);
      toast({ title: "Error", description: "Failed to delete holiday.", variant: "destructive" });
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/settings">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-6 w-6" /></Button>
        </Link>
        <h1 className="text-2xl font-bold">Working Hours</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Weekly Working Hours</CardTitle>
            <CardDescription>Set the standard working hours for each day of the week.</CardDescription>
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
                    />
                    <span className="text-sm text-muted-foreground">{workingHours[day]?.isWorkDay ? 'Work' : 'Off'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="time"
                      value={workingHours[day]?.startTime || '00:00'}
                      onChange={(e) => handleWorkingHoursChange(day, 'startTime', e.target.value)}
                      disabled={!workingHours[day]?.isWorkDay}
                      className="w-32"
                    />
                    <Input
                      type="time"
                      value={workingHours[day]?.endTime || '00:00'}
                      onChange={(e) => handleWorkingHoursChange(day, 'endTime', e.target.value)}
                      disabled={!workingHours[day]?.isWorkDay}
                      className="w-32"
                    />
                  </div>
                </div>
              ))
            )}
            <Button onClick={handleSaveWorkingHours} className="w-full">Save Hours</Button>
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
                <Button size="sm">
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
                          <Button variant="ghost" size="icon" onClick={() => handleDeleteHoliday(holiday.id)}>
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
  );
}
