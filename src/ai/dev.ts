
import { config } from 'dotenv';
config();

import '@/ai/flows/validate-module-content.ts';
import '@/ai/flows/suggest-module-tags.ts';
import '@/ai/flows/sync-greythr-flow.ts';
import '@/ai/flows/sync-categories-flow.ts';
import '@/ai/flows/get-all-employee-positions-flow.ts';
import '@/ai/flows/email-flow.ts';
