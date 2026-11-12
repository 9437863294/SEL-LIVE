import { mdlRoute } from '@/lib/master-drawing-list/server/context';
import { settingsView } from '@/lib/master-drawing-list/server/settings';

/** Settings pages: Schedules & Scopes (with what uses each value), Field Control, Date Control, and their recent changes. */
export const GET = mdlRoute('settings.get', async ({ context }) => settingsView(context));
