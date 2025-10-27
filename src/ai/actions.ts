
'use server';

import { suggestModuleTags as suggestModuleTagsFlow, type SuggestModuleTagsInput, type SuggestModuleTagsOutput } from './flows/suggest-module-tags';
import { validateModuleContent as validateModuleContentFlow, type ValidateModuleContentInput, type ValidateModuleContentOutput } from './flows/validate-module-content';
import { syncGreytHR as syncGreytHRFlow, type SyncGreytHRInput, type SyncGreytHROutput } from './flows/sync-greythr-flow';
import { syncGreytHRCategories as syncGreytHRCategoriesFlow, type SyncCategoriesOutput } from './flows/sync-categories-flow';
import { getAllEmployeePositions as getAllEmployeePositionsFlow, type GetAllEmployeePositionsInput, type GetAllEmployeePositionsOutput } from './flows/get-all-employee-positions-flow';
import { createExpenseRequest as createExpenseRequestFlow, type CreateExpenseRequestInput, type CreateExpenseRequestOutput } from './flows/create-expense-request-flow';

export async function suggestModuleTags(input: SuggestModuleTagsInput): Promise<SuggestModuleTagsOutput> {
  return await suggestModuleTagsFlow(input);
}

export async function validateModuleContent(input: ValidateModuleContentInput): Promise<ValidateModuleContentOutput> {
    return await validateModuleContentFlow(input);
}

export async function syncGreytHR(input: SyncGreytHRInput): Promise<SyncGreytHROutput> {
    return await syncGreytHRFlow(input);
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
