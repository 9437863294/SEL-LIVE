
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import type { 
    WorkflowStep, 
    Requisition, 
    AmountBasedCondition, 
    WorkingHours, 
    Holiday 
} from '@/lib/types';
import { add, setHours, setMinutes, setSeconds, isSameDay, parse, formatISO } from 'date-fns';

// Caching for settings to avoid repeated Firestore reads within a single operation
let workingHoursCache: WorkingHours | null = null;
let holidaysCache: Holiday[] | null = null;

async function getWorkingHours(): Promise<WorkingHours> {
    if (workingHoursCache) return workingHoursCache;
    const docRef = doc(db, 'settings', 'workingHours');
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
        const data = docSnap.data();
        if (data && data.schedule) {
            workingHoursCache = data.schedule;
            return workingHoursCache!;
        }
    }
    throw new Error("Working hours not configured or in the wrong format.");
}

async function getHolidays(): Promise<Holiday[]> {
    if (holidaysCache) return holidaysCache;
    const querySnapshot = await getDocs(collection(db, 'holidays'));
    holidaysCache = querySnapshot.docs.map(doc => doc.data() as Holiday);
    return holidaysCache;
}

export async function calculateDeadline(startDate: Date, tatHours: number): Promise<Date> {
    const workingHours = await getWorkingHours();
    const holidays = await getHolidays();
    const holidayDates = holidays.map(h => parse(h.date, 'yyyy-MM-dd', new Date()));

    let remainingHours = tatHours;
    let currentDate = new Date(startDate);

    while (remainingHours > 0) {
        const dayOfWeek = currentDate.toLocaleDateString('en-US', { weekday: 'long' });
        const dayConfig = workingHours[dayOfWeek];

        const isHoliday = holidayDates.some(holidayDate => isSameDay(currentDate, holidayDate));

        if (dayConfig && dayConfig.isWorkDay && !isHoliday) {
            const [startHour, startMinute] = dayConfig.startTime.split(':').map(Number);
            const [endHour, endMinute] = dayConfig.endTime.split(':').map(Number);

            let dayStartTime = setSeconds(setMinutes(setHours(currentDate, startHour), startMinute), 0);
            let dayEndTime = setSeconds(setMinutes(setHours(currentDate, endHour), endMinute), 0);
            
            // If the start date is before working hours, advance it to the start of the working day
            if(currentDate < dayStartTime) {
                currentDate = dayStartTime;
            }

            // If the start date is after working hours, move to the next day and continue
            if (currentDate >= dayEndTime) {
                currentDate = add(currentDate, { days: 1 });
                currentDate = setSeconds(setMinutes(setHours(currentDate, 0), 0), 0);
                continue;
            }

            const remainingWorkHoursToday = (dayEndTime.getTime() - currentDate.getTime()) / (1000 * 60 * 60);

            if (remainingHours <= remainingWorkHoursToday) {
                currentDate = add(currentDate, { hours: remainingHours });
                remainingHours = 0;
            } else {
                remainingHours -= remainingWorkHoursToday;
                currentDate = add(currentDate, { days: 1 });
                currentDate = setSeconds(setMinutes(setHours(currentDate, 0), 0), 0);
            }
        } else {
            // It's a weekend or holiday, move to the next day
            currentDate = add(currentDate, { days: 1 });
            currentDate = setSeconds(setMinutes(setHours(currentDate, 0), 0), 0);
        }
    }
    return currentDate;
}


export async function getAssigneeForStep(step: WorkflowStep, requisition: Omit<Requisition, 'id' | 'createdAt'>): Promise<string | null> {
    switch (step.assignmentType) {
        case 'User-based':
            return Array.isArray(step.assignedTo) && step.assignedTo.length > 0 ? (step.assignedTo as string[])[0] : null;

        case 'Project-based': {
            if (typeof step.assignedTo === 'object' && !Array.isArray(step.assignedTo)) {
                const assignmentMap = step.assignedTo as Record<string, string>;
                return assignmentMap[requisition.projectId] || null;
            }
            return null;
        }

        case 'Department-based': {
             if (typeof step.assignedTo === 'object' && !Array.isArray(step.assignedTo)) {
                const assignmentMap = step.assignedTo as Record<string, string>;
                return assignmentMap[requisition.departmentId] || null;
            }
            return null;
        }
        
        case 'Amount-based': {
            const conditions = step.assignedTo as AmountBasedCondition[];
            const amount = requisition.amount;
            
            for (const condition of conditions) {
                if (condition.type === 'Below' && amount < condition.amount1) {
                    return condition.userId;
                }
                if (condition.type === 'Between' && amount >= condition.amount1 && amount <= (condition.amount2 ?? Infinity)) {
                    return condition.userId;
                }
                if (condition.type === 'Above' && amount > condition.amount1) {
                    return condition.userId;
                }
            }
            return null;
        }

        default:
            return null;
    }
}
