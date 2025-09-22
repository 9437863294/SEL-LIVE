
'use server';

import { collection, getDocs, query, where, doc, getDoc, addDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { InsurancePolicy, InsuranceTask } from '@/lib/types';
import { isWithinInterval, addDays, startOfDay, isPast, format as formatDate } from 'date-fns';

export async function syncInsuranceTasks(userId: string) {
    if (!userId) {
        return { success: false, message: 'User ID is required.' };
    }

    try {
        const ASSIGNED_USER_ID = '0EaO3vscq1bNqVfASsUa6MNe3nN2'; 
        const thirtyDaysFromNow = addDays(new Date(), 30);

        const policiesQuery = query(
            collection(db, 'insurance_policies'),
            where('due_date', '!=', null)
        );

        const policiesSnap = await getDocs(policiesQuery);
        const policies = policiesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as InsurancePolicy));

        let tasksCreated = 0;
        let tasksSkipped = 0;

        for (const policy of policies) {
            if (policy.due_date) {
                const dueDate = policy.due_date.toDate();
                
                const isOverdue = isPast(dueDate);
                const isDueSoon = isWithinInterval(dueDate, { start: startOfDay(new Date()), end: thirtyDaysFromNow });

                if (isOverdue || isDueSoon) {
                    const taskId = `${policy.id}-${formatDate(dueDate, 'yyyy-MM-dd')}`;
                    const q = query(collection(db, 'insuranceTasks'), where('id', '==', taskId));
                    const taskSnap = await getDocs(q);

                    if (taskSnap.empty) {
                        await addDoc(collection(db, 'insuranceTasks'), {
                            id: taskId,
                            policyId: policy.id,
                            policyNo: policy.policy_no,
                            insuredPerson: policy.insured_person,
                            dueDate: Timestamp.fromDate(dueDate),
                            status: 'Pending',
                            assignedTo: ASSIGNED_USER_ID,
                            createdAt: Timestamp.now(),
                            taskType: 'Premium Due',
                        });
                        tasksCreated++;
                    } else {
                        tasksSkipped++;
                    }
                }
            }
        }
        return { success: true, message: `Sync complete. ${tasksCreated} new tasks created, ${tasksSkipped} tasks already exist.` };

    } catch (error: any) {
        console.error("Error syncing insurance tasks:", error);
        return { success: false, message: error.message || 'An unknown error occurred.' };
    }
}
