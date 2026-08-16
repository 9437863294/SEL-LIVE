
'use server';

import { db } from './firebase';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import type {
    WorkflowStep,
    Requisition,
    AmountBasedCondition,
    WorkingHours,
    Holiday,
    AssignedTo
} from '@/lib/types';
import { addBusinessHours } from './working-hours';

// Caching for settings to avoid repeated Firestore reads within a single operation
let workingHoursCache: WorkingHours | null = null;
let holidaysCache: Holiday[] | null = null;

async function getWorkingHours(): Promise<WorkingHours> {
    if (workingHoursCache) return workingHoursCache;
    const docRef = doc(db, 'settings', 'workingHours');
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
        const data = docSnap.data();
        // Handle both the new structure { schedule: {...} } and the old flat structure
        const schedule = data.schedule || data;
        if (schedule && typeof schedule === 'object' && 'Monday' in schedule) {
            workingHoursCache = schedule as WorkingHours;
            return workingHoursCache;
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
    return addBusinessHours(startDate, tatHours, workingHours, holidays);
}


export async function getAssigneeForStep(step: WorkflowStep, requisition: Omit<Requisition, 'id' | 'createdAt'> | Record<string, any>): Promise<string[]> {
    const assignees: (string | undefined)[] = [];

    switch (step.assignmentType) {
        case 'User-based':
            if (Array.isArray(step.assignedTo)) {
                return step.assignedTo.filter((id): id is string => !!id);
            }
            break;

        case 'Project-based': {
            if (typeof step.assignedTo === 'object' && !Array.isArray(step.assignedTo) && requisition.projectId) {
                const assignmentMap = step.assignedTo as Record<string, { primary: string; alternative?: string }>;
                const assignment = assignmentMap[requisition.projectId];
                if (assignment) {
                    assignees.push(assignment.primary, assignment.alternative);
                }
            }
            break;
        }

        case 'Department-based': {
             if (typeof step.assignedTo === 'object' && !Array.isArray(step.assignedTo) && requisition.departmentId) {
                const assignmentMap = step.assignedTo as Record<string, { primary: string; alternative?: string }>;
                const assignment = assignmentMap[requisition.departmentId];
                 if (assignment) {
                    assignees.push(assignment.primary, assignment.alternative);
                }
            }
            break;
        }
        
        case 'Amount-based': {
            const conditions = step.assignedTo as AmountBasedCondition[];
            const amount = requisition.amount;
            
            for (const condition of conditions) {
                let match = false;
                if (condition.type === 'Below' && amount < condition.amount1) match = true;
                if (condition.type === 'Between' && amount >= condition.amount1 && amount <= (condition.amount2 ?? Infinity)) match = true;
                if (condition.type === 'Above' && amount > condition.amount1) match = true;
                
                if (match) {
                    assignees.push(condition.userId, condition.alternativeUserId);
                    break; // Stop at the first matching condition
                }
            }
            break;
        }
    }
    
    return assignees.filter((id): id is string => !!id);
}
