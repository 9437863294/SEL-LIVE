
'use server';

import { collection, getDocs, query, where, doc, getDoc, addDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { InsurancePolicy, ProjectInsurancePolicy, InsuranceTask } from '@/lib/types';
import { isWithinInterval, addDays, startOfDay, isPast, format as formatDate, subDays, setHours, setMinutes, setSeconds } from 'date-fns';

async function processPolicies(
    policies: (InsurancePolicy | ProjectInsurancePolicy)[], 
    dateField: 'due_date' | 'insured_until',
    ASSIGNED_USER_ID: string
) {
    let tasksCreated = 0;
    let tasksSkipped = 0;
    const thirtyDaysFromNow = addDays(new Date(), 30);

    for (const policy of policies) {
        const policyDate = policy[dateField];
        if (policyDate) {
            const dueDate = policyDate.toDate();
            
            const isOverdue = isPast(dueDate);
            const isDueSoon = isWithinInterval(dueDate, { start: startOfDay(new Date()), end: thirtyDaysFromNow });

            if (isOverdue || isDueSoon) {
                const taskId = `${policy.id}-${formatDate(dueDate, 'yyyy-MM-dd')}`;
                const q = query(collection(db, 'insuranceTasks'), where('id', '==', taskId));
                const taskSnap = await getDocs(q);

                if (taskSnap.empty) {
                    // Calculate the timestamp for 30 days before the due date at 09:30
                    let taskCreationDate = subDays(dueDate, 30);
                    taskCreationDate = setHours(taskCreationDate, 9);
                    taskCreationDate = setMinutes(taskCreationDate, 30);
                    taskCreationDate = setSeconds(taskCreationDate, 0);

                    // If the calculated creation date is in the future, use the current time instead.
                    // This handles policies that are already overdue or are very close to their due date.
                    const now = new Date();
                    if (taskCreationDate > now) {
                        taskCreationDate = now;
                    }
                    
                    await addDoc(collection(db, 'insuranceTasks'), {
                        id: taskId,
                        policyId: policy.id,
                        policyNo: (policy as InsurancePolicy).policy_no || (policy as ProjectInsurancePolicy).policy_no,
                        insuredPerson: (policy as InsurancePolicy).insured_person || (policy as ProjectInsurancePolicy).assetName,
                        dueDate: Timestamp.fromDate(dueDate),
                        status: 'Pending',
                        assignedTo: ASSIGNED_USER_ID,
                        createdAt: Timestamp.fromDate(taskCreationDate),
                        taskType: 'Premium Due',
                    });
                    tasksCreated++;
                } else {
                    tasksSkipped++;
                }
            }
        }
    }
    return { tasksCreated, tasksSkipped };
}


export async function syncInsuranceTasks(userId: string) {
    if (!userId) {
        return { success: false, message: 'User ID is required.' };
    }

    try {
        const ASSIGNED_USER_ID = userId;
        
        // Fetch Personal Policies - Note: Personal policies don't have a status field yet.
        const personalPoliciesQuery = query(
            collection(db, 'insurance_policies'),
            where('due_date', '!=', null)
        );
        const personalPoliciesSnap = await getDocs(personalPoliciesQuery);
        const personalPolicies = personalPoliciesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as InsurancePolicy));
        const personalResult = await processPolicies(personalPolicies, 'due_date', ASSIGNED_USER_ID);

        // Fetch Project Policies
        const projectPoliciesQuery = query(
            collection(db, 'project_insurance_policies'),
            where('insured_until', '!=', null),
            where('status', '==', 'Active')
        );
        const projectPoliciesSnap = await getDocs(projectPoliciesQuery);
        const projectPolicies = projectPoliciesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProjectInsurancePolicy));
        const projectResult = await processPolicies(projectPolicies, 'insured_until', ASSIGNED_USER_ID);

        const totalCreated = personalResult.tasksCreated + projectResult.tasksCreated;
        const totalSkipped = personalResult.tasksSkipped + projectResult.tasksSkipped;

        return { success: true, message: `Sync complete. ${totalCreated} new tasks created, ${totalSkipped} tasks already exist.` };

    } catch (error: any) {
        console.error("Error syncing insurance tasks:", error);
        return { success: false, message: error.message || 'An unknown error occurred.' };
    }
}
