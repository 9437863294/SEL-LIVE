
import { NextRequest, NextResponse } from 'next/server';
import 'server-only';

export async function POST(req: NextRequest) {
    return NextResponse.json({ error: 'This API route is deprecated. Please use the generateUploadUrl flow.' }, { status: 410 });
}
