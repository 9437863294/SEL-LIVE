import { NextResponse } from 'next/server';

/**
 * Left over from the retention-claims screen, which was removed. Nothing calls it any more; it
 * answers 410 so a stale browser tab gets a clear reply. Safe to delete (with the dev server stopped).
 */
export const GET = () => NextResponse.json({ error: 'This endpoint is no longer used.' }, { status: 410 });
