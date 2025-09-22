
'use server';

import { collection, getDocs, query, where, doc, getDoc, addDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { InsurancePolicy, ProjectInsurancePolicy, InsuranceTask, WorkflowStep } from '@/lib/types';
import { isWithinInterval, addDays, startOfDay, isPast, format as formatDate, subDays, setHours, setMinutes, setSeconds } from 'date-fns';
import { calculateDeadline, getAssigneeForStep } from '@/lib/workflow-utils';


async function processPolicies(
    policies: (InsurancePolicy | ProjectInsurancePolicy)[], 
    dateField: 'due_date' | 'insured_until',
    workflowSteps: WorkflowStep[]
) {
    let tasksCreated = 0;
    let tasksSkipped = 0;
    const thirtyDaysFromNow = addDays(new Date(), 30);
    const firstStep = workflowSteps[0];

    if (!firstStep) {
        throw new Error("Workflow is not configured correctly. No steps found.");
    }

    for (const policy of policies) {
        // @ts-ignore
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

                    const now = new Date();
                    if (taskCreationDate > now) {
                        taskCreationDate = now;
                    }
                    
                    const tempRequisitionDataForAssignment = {
                        // We pass a simplified object for assignment logic as it may not need all fields
                        projectId: (policy as ProjectInsurancePolicy).assetId || '', // Using assetId as a proxy
                        departmentId: '', // Not applicable for insurance
                        amount: policy.premium,
                    };
                    
                    // @ts-ignore
                    const assignedToId = await getAssigneeForStep(firstStep, tempRequisitionDataForAssignment);
                    if (!assignedToId) {
                        console.warn(`Could not determine assignee for policy ${policy.policy_no}, skipping task creation.`);
                        tasksSkipped++;
                        continue;
                    }

                    const deadline = await calculateDeadline(new Date(), firstStep.tat);
                    
                    await addDoc(collection(db, 'insuranceTasks'), {
                        id: taskId,
                        policyId: policy.id,
                        policyNo: (policy as InsurancePolicy).policy_no || (policy as ProjectInsurancePolicy).policy_no,
                        insuredPerson: (policy as InsurancePolicy).insured_person || (policy as ProjectInsurancePolicy).assetName,
                        dueDate: Timestamp.fromDate(dueDate),
                        status: 'Pending',
                        assignedTo: assignedToId,
                        createdAt: Timestamp.fromDate(taskCreationDate),
                        taskType: 'Premium Due',
                        currentStepId: firstStep.id,
                        currentStage: firstStep.name,
                        deadline: Timestamp.fromDate(deadline),
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
        const workflowDoc = await getDoc(doc(db, 'workflows', 'insurance-workflow'));
        if (!workflowDoc.exists() || !workflowDoc.data()?.steps?.length) {
            throw new Error("Insurance workflow is not configured. Please set it up in the settings.");
        }
        const workflowSteps = workflowDoc.data().steps as WorkflowStep[];
        
        // Fetch Personal Policies
        const personalPoliciesQuery = query(
            collection(db, 'insurance_policies'),
            where('status', '==', 'Active')
        );
        const personalPoliciesSnap = await getDocs(personalPoliciesQuery);
        const personalPolicies = personalPoliciesSnap.docs
            .map(doc => ({ id: doc.id, ...doc.data() } as InsurancePolicy))
            .filter(policy => policy.due_date); 
        const personalResult = await processPolicies(personalPolicies, 'due_date', workflowSteps);

        // Fetch Project Policies
        const projectPoliciesQuery = query(
            collection(db, 'project_insurance_policies'),
            where('status', '==', 'Active')
        );
        const projectPoliciesSnap = await getDocs(projectPoliciesQuery);
        const projectPolicies = projectPoliciesSnap.docs
            .map(doc => ({ id: doc.id, ...doc.data() } as ProjectInsurancePolicy))
            .filter(policy => policy.insured_until);
        const projectResult = await processPolicies(projectPolicies, 'insured_until', workflowSteps);

        const totalCreated = personalResult.tasksCreated + projectResult.tasksCreated;
        const totalSkipped = personalResult.tasksSkipped + projectResult.tasksSkipped;

        return { success: true, message: `Sync complete. ${totalCreated} new tasks created, ${totalSkipped} tasks already exist.` };

    } catch (error: any) {
        console.error("Error syncing insurance tasks:", error);
        return { success: false, message: error.message || 'An unknown error occurred.' };
    }
}
