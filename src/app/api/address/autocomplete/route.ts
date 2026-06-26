import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim()
  if (!q || q.length < 3) return NextResponse.json({ suggestions: [] })

  const { unitPrefix, streetQuery } = extractUnit(q)

  try {
    const url = new URL('https://nominatim.openstreetmap.org/search')
    url.searchParams.set('q', streetQuery)
    url.searchParams.set('countrycodes', 'au')
    url.searchParams.set('format', 'json')
    url.searchParams.set('addressdetails', '1')
    url.searchParams.set('limit', '6')

    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'ICFG-Property-Tracker/1.0 (contact@icfg.com.au)' },
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) {
      console.error('Nominatim error:', res.status, await res.text().catch(() => ''))
      return NextResponse.json({ suggestions: [] })
    }

    const data = await res.json()

    const suggestions = (data as NominatimResult[])
      .filter(r => r.address?.postcode && r.address?.state)
      .map(r => {
        const addr = r.address!
        const streetNum = addr.house_number ?? ''
        const road = addr.road ?? addr.pedestrian ?? addr.path ?? ''
        const baseStreet = [streetNum, road].filter(Boolean).join(' ')
        const suburb = addr.suburb ?? addr.city_district ?? addr.town ?? addr.village ?? addr.city ?? ''
        const state = normaliseState(addr.state ?? '')
        const postcode = addr.postcode ?? ''

        if (!baseStreet || !suburb || !state || !postcode) return null

        const street_address = unitPrefix ? `${unitPrefix}, ${baseStreet}` : baseStreet
        const label = unitPrefix
          ? `${street_address}, ${suburb} ${state} ${postcode}`
          : `${baseStreet}, ${suburb} ${state} ${postcode}`

        return { label, street_address, suburb, state, postcode }
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .filter((s, i, arr) => arr.findIndex(x => x.street_address === s.street_address && x.suburb === s.suburb) === i)

    return NextResponse.json({ suggestions })
  } catch (err) {
    console.error('Address autocomplete error:', err)
    return NextResponse.json({ suggestions: [] })
  }
}

/** Strip unit/apartment prefix so Nominatim gets a clean street query */
function extractUnit(q: string): { unitPrefix: string; streetQuery: string } {
  // "Unit 203, 8 Colton St" | "Apt 5, 10 Smith St" | "Level 2, 300 Ann St" | "Shop 3, 1 Queen St"
  const wordMatch = q.match(/^(Unit|Apt|Apartment|Level|Shop|Suite|Lot)\s+\S+[,\s]+(.+)/i)
  if (wordMatch) return { unitPrefix: wordMatch[1] + ' ' + q.slice(wordMatch[1].length).trim().split(/[,\s]+/)[0], streetQuery: wordMatch[2].trim() }

  // "203/8 Colton St" or "3/45 Smith Street"
  const slashMatch = q.match(/^(\d+)\/(.+)/)
  if (slashMatch) return { unitPrefix: `Unit ${slashMatch[1]}`, streetQuery: slashMatch[2].trim() }

  return { unitPrefix: '', streetQuery: q }
}

interface NominatimResult {
  display_name: string
  address?: {
    house_number?: string
    road?: string
    pedestrian?: string
    path?: string
    suburb?: string
    city_district?: string
    town?: string
    village?: string
    city?: string
    state?: string
    postcode?: string
  }
}

function normaliseState(raw: string): string {
  const map: Record<string, string> = {
    'queensland': 'QLD',
    'new south wales': 'NSW',
    'victoria': 'VIC',
    'south australia': 'SA',
    'western australia': 'WA',
    'tasmania': 'TAS',
    'northern territory': 'NT',
    'australian capital territory': 'ACT',
  }
  return map[raw.toLowerCase()] ?? raw.toUpperCase().slice(0, 3)
}
