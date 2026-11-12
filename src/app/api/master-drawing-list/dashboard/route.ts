import { NextResponse } from 'next/server';

/** Retired with the move to Project Management's register flow; every view now reads `items`. */
export const GET = () => NextResponse.json({ error: 'This endpoint is no longer used.' }, { status: 410 });
export const POST = GET;
