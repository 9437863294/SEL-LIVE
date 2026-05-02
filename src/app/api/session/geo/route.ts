import { NextRequest, NextResponse } from 'next/server';

const PRIVATE_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^::1$/,
  /^fc00:/,
  /^fe80:/,
];

function isPrivateIp(ip: string): boolean {
  return PRIVATE_RANGES.some((re) => re.test(ip));
}

function extractIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  // Next.js 14+ exposes req.ip
  const nextIp = (req as any).ip as string | undefined;
  if (nextIp) return nextIp.trim();
  return '127.0.0.1';
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ip = extractIp(req);

  if (isPrivateIp(ip)) {
    return NextResponse.json({
      ip,
      city: 'Local Network',
      region: '',
      country: '',
      countryCode: '',
      isp: '',
      lat: null,
      lon: null,
      timezone: '',
    });
  }

  try {
    const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
      headers: { 'User-Agent': 'SEL-SessionManager/1.0' },
      next: { revalidate: 300 },
    });

    if (!res.ok) throw new Error(`ipapi.co responded ${res.status}`);

    const data = await res.json();

    if (data?.error) {
      return NextResponse.json({ ip, city: '', region: '', country: '', countryCode: '', isp: '', lat: null, lon: null, timezone: '' });
    }

    return NextResponse.json({
      ip,
      city: String(data.city || ''),
      region: String(data.region || ''),
      country: String(data.country_name || ''),
      countryCode: String(data.country_code || '').toUpperCase(),
      isp: String(data.org || '').replace(/^AS\d+\s+/, ''), // strip ASN prefix
      lat: typeof data.latitude === 'number' ? data.latitude : null,
      lon: typeof data.longitude === 'number' ? data.longitude : null,
      timezone: String(data.timezone || ''),
    });
  } catch (err) {
    console.error('Session geo lookup failed', err);
    return NextResponse.json({ ip, city: '', region: '', country: '', countryCode: '', isp: '', lat: null, lon: null, timezone: '' });
  }
}
