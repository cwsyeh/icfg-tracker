'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

interface NominatimResult {
  address?: {
    house_number?: string; road?: string; pedestrian?: string; path?: string
    suburb?: string; city_district?: string; town?: string; village?: string; city?: string
    state?: string; postcode?: string
  }
}

function extractUnit(q: string): { unitPrefix: string; streetQuery: string } {
  const wordMatch = q.match(/^(Unit|Apt|Apartment|Level|Shop|Suite|Lot)\s+\S+[,\s]+(.+)/i)
  if (wordMatch) return { unitPrefix: wordMatch[1] + ' ' + q.slice(wordMatch[1].length).trim().split(/[,\s]+/)[0], streetQuery: wordMatch[2].trim() }
  const slashMatch = q.match(/^(\d+)\/(.+)/)
  if (slashMatch) return { unitPrefix: `Unit ${slashMatch[1]}`, streetQuery: slashMatch[2].trim() }
  return { unitPrefix: '', streetQuery: q }
}

function normaliseState(raw: string): string {
  const map: Record<string, string> = {
    'queensland': 'QLD', 'new south wales': 'NSW', 'victoria': 'VIC',
    'south australia': 'SA', 'western australia': 'WA', 'tasmania': 'TAS',
    'northern territory': 'NT', 'australian capital territory': 'ACT',
  }
  return map[raw.toLowerCase()] ?? raw.toUpperCase().slice(0, 3)
}

interface Suggestion {
  label: string
  street_address: string
  suburb: string
  state: string
  postcode: string
}

interface Props {
  value: string
  onChange: (value: string) => void
  onSelect: (s: Suggestion) => void
  placeholder?: string
  inputStyle?: React.CSSProperties
}

export default function AddressAutocomplete({ value, onChange, onSelect, placeholder, inputStyle }: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const fetchSuggestions = useCallback((q: string) => {
    if (q.length < 3) { setSuggestions([]); setOpen(false); return }
    setLoading(true)

    const { unitPrefix, streetQuery } = extractUnit(q)
    const url = new URL('https://nominatim.openstreetmap.org/search')
    url.searchParams.set('q', streetQuery)
    url.searchParams.set('countrycodes', 'au')
    url.searchParams.set('format', 'json')
    url.searchParams.set('addressdetails', '1')
    url.searchParams.set('limit', '6')

    fetch(url.toString(), { headers: { 'Accept-Language': 'en-AU' }, signal: AbortSignal.timeout(5000) })
      .then(r => r.json())
      .then((data: NominatimResult[]) => {
        const suggestions = data
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
            const label = `${street_address}, ${suburb} ${state} ${postcode}`
            return { label, street_address, suburb, state, postcode }
          })
          .filter((s): s is NonNullable<typeof s> => s !== null)
          .filter((s, i, arr) => arr.findIndex(x => x.street_address === s.street_address && x.suburb === s.suburb) === i)
        setSuggestions(suggestions)
        setOpen(suggestions.length > 0)
      })
      .catch(() => setSuggestions([]))
      .finally(() => setLoading(false))
  }, [])

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    onChange(val)
    setActiveIdx(-1)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => fetchSuggestions(val), 300)
  }

  function handleSelect(s: Suggestion) {
    onChange(s.street_address)
    onSelect(s)
    setOpen(false)
    setSuggestions([])
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, suggestions.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); handleSelect(suggestions[activeIdx]) }
    else if (e.key === 'Escape') { setOpen(false) }
  }

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          placeholder={placeholder ?? 'Start typing an address…'}
          autoComplete="off"
          style={inputStyle}
        />
        {loading && (
          <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14 }}>
            <svg viewBox="0 0 14 14" style={{ animation: 'spin .7s linear infinite', display: 'block', width: 14, height: 14 }}>
              <circle cx="7" cy="7" r="5" fill="none" stroke="#d1d5db" strokeWidth="2"/>
              <path d="M7 2 A5 5 0 0 1 12 7" fill="none" stroke="#5c6478" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </span>
        )}
      </div>
      {open && suggestions.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 9999,
          background: '#fff', border: '1px solid #e4e7f0', borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,.12)', overflow: 'hidden', marginTop: 3,
        }}>
          {suggestions.map((s, i) => (
            <div key={i} onMouseDown={() => handleSelect(s)}
              style={{
                padding: '9px 13px', cursor: 'pointer', fontSize: 12.5,
                background: i === activeIdx ? '#eff6ff' : '#fff',
                borderBottom: i < suggestions.length - 1 ? '1px solid #f3f4f6' : 'none',
              }}
              onMouseEnter={() => setActiveIdx(i)}>
              <div style={{ fontWeight: 600, color: '#1a1e2e', marginBottom: 1 }}>{s.street_address}</div>
              <div style={{ color: '#5c6478' }}>{s.suburb} {s.state} {s.postcode}</div>
            </div>
          ))}
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
