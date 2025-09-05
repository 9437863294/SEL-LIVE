'use server';

/**
 * @fileOverview AI agent that suggests module tags based on the module title and content.
 *
 * - suggestModuleTags - A function that suggests module tags.
 * - SuggestModuleTagsInput - The input type for the suggestModuleTags function.
 * - SuggestModuleTagsOutput - The return type for the suggestModuleTags function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const SuggestModuleTagsInputSchema = z.object({
  title: z.string().describe('The title of the module.'),
  content: z.string().describe('The content of the module.'),
});
export type SuggestModuleTagsInput = z.infer<typeof SuggestModuleTagsInputSchema>;

const SuggestModuleTagsOutputSchema = z.object({
  tags: z.array(z.string()).describe('An array of suggested topic tags for the module.'),
});
export type SuggestModuleTagsOutput = z.infer<typeof SuggestModuleTagsOutputSchema>;

export async function suggestModuleTags(input: SuggestModuleTagsInput): Promise<SuggestModuleTagsOutput> {
  return suggestModuleTagsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'suggestModuleTagsPrompt',
  input: {schema: SuggestModuleTagsInputSchema},
  output: {schema: SuggestModuleTagsOutputSchema},
  prompt: `You are a helpful assistant that suggests topic tags for a module based on its title and content.

  Title: {{{title}}}
  Content: {{{content}}}

  Please provide an array of relevant topic tags that can be used to categorize the module.
  The topic tags should be concise and descriptive.
  Respond in a JSON format.`,
});

const suggestModuleTagsFlow = ai.defineFlow(
  {
    name: 'suggestModuleTagsFlow',
    inputSchema: SuggestModuleTagsInputSchema,
    outputSchema: SuggestModuleTagsOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
