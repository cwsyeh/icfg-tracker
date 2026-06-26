'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import AddressAutocomplete from '@/components/ui/AddressAutocomplete'

const BLUE = '#2563a8'

type AcqType = 'stamp_duty' | 'legal_conveyancing' | 'building_inspection' | 'buyers_agent' | 'loan_establishment' | 'other'
const ACQ_LABELS: Record<AcqType, string> = {
  stamp_duty: 'Stamp duty',
  legal_conveyancing: 'Legal / conveyancing',
  building_inspection: 'Building & pest inspection',
  buyers_agent: "Buyer's agent fee",
  loan_establishment: 'Loan establishment fee',
  other: 'Other',
}
const ACQ_NAMED: AcqType[] = ['stamp_duty', 'legal_conveyancing', 'building_inspection', 'buyers_agent', 'loan_establishment']

interface AcqRow { type: AcqType; amount: string; description: string }

interface Props { onClose: () => void }

type PropertyType = 'established' | 'house_and_land' | 'land' | 'off_the_plan'
type Usage = 'investment' | 'ppor' | 'mixed'

export default function AddPropertyModal({ onClose }: Props) {
  const router = useRouter()

  // Step: 'type' | 'basics' | 'construction' | 'purchase' | 'confirm'
  const [step, setStep] = useState<'type' | 'basics' | 'construction' | 'purchase' | 'confirm'>('type')

  const [propertyType, setPropertyType] = useState<PropertyType | null>(null)
  const [basics, setBasics] = useState({ name: '', street_address: '', suburb: '', state: 'QLD', postcode: '', usage: 'investment' as Usage, mixed_use_pct: '', ownership_pct: '100' })
  const [purchase, setPurchase] = useState({ purchase_date: '', settlement_date: '', purchase_price: '', deposit_paid: '', capitalise_interest: false })
  const [acqForm, setAcqForm] = useState<AcqRow[]>([])
  const [construction, setConstruction] = useState({
    land_value: '',
    land_settlement_date: '',
    builder: '',
    contract_amount: '',
    expected_start: '',
    capitalise_interest: false,
    status: 'pre_construction' as 'pre_construction' | 'in_progress',
  })

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const s: React.CSSProperties = { width: '100%', padding: '8px 11px', border: '1px solid #e4e7f0', borderRadius: 8, fontSize: 13, color: '#1a1e2e', outline: 'none', boxSizing: 'border-box', background: '#fff' }
  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 6 }

  const isHL = propertyType === 'house_and_land'
  const isOTP = propertyType === 'off_the_plan'

  function nextFromType() {
    if (!propertyType) { setError('Please select a property type'); return }
    setError(null)
    setStep('basics')
  }

  function nextFromBasics() {
    if (!basics.street_address.trim() || !basics.suburb.trim() || !basics.postcode.trim()) { setError('Full address is required'); return }
    if (!basics.name.trim()) setBasics(x => ({ ...x, name: `${x.street_address}, ${x.suburb}` }))
    if (basics.usage === 'mixed' && !basics.mixed_use_pct) { setError('Investment use % is required for mixed-use'); return }
    const pct = parseFloat(basics.ownership_pct)
    if (isNaN(pct) || pct <= 0 || pct > 100) { setError('Ownership must be between 1 and 100%'); return }
    setError(null)
    setStep(isHL ? 'construction' : 'purchase')

  }

  function nextFromConstruction() {
    if (!construction.land_value) { setError('Land value is required'); return }
    setError(null)
    setStep('purchase')
  }

  function nextFromPurchase() {
    if (!purchase.purchase_date) { setError(`${isHL ? 'Land contract date' : 'Purchase date'} is required`); return }
    if (!purchase.purchase_price) { setError(`${isHL ? 'Land purchase price' : 'Purchase price'} is required`); return }
    setError(null)
    setStep('confirm')
  }

  async function handleCreate() {
    setSaving(true); setError(null)
    const validCosts = acqForm.filter(r => r.amount && !isNaN(parseFloat(r.amount))).map(r => ({ type: r.type, amount: parseFloat(r.amount), description: r.description || null }))

    const body: Record<string, unknown> = {
      name: basics.name.trim(),
      street_address: basics.street_address.trim(),
      suburb: basics.suburb.trim(),
      state: basics.state,
      postcode: basics.postcode.trim(),
      usage: basics.usage,
      mixed_use_investment_percent: basics.usage === 'mixed' && basics.mixed_use_pct ? parseFloat(basics.mixed_use_pct) : null,
      ownership_pct: parseFloat(basics.ownership_pct),
      property_type: propertyType,
      purchase_date: purchase.purchase_date || null,
      settlement_date: purchase.settlement_date || null,
      purchase_price: purchase.purchase_price ? parseFloat(purchase.purchase_price) : null,
      acquisition_costs: validCosts,
      capitalise_construction_interest: isOTP ? purchase.capitalise_interest : false,
      deposit_paid: isOTP && purchase.deposit_paid ? parseFloat(purchase.deposit_paid) : null,
    }

    if (isHL) {
      body.land_value = construction.land_value ? parseFloat(construction.land_value) : null
      body.construction_builder = construction.builder || null
      body.construction_contract_amount = construction.contract_amount ? parseFloat(construction.contract_amount) : null
      body.construction_start_date = construction.expected_start || null
      body.capitalise_construction_interest = construction.capitalise_interest
      body.construction_status = construction.status
    }

    try {
      const res = await fetch('/api/properties/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (data.success) {
        router.push(`/properties/${data.property_id}`)
        onClose()
      } else {
        setError(data.error ?? 'Failed to create property')
      }
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  const STEPS_HL = ['Type', 'Address', 'Construction', 'Purchase', 'Confirm']
  const STEPS_STD = ['Type', 'Address', 'Purchase', 'Confirm']
  const stepLabels = isHL ? STEPS_HL : STEPS_STD
  const stepIndex = { type: 0, basics: 1, construction: 2, purchase: isHL ? 3 : 2, confirm: isHL ? 4 : 3 }[step]

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 540, boxShadow: '0 20px 60px rgba(0,0,0,.25)', maxHeight: '90vh', overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e4e7f0', position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>Add Property</h2>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: '#9ca3af', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
          </div>
          {/* Progress */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {stepLabels.map((label, i) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 20, height: 20, borderRadius: '50%', background: i < stepIndex ? '#dcfce7' : i === stepIndex ? BLUE : '#e4e7f0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {i < stepIndex
                      ? <svg width="10" height="10" viewBox="0 0 10 10"><polyline points="1.5,5 4,7.5 8.5,2.5" fill="none" stroke="#15803d" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      : <span style={{ fontSize: 9, fontWeight: 800, color: i === stepIndex ? '#fff' : '#9ca3af' }}>{i + 1}</span>
                    }
                  </div>
                  <span style={{ fontSize: 11, fontWeight: i === stepIndex ? 700 : 500, color: i === stepIndex ? '#1a1e2e' : '#9ca3af', whiteSpace: 'nowrap' }}>{label}</span>
                </div>
                {i < stepLabels.length - 1 && <div style={{ width: 16, height: 1, background: '#e4e7f0', flexShrink: 0 }} />}
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px' }}>

          {/* Step: Type */}
          {step === 'type' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ margin: '0 0 4px', fontSize: 13, color: '#5c6478' }}>What type of property are you adding?</p>
              {([
                { type: 'established' as PropertyType, label: 'Established', desc: 'An existing house, unit, or townhouse', icon: '🏠' },
                { type: 'off_the_plan' as PropertyType, label: 'Off The Plan', desc: 'Unit or apartment purchased before completion — settlement TBD', icon: '🏢' },
                { type: 'house_and_land' as PropertyType, label: 'House & Land', desc: 'Land with a build contract — track construction stages', icon: '🏗️' },
                { type: 'land' as PropertyType, label: 'Vacant Land', desc: 'Land only — no build contract yet', icon: '🌳' },
              ] as const).map(opt => (
                <div key={opt.type} onClick={() => setPropertyType(opt.type)}
                  style={{ padding: '14px 16px', border: `2px solid ${propertyType === opt.type ? BLUE : '#e4e7f0'}`, borderRadius: 10, cursor: 'pointer', display: 'flex', gap: 14, alignItems: 'center', background: propertyType === opt.type ? '#eff6ff' : '#fff', transition: '.12s' }}>
                  <span style={{ fontSize: 24, lineHeight: 1 }}>{opt.icon}</span>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: '#1a1e2e', marginBottom: 2 }}>{opt.label}</div>
                    <div style={{ fontSize: 12, color: '#5c6478' }}>{opt.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Step: Basics (address + usage) */}
          {step === 'basics' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={lbl}>Property name <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: '#9ca3af' }}>(optional — defaults to address)</span></label>
                <input value={basics.name} onChange={e => setBasics(x => ({ ...x, name: e.target.value }))} style={s} placeholder="Leave blank to use address" />
              </div>
              <div>
                <label style={lbl}>Street address</label>
                <AddressAutocomplete
                  value={basics.street_address}
                  onChange={v => setBasics(x => ({ ...x, street_address: v }))}
                  onSelect={suggestion => setBasics(x => ({
                    ...x,
                    street_address: suggestion.street_address,
                    suburb: suggestion.suburb,
                    state: suggestion.state,
                    postcode: suggestion.postcode,
                    name: x.name.trim() ? x.name : `${suggestion.street_address}, ${suggestion.suburb}`,
                  }))}
                  inputStyle={s}
                  placeholder="Start typing an address…"
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 80px', gap: 10 }}>
                <div>
                  <label style={lbl}>Suburb</label>
                  <input value={basics.suburb} onChange={e => setBasics(x => ({ ...x, suburb: e.target.value }))} style={s} />
                </div>
                <div>
                  <label style={lbl}>State</label>
                  <select value={basics.state} onChange={e => setBasics(x => ({ ...x, state: e.target.value }))} style={{ ...s, appearance: 'auto' }}>
                    {['QLD','NSW','VIC','SA','WA','TAS','NT','ACT'].map(st => <option key={st}>{st}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Postcode</label>
                  <input value={basics.postcode} onChange={e => setBasics(x => ({ ...x, postcode: e.target.value }))} style={s} maxLength={4} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={lbl}>Usage</label>
                  <select value={basics.usage} onChange={e => setBasics(x => ({ ...x, usage: e.target.value as Usage }))} style={{ ...s, appearance: 'auto' }}>
                    <option value="investment">Investment</option>
                    <option value="ppor">Primary residence (PPOR)</option>
                    <option value="mixed">Mixed use</option>
                  </select>
                </div>
                <div>
                  <label style={lbl}>Your ownership (%)</label>
                  <input type="number" min="1" max="100" step="1" value={basics.ownership_pct} onChange={e => setBasics(x => ({ ...x, ownership_pct: e.target.value }))} style={s} placeholder="e.g. 50" />
                </div>
              </div>
              {basics.usage === 'mixed' && (
                <div>
                  <label style={lbl}>Investment use (%)</label>
                  <input type="number" min="1" max="100" step="1" value={basics.mixed_use_pct}
                    onChange={e => {
                      const v = e.target.value
                      if (v === '' || (Number(v) >= 1 && Number(v) <= 100)) setBasics(x => ({ ...x, mixed_use_pct: v }))
                    }}
                    style={s} placeholder="e.g. 60" />
                </div>
              )}
            </div>
          )}

          {/* Step: Construction (H&L only) */}
          {step === 'construction' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ padding: '10px 14px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, fontSize: 12.5, color: '#1e40af' }}>
                House & Land — enter land and build contract details. You can update these later once the build progresses.
              </div>

              <div style={{ fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase', letterSpacing: '.06em', borderBottom: '1px solid #f0f2f7', paddingBottom: 6 }}>Land</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={lbl}>Land value *</label>
                  <input type="number" step="1000" value={construction.land_value} onChange={e => setConstruction(x => ({ ...x, land_value: e.target.value }))} style={s} placeholder="e.g. 350000" />
                </div>
                <div>
                  <label style={lbl}>Land contract date</label>
                  <input type="date" value={construction.land_settlement_date} onChange={e => setConstruction(x => ({ ...x, land_settlement_date: e.target.value }))} style={s} />
                </div>
              </div>

              <div style={{ fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase', letterSpacing: '.06em', borderBottom: '1px solid #f0f2f7', paddingBottom: 6, marginTop: 4 }}>Build Contract</div>
              <div>
                <label style={lbl}>Builder</label>
                <input value={construction.builder} onChange={e => setConstruction(x => ({ ...x, builder: e.target.value }))} style={s} placeholder="e.g. Metricon" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={lbl}>Contract amount</label>
                  <input type="number" step="1000" value={construction.contract_amount} onChange={e => setConstruction(x => ({ ...x, contract_amount: e.target.value }))} style={s} placeholder="e.g. 280000" />
                </div>
                <div>
                  <label style={lbl}>Expected start date</label>
                  <input type="date" value={construction.expected_start} onChange={e => setConstruction(x => ({ ...x, expected_start: e.target.value }))} style={s} />
                </div>
              </div>

              <div>
                <label style={lbl}>Construction status</label>
                <select value={construction.status} onChange={e => setConstruction(x => ({ ...x, status: e.target.value as typeof construction.status }))} style={{ ...s, appearance: 'auto' }}>
                  <option value="pre_construction">Pre-construction (not started)</option>
                  <option value="in_progress">In progress (already underway)</option>
                </select>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '10px 12px', background: '#f8fafc', border: '1px solid #e4e7f0', borderRadius: 8 }}>
                <input type="checkbox" checked={construction.capitalise_interest} onChange={e => setConstruction(x => ({ ...x, capitalise_interest: e.target.checked }))}
                  style={{ width: 16, height: 16, accentColor: BLUE, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1e2e' }}>Capitalise construction interest</div>
                  <div style={{ fontSize: 11.5, color: '#5c6478', marginTop: 2 }}>Interest during construction is added to cost base instead of expensed</div>
                </div>
              </label>
            </div>
          )}

          {/* Step: Purchase details + acquisition costs */}
          {step === 'purchase' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={lbl}>{isHL ? 'Land contract date' : 'Contract date'} <span style={{ color: '#c8332a' }}>*</span></label>
                  <input type="date" value={purchase.purchase_date} onChange={e => setPurchase(x => ({ ...x, purchase_date: e.target.value }))} style={{ ...s, ...(error?.includes('date') ? { borderColor: '#fca5a5' } : {}) }} />
                </div>
                {!isHL && (
                  <div>
                    <label style={lbl}>Settlement date</label>
                    <input type="date" value={purchase.settlement_date} onChange={e => setPurchase(x => ({ ...x, settlement_date: e.target.value }))} style={s} />
                  </div>
                )}
                <div>
                  <label style={lbl}>{isHL ? 'Total purchase price (land)' : 'Purchase price'} <span style={{ color: '#c8332a' }}>*</span></label>
                  <input type="number" step="1000" value={purchase.purchase_price} onChange={e => setPurchase(x => ({ ...x, purchase_price: e.target.value }))} style={{ ...s, ...(error?.includes('price') ? { borderColor: '#fca5a5' } : {}) }} placeholder="e.g. 750000" />
                </div>
              </div>

              {isOTP && (
                <div>
                  <label style={lbl}>Deposit paid</label>
                  <input type="number" step="1000" value={purchase.deposit_paid}
                    onChange={e => setPurchase(x => ({ ...x, deposit_paid: e.target.value }))}
                    style={s} placeholder="e.g. 134000" />
                </div>
              )}

              {isOTP && (
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={purchase.capitalise_interest as unknown as boolean}
                    onChange={e => setPurchase(x => ({ ...x, capitalise_interest: e.target.checked }))}
                    style={{ width: 15, height: 15, marginTop: 2, accentColor: '#1d4ed8', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1e2e' }}>Capitalise construction interest</div>
                    <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 2 }}>Interest during construction is added to cost base instead of expensed</div>
                  </div>
                </label>
              )}

              <div style={{ borderTop: '1px solid #f0f2f7', paddingTop: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 12 }}>Acquisition Costs</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {ACQ_NAMED.map(type => {
                    const existing = acqForm.find(r => r.type === type)
                    return (
                      <div key={type} style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 10, alignItems: 'center' }}>
                        <label style={{ fontSize: 12.5, color: '#5c6478' }}>{ACQ_LABELS[type]}</label>
                        <input type="number" step="100" placeholder="—" value={existing?.amount ?? ''}
                          onChange={e => {
                            const val = e.target.value
                            setAcqForm(prev => { const filtered = prev.filter(r => r.type !== type); return val ? [...filtered, { type, amount: val, description: '' }] : filtered })
                          }}
                          style={{ ...s, textAlign: 'right' }} />
                      </div>
                    )
                  })}
                  {acqForm.filter(r => r.type === 'other').map((row, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 140px 28px', gap: 8, alignItems: 'center' }}>
                      <input value={row.description} placeholder="Description"
                        onChange={e => {
                          const others = acqForm.filter(r => r.type === 'other')
                          setAcqForm(prev => prev.map(r => r === others[i] ? { ...r, description: e.target.value } : r))
                        }}
                        style={{ ...s, fontSize: 12.5 }} />
                      <input type="number" step="100" value={row.amount}
                        onChange={e => {
                          const others = acqForm.filter(r => r.type === 'other')
                          setAcqForm(prev => prev.map(r => r === others[i] ? { ...r, amount: e.target.value } : r))
                        }}
                        style={{ ...s, textAlign: 'right' }} />
                      <button onClick={() => setAcqForm(prev => { const others = prev.filter(r => r.type === 'other'); return prev.filter(r => !(r.type === 'other' && others.indexOf(r) === i)) })}
                        style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, color: '#c8332a', cursor: 'pointer', fontWeight: 700, fontSize: 14, lineHeight: 1, padding: '4px 6px' }}>×</button>
                    </div>
                  ))}
                  <button onClick={() => setAcqForm(prev => [...prev, { type: 'other', amount: '', description: '' }])}
                    style={{ alignSelf: 'flex-start', background: 'none', border: '1px dashed #d1d5db', borderRadius: 7, padding: '5px 12px', fontSize: 12, color: '#5c6478', cursor: 'pointer' }}>
                    + Add other cost
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Step: Confirm */}
          {step === 'confirm' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ background: '#f8fafc', borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { label: 'Name', value: basics.name },
                  { label: 'Address', value: `${basics.street_address}, ${basics.suburb} ${basics.state} ${basics.postcode}` },
                  { label: 'Type', value: { established: 'Established', house_and_land: 'House & Land', land: 'Vacant Land', off_the_plan: 'Off The Plan' }[propertyType!] },
                  { label: 'Usage', value: { investment: 'Investment', ppor: 'Primary residence', mixed: `Mixed (${basics.mixed_use_pct}% investment)` }[basics.usage] },
                  { label: 'Your ownership', value: `${basics.ownership_pct}%` },
                  ...(purchase.purchase_price ? [{ label: isHL ? 'Land price' : 'Purchase price', value: `$${Number(purchase.purchase_price).toLocaleString()}` }] : []),
                  ...(purchase.purchase_date ? [{ label: isHL ? 'Land settlement' : 'Purchase date', value: purchase.purchase_date }] : []),
                  ...(isHL && construction.land_value ? [{ label: 'Land value', value: `$${Number(construction.land_value).toLocaleString()}` }] : []),
                  ...(isHL && construction.builder ? [{ label: 'Builder', value: construction.builder }] : []),
                  ...(isHL && construction.contract_amount ? [{ label: 'Build contract', value: `$${Number(construction.contract_amount).toLocaleString()}` }] : []),
                  ...(isHL ? [{ label: 'Construction status', value: construction.status === 'pre_construction' ? 'Pre-construction' : 'In progress' }] : []),
                  ...(isHL ? [{ label: 'Capitalise interest', value: construction.capitalise_interest ? 'Yes' : 'No' }] : []),
                ].map(row => (
                  <div key={row.label} style={{ display: 'flex', gap: 12, fontSize: 13 }}>
                    <span style={{ width: 130, color: '#5c6478', flexShrink: 0 }}>{row.label}</span>
                    <span style={{ fontWeight: 600, color: '#1a1e2e' }}>{row.value}</span>
                  </div>
                ))}
              </div>
              {acqForm.filter(r => r.amount).length > 0 ? (
                <div style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 16px' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#5c6478', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Acquisition Costs</div>
                  {acqForm.filter(r => r.amount && !isNaN(parseFloat(r.amount))).map((r, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
                      <span style={{ color: '#5c6478' }}>{r.type === 'other' ? (r.description || 'Other') : ACQ_LABELS[r.type]}</span>
                      <span style={{ fontWeight: 600 }}>${parseFloat(r.amount).toLocaleString()}</span>
                    </div>
                  ))}
                  <div style={{ borderTop: '1px solid #e4e7f0', marginTop: 6, paddingTop: 6, display: 'flex', justifyContent: 'space-between', fontSize: 12.5, fontWeight: 700 }}>
                    <span>Total</span>
                    <span>${acqForm.filter(r => r.amount && !isNaN(parseFloat(r.amount))).reduce((sum, r) => sum + parseFloat(r.amount), 0).toLocaleString()}</span>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 10, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', fontSize: 12.5, color: '#92400e' }}>
                  <span style={{ flexShrink: 0 }}>⚠</span>
                  <span>No acquisition costs added (stamp duty, legal fees, etc.). You can add these later via <strong>Edit Property Details</strong> on the property page.</span>
                </div>
              )}
            </div>
          )}

          {error && <div style={{ marginTop: 12, padding: '9px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 12.5, color: '#c8332a' }}>⚠ {error}</div>}
        </div>

        {/* Footer */}
        <div style={{ padding: '0 24px 20px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {step !== 'type' && (
            <button onClick={() => {
              setError(null)
              if (step === 'basics') setStep('type')
              else if (step === 'construction') setStep('basics')
              else if (step === 'purchase') setStep(isHL ? 'construction' : 'basics')
              else if (step === 'confirm') setStep('purchase')
            }} style={{ padding: '9px 16px', background: '#f0f2f7', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#5c6478' }}>
              Back
            </button>
          )}
          <button onClick={() => onClose()} style={{ padding: '9px 16px', background: '#f0f2f7', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#5c6478' }}>
            Cancel
          </button>
          {step !== 'confirm' ? (
            <button onClick={() => {
              if (step === 'type') nextFromType()
              else if (step === 'basics') nextFromBasics()
              else if (step === 'construction') nextFromConstruction()
              else if (step === 'purchase') nextFromPurchase()
            }} style={{ padding: '9px 18px', background: BLUE, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              Next
            </button>
          ) : (
            <button onClick={handleCreate} disabled={saving} style={{ padding: '9px 18px', background: '#15803d', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              {saving ? 'Creating…' : 'Create Property'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
