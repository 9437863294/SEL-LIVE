

'use server';

import { suggestModuleTags as suggestModuleTagsFlow, type SuggestModuleTagsInput, type SuggestModuleTagsOutput } from './flows/suggest-module-tags';
import { validateModuleContent as validateModuleContentFlow, type ValidateModuleContentInput, type ValidateModuleContentOutput } from './flows/validate-module-content';
import type { SyncGreytHROutput } from './flows/sync-greythr-flow';
import { syncGreytHRCategories as syncGreytHRCategoriesFlow, type SyncCategoriesOutput } from './flows/sync-categories-flow';
import { getAllEmployeePositions as getAllEmployeePositionsFlow, type GetAllEmployeePositionsInput, type GetAllEmployeePositionsOutput } from './flows/get-all-employee-positions-flow';
import { createExpenseRequest as createExpenseRequestFlow } from './flows/create-expense-request-flow';
import type { CreateExpenseRequestInput, CreateExpenseRequestOutput } from '@/lib/types';
import { syncSalary as syncSalaryFlow, type SyncSalaryInput, type SyncSalaryOutput } from './flows/sync-salary-flow';

export async function suggestModuleTags(input: SuggestModuleTagsInput): Promise<SuggestModuleTagsOutput> {
  return await suggestModuleTagsFlow(input);
}

export async function validateModuleContent(input: ValidateModuleContentInput): Promise<ValidateModuleContentOutput> {
    return await validateModuleContentFlow(input);
}

export async function syncAllGreytHR(): Promise<SyncGreytHROutput> {
    // Kept as a non-mutating compatibility shim. The retired flow treats greytHR's numeric
    // employment-type code as an active/inactive state and can corrupt the employee mirror.
    // All real syncs must go through the authenticated /api/greythr/sync service.
    return {
      success: false,
      message: 'This sync action has been retired. Run greytHR sync from Employee Management.',
    };
}

export async function syncGreytHRCategories(): Promise<SyncCategoriesOutput> {
    return await syncGreytHRCategoriesFlow();
}

export async function getAllEmployeePositions(input: GetAllEmployeePositionsInput): Promise<GetAllEmployeePositionsOutput> {
    return await getAllEmployeePositionsFlow(input);
}

export async function createExpenseRequest(input: CreateExpenseRequestInput): Promise<CreateExpenseRequestOutput> {
    return await createExpenseRequestFlow(input);
}

export async function syncSalary(input: SyncSalaryInput): Promise<SyncSalaryOutput> {
    return await syncSalaryFlow(input);
}
