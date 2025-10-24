
'use server';

import { suggestModuleTags as suggestModuleTagsFlow, type SuggestModuleTagsInput, type SuggestModuleTagsOutput } from './flows/suggest-module-tags';
import { validateModuleContent as validateModuleContentFlow, type ValidateModuleContentInput, type ValidateModuleContentOutput } from './flows/validate-module-content';
import { syncGreytHR as syncGreytHRFlow, type SyncGreytHRInput, type SyncGreytHROutput } from './flows/sync-greythr-flow';
import { syncGreytHRCategories as syncGreytHRCategoriesFlow, type SyncCategoriesOutput } from './flows/sync-categories-flow';
import { getAllEmployeePositions as getAllEmployeePositionsFlow, type GetAllEmployeePositionsInput, type GetAllEmployeePositionsOutput } from './flows/get-all-employee-positions-flow';
import { getEmails as getEmailsFlow, type GetEmailsInput, type GetEmailsOutput } from './flows/email-flow';
import { sendEmailAuthorization as sendEmailAuthorizationFlow, type SendEmailAuthorizationInput, type SendEmailAuthorizationOutput } from './flows/send-email-authorization-flow';
import { createExpenseRequest as createExpenseRequestFlow, type CreateExpenseRequestInput, type CreateExpenseRequestOutput } from './flows/create-expense-request-flow';

export async function suggestModuleTags(input: SuggestModuleTagsInput): Promise<SuggestModuleTagsOutput> {
  return await suggestModuleTagsFlow(input);
}
export type { SuggestModuleTagsInput, SuggestModuleTagsOutput };

export async function validateModuleContent(input: ValidateModuleContentInput): Promise<ValidateModuleContentOutput> {
    return await validateModuleContentFlow(input);
}
export type { ValidateModuleContentInput, ValidateModuleContentOutput };

export async function syncGreytHR(input: SyncGreytHRInput): Promise<SyncGreytHROutput> {
    return await syncGreytHRFlow(input);
}
export type { SyncGreytHRInput, SyncGreytHROutput };

export async function syncGreytHRCategories(): Promise<SyncCategoriesOutput> {
    return await syncGreytHRCategoriesFlow();
}
export type { SyncCategoriesOutput };

export async function getAllEmployeePositions(input: GetAllEmployeePositionsInput): Promise<GetAllEmployeePositionsOutput> {
    return await getAllEmployeePositionsFlow(input);
}
export type { GetAllEmployeePositionsInput, GetAllEmployeePositionsOutput };

export async function getEmails(input: GetEmailsInput): Promise<GetEmailsOutput> {
    return await getEmailsFlow(input);
}
export type { GetEmailsInput, GetEmailsOutput };

export async function sendEmailAuthorization(input: SendEmailAuthorizationInput): Promise<SendEmailAuthorizationOutput> {
    return await sendEmailAuthorizationFlow(input);
}
export type { SendEmailAuthorizationInput, SendEmailAuthorizationOutput };

export async function createExpenseRequest(input: CreateExpenseRequestInput): Promise<CreateExpenseRequestOutput> {
    return await createExpenseRequestFlow(input);
}
export type { CreateExpenseRequestInput, CreateExpenseRequestOutput };
