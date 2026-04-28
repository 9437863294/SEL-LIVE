import { NextRequest, NextResponse } from 'next/server';

const pickComponent = (components: Array<{ long_name: string; types: string[] }>, types: string[]) => {
  const match = components.find((item) => item.types.some((type) => types.includes(type)));
  return match?.long_name || '';
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const lat = Number(body?.lat);
    const lng = Number(body?.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ error: 'Valid lat/lng are required.' }, { status: 400 });
    }

    const apiKey = process.env.GOOGLE_MAPS_SERVER_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Google Maps server key is missing.' }, { status: 500 });
    }

    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${encodeURIComponent(
      `${lat},${lng}`
    )}&key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Geocoding request failed.' }, { status: 502 });
    }

    const payload = await response.json();
    const result = (payload?.results || [])[0];

    if (!result) {
      return NextResponse.json({
        formattedAddress: '',
        area: '',
        road: '',
        roadNumber: '',
        locality: '',
        city: '',
        district: '',
        state: '',
        postalCode: '',
        country: '',
      });
    }

    const components = (result.address_components || []) as Array<{ long_name: string; types: string[] }>;
    const area =
      pickComponent(components, ['sublocality_level_1', 'sublocality', 'neighborhood']) ||
      pickComponent(components, ['locality']);
    const road = pickComponent(components, ['route']);
    const roadNumber = pickComponent(components, ['street_number']);
    const locality = pickComponent(components, ['locality']);
    const city = locality || pickComponent(components, ['administrative_area_level_2']);
    const district = pickComponent(components, ['administrative_area_level_2']);
    const state = pickComponent(components, ['administrative_area_level_1']);
    const postalCode = pickComponent(components, ['postal_code']);
    const country = pickComponent(components, ['country']);

    return NextResponse.json({
      formattedAddress: String(result.formatted_address || ''),
      area,
      road,
      roadNumber,
      locality,
      city,
      district,
      state,
      postalCode,
      country,
    });
  } catch (error: any) {
    console.error('Reverse geocode API error', error);
    return NextResponse.json(
      { error: error?.message || 'Unexpected reverse geocode error.' },
      { status: 500 }
    );
  }
}
