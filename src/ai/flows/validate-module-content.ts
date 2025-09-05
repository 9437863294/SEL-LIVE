'use server';

/**
 * @fileOverview This file defines a Genkit flow for validating module content against existing modules.
 *
 * The flow takes a new module's title and content, and a list of existing modules, and checks for consistency in tone and contradictory information.
 *
 * @module validate-module-content
 * @exports {
 *   validateModuleContent: function - The main function to validate module content.
 *   ValidateModuleContentInput: type - The input type for the validateModuleContent function.
 *   ValidateModuleContentOutput: type - The output type for the validateModuleContent function.
 * }
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const ValidateModuleContentInputSchema = z.object({
  newModuleTitle: z.string().describe('The title of the new module.'),
  newModuleContent: z.string().describe('The content of the new module.'),
  existingModules: z.array(
    z.object({
      title: z.string(),
      content: z.string(),
    })
  ).describe('An array of existing modules with their titles and contents.'),
});

export type ValidateModuleContentInput = z.infer<typeof ValidateModuleContentInputSchema>;

const ValidateModuleContentOutputSchema = z.object({
  isValid: z.boolean().describe('Whether the new module content is valid and consistent with existing modules.'),
  feedback: z.string().describe('Feedback on the validity of the new module content, including any inconsistencies or contradictions found.'),
});

export type ValidateModuleContentOutput = z.infer<typeof ValidateModuleContentOutputSchema>;


export async function validateModuleContent(input: ValidateModuleContentInput): Promise<ValidateModuleContentOutput> {
  return validateModuleContentFlow(input);
}

const validateModuleContentPrompt = ai.definePrompt({
  name: 'validateModuleContentPrompt',
  input: {schema: ValidateModuleContentInputSchema},
  output: {schema: ValidateModuleContentOutputSchema},
  prompt: `You are an expert content validator, responsible for ensuring that new module content is consistent in tone and does not contradict existing modules.

  New Module Title: {{{newModuleTitle}}}
  New Module Content: {{{newModuleContent}}}

  Existing Modules:
  {{#each existingModules}}
  Title: {{{this.title}}}
  Content: {{{this.content}}}
  {{/each}}

  Based on the above information, determine if the new module content is valid and consistent with the existing modules. Provide feedback explaining your reasoning, including any inconsistencies or contradictions found. Return a JSON object with "isValid" set to true or false, and "feedback" containing your explanation.
  `,
});

const validateModuleContentFlow = ai.defineFlow(
  {
    name: 'validateModuleContentFlow',
    inputSchema: ValidateModuleContentInputSchema,
    outputSchema: ValidateModuleContentOutputSchema,
  },
  async input => {
    const {output} = await validateModuleContentPrompt(input);
    return output!;
  }
);
