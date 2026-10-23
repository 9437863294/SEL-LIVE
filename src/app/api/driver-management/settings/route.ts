import { readJson, tripRoute } from '@/lib/employee-trips/server/context';
import { getSettingsForEditing, saveSettings } from '@/lib/employee-trips/server/settings';

export const GET = tripRoute('settings.get', async ({ context }) => getSettingsForEditing(context));
export const PUT = tripRoute('settings.save', async ({ request, context }) => saveSettings(context, await readJson(request)));
