import { NextResponse } from 'next/server';
import { errorResponse, readJson, verifiedCaller } from '@/lib/appearance/api';
import { readPreferences, writePreferences } from '@/lib/appearance/server';

export const runtime = 'nodejs';

/**
 * The signed-in user's own appearance preferences — and only theirs: the document is chosen by the
 * verified token's uid, never by anything in the request, so nobody can read or write another
 * person's. Every value is validated against the fixed option lists before it is stored.
 */
export async function GET(request: Request) {
  try {
    const caller = await verifiedCaller(request);
    return NextResponse.json(await readPreferences(caller.uid, caller.legacyUserId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const caller = await verifiedCaller(request);
    const body = await readJson(request);
    return NextResponse.json(await writePreferences(caller.uid, body.preferences));
  } catch (error) {
    return errorResponse(error);
  }
}
