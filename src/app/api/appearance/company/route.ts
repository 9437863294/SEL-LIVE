import { NextResponse } from 'next/server';
import { DEFAULT_PUBLISHED, type PublishedAppearance } from '@/lib/appearance/model';
import { readPublished } from '@/lib/appearance/server';

export const runtime = 'nodejs';

/**
 * The published company appearance — branding and theme — for every client, signed in or not.
 *
 * Public on purpose: the sign-in page shows the company's logo and theme before anyone has signed
 * in, and none of this is sensitive. The one personal detail, who published it, is left out. If
 * the Admin SDK is unavailable the built-in defaults are served, so the app still renders.
 */
export async function GET() {
  let published: PublishedAppearance;
  let fallback = false;
  try {
    published = await readPublished();
  } catch (error) {
    console.error('[appearance] reading the published appearance failed:', error);
    published = DEFAULT_PUBLISHED;
    fallback = true;
  }
  return NextResponse.json(
    { published: { ...published, publishedBy: null }, fallback },
    { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=30, stale-while-revalidate=300' } },
  );
}
