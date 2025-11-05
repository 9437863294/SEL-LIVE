
'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Switch } from '@/components/ui/switch';
import { Send, Calendar as CalendarIcon, Clock, MapPin, Smile, Plus, X, Video } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import type { EventDetails } from '@/lib/types';

interface CreateEventDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onSendEvent: (details: EventDetails) => void;
}

export function CreateEventDialog({ isOpen, onOpenChange, onSendEvent }: CreateEventDialogProps) {
  const [eventName, setEventName] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState<Date | undefined>(new Date());
  const [startTime, setStartTime] = useState('22:30');
  const [showEndTime, setShowEndTime] = useState(false);
  const [location, setLocation] = useState('');
  const [isWhatsappCall, setIsWhatsappCall] = useState(false);

  useEffect(() => {
    if (isWhatsappCall) {
      setEventName('WhatsApp Call');
    } else {
      if (eventName === 'WhatsApp Call') {
        setEventName('');
      }
    }
  }, [isWhatsappCall, eventName]);

  const handleSend = () => {
    if (!eventName || !startDate) {
      // Add validation feedback if needed
      return;
    }
    
    const [hours, minutes] = startTime.split(':').map(Number);
    const finalStartDate = new Date(startDate);
    finalStartDate.setHours(hours, minutes);

    onSendEvent({
      eventName,
      description,
      startDate: finalStartDate.toISOString(),
      location,
      isWhatsappCall,
    });
    onOpenChange(false);
    // Reset form
    setEventName('');
    setDescription('');
    setStartDate(new Date());
    setIsWhatsappCall(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-0">
        <DialogHeader className="p-4 flex flex-row items-center justify-between border-b">
            <DialogTitle className="text-lg font-semibold">Create event</DialogTitle>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onOpenChange(false)}>
                <X className="h-4 w-4" />
            </Button>
        </DialogHeader>
        <div className="space-y-4 px-4 py-2">
            <div className="relative">
                <Input 
                    placeholder="Event name"
                    value={eventName}
                    onChange={(e) => setEventName(e.target.value)}
                    readOnly={isWhatsappCall}
                    className="pr-10 border-0 border-b-2 border-green-500 rounded-none focus-visible:ring-0 focus-visible:border-primary text-xl font-medium"
                />
                <Smile className="absolute right-2 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground"/>
            </div>
            <div className="relative">
                 <Textarea 
                    placeholder="Description (optional)"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="bg-muted border-none pr-10"
                />
                <Smile className="absolute right-2 top-3 h-5 w-5 text-muted-foreground"/>
            </div>

            <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Start date and time</Label>
                <div className="flex gap-2">
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="outline" className="flex-1 justify-start font-normal">
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {startDate ? format(startDate, 'PPP') : 'Select date'}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                            <Calendar mode="single" selected={startDate} onSelect={setStartDate} initialFocus />
                        </PopoverContent>
                    </Popover>
                     <div className="relative">
                        <Input 
                            type="time" 
                            value={startTime}
                            onChange={(e) => setStartTime(e.target.value)}
                            className="w-28"
                        />
                        <Clock className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"/>
                    </div>
                </div>
            </div>

            <Button variant="ghost" className="p-0 h-auto hover:bg-transparent text-sm" onClick={() => setShowEndTime(!showEndTime)}>
                <Plus className="mr-2 h-4 w-4" /> Add end time
            </Button>

             <div className="relative">
                <Input 
                    placeholder="Location (optional)"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="pr-10"
                />
                <MapPin className="absolute right-2 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground"/>
            </div>

            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Video className="h-5 w-5 text-muted-foreground"/>
                    <Label>WhatsApp call link</Label>
                </div>
                <Switch checked={isWhatsappCall} onCheckedChange={setIsWhatsappCall} />
            </div>

        </div>
        <DialogFooter className="pr-4 pb-4">
            <Button type="button" size="icon" className="rounded-full h-12 w-12 bg-green-600 hover:bg-green-700" onClick={handleSend}>
                <Send className="h-6 w-6" />
            </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
