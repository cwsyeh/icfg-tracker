'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'

type Step = 'info' | 'purchase' | 'construction'

const AUS_STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA']

type AcqRow = { type: string; amount: string; description: string }
const ACQ_TYPES = [
  { value: 'stamp_duty', label: 'Stamp duty' },
  { value: 'legal_conveyancing', label: 'Legal / conveyancing' },
  { value: 'building_inspection', label: 'Building & pest inspection' },
  { value: 'buyers_agent', label: "Buyer's agent fee" },
  { value: 'loan_establishment', label: 'Loan establishment fee' },
  { value: 'qs_report', label: 'QS report' },
  { value: 'other', label: 'Other' },
]

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', border: '1px solid #d1d5db',
  borderRadius: 7, fontSize: 13, color: '#111827', outline: 'none',
  background: '#fff', boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: '#6b7280',
  textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 5,
}
const fieldStyle: React.CSSProperties = { marginBottom: 14 }

export default function AddPropertyModal() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('info')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Step 1 — property info
  const [info, setInfo] = useState({
    name: '', street_address: '', suburb: '', state: 'QLD', postcode: '',
    usage: 'investment', mixed_use_percent: '',
    property_type: 'established',
  })

  // Step 2 — purchase (established / land)
  const [purchase, setPurchase] = useState({
    purchase_date: '', settlement_date: '', purchase_price: '', capitalise_interest: false,
  })
  const [acqRows, setAcqRows] = useState<AcqRow[]>([])

  // Step 2/3 — construction (house_and_land)
  const [construction, setConstruction] = useState({
    land_purchase_date: '', land_price: '',
    builder: '', contract_amount: '',
    start_date: '', capitalise_interest: false,
  })

  function openModal() {
    setOpen(true)
    setStep('info')
    setError(null)
    setInfo({ name: '', street_address: '', suburb: '', state: 'QLD', postcode: '', usage: 'investment', mixed_use_percent: '', property_type: 'established' })
    setPurchase({ purchase_date: '', settlement_date: '', purchase_price: '', capitalise_interest: false })
    setAcqRows([])
    setConstruction({ land_purchase_date: '', land_price: '', builder: '', contract_amount: '', start_date: '', capitalise_interest: false })
  }

  function goNext() {
    setError(null)
    if (step === 'info') {
      if (!info.name.trim() || !info.street_address.trim() || !info.suburb.trim() || !info.state || !info.postcode.trim()) {
        setError('Please fill in all address fields and property name.')
        return
      }
      if (info.property_type === 'house_and_land') {
        setStep('construction')
      } else {
        setStep('purchase')
      }
    } else if (step === 'construction') {
      // validate contract amount
      if (!construction.contract_amount) {
        setError('Build contract amount is required.')
        return
      }
      handleSubmit()
    } else if (step === 'purchase') {
      handleSubmit()
    }
  }

  async function handleSubmit() {
    setSaving(true)
    setError(null)
    try {
      const isHnL = info.property_type === 'house_and_land'
      const body: Record<string, unknown> = {
        name: info.name.trim(),
        street_address: info.street_address.trim(),
        suburb: info.suburb.trim(),
        state: info.state,
        postcode: info.postcode.trim(),
        usage: info.usage,
        property_type: info.property_type,
        mixed_use_investment_percent: info.usage === 'mixed' && info.mixed_use_percent ? Number(info.mixed_use_percent) : null,
      }

      if (isHnL) {
        body.purchase_date = construction.land_purchase_date || null
        body.purchase_price = construction.land_price ? Number(construction.land_price) : null
        body.construction_builder = construction.builder.trim() || null
        body.construction_contract_amount = Number(construction.contract_amount)
        body.construction_start_date = construction.start_date || null
        body.construction_status = 'pre_construction'
        body.capitalise_construction_interest = construction.capitalise_interest
      } else {
        body.purchase_date = purchase.purchase_date || null
        body.settlement_date = purchase.settlement_date || null
        body.purchase_price = purchase.purchase_price ? Number(purchase.purchase_price) : null
        if (info.property_type === 'off_the_plan') {
          body.capitalise_construction_interest = purchase.capitalise_interest
        }
        const validAcq = acqRows.filter(r => r.type && r.amount && Number(r.amount) > 0)
        if (validAcq.length > 0) {
          body.acquisition_costs = validAcq.map(r => ({
            type: r.type,
            amount: Number(r.amount),
            description: r.description.trim() || null,
          }))
        }
      }

      const res = await fetch('/api/properties/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.success && data.property_id) {
        setOpen(false)
        router.push(`/properties/${data.property_id}`)
      } else {
        setError(data.error ?? 'Failed to create property')
      }
    } catch {
      setError('Network error — please try again')
    } finally {
      setSaving(false)
    }
  }

  const isHnL = info.property_type === 'house_and_land'

  const stepLabel =
    step === 'info' ? (isHnL ? 'Step 1 of 2 — Property Info' : 'Step 1 of 2 — Property Info') :
    step === 'construction' ? 'Step 2 of 2 — Construction Details' :
    'Step 2 of 2 — Purchase Details'

  return (
    <>
      <button
        onClick={openModal}
        style={{
          padding: '6px 13px', background: '#0c1929', color: '#fff',
          border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer',
        }}
      >
        + Add Property
      </button>

      {open && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
          zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 16,
        }}
          onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}
        >
          <div style={{
            background: '#fff', borderRadius: 14, width: '100%', maxWidth: 520,
            maxHeight: '92vh', display: 'flex', flexDirection: 'column',
            boxShadow: '0 8px 40px rgba(0,0,0,.22)',
            overflow: 'hidden',
          }}>

            {/* Header */}
            <div style={{ background: '#0c1929', padding: '20px 22px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: '#fff', marginBottom: 4 }}>
                    Add Property
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,.45)', fontWeight: 600 }}>
                    {stepLabel}
                  </div>
                </div>
                <button onClick={() => setOpen(false)} style={{
                  background: 'none', border: 'none', color: 'rgba(255,255,255,.5)',
                  fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: 0,
                }}>×</button>
              </div>

              {/* Step progress dots */}
              <div style={{ display: 'flex', gap: 6, marginTop: 14 }}>
                {['info', isHnL ? 'construction' : 'purchase'].map((s, i) => (
                  <div key={s} style={{
                    height: 3, flex: 1, borderRadius: 2,
                    background: (step === 'info' && i === 0) || (step !== 'info' && i === 1)
                      ? '#f7c925'
                      : step !== 'info' && i === 0 ? 'rgba(255,255,255,.6)' : 'rgba(255,255,255,.2)',
                  }} />
                ))}
              </div>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '22px 22px 8px' }}>

              {/* ── Step 1: Property Info ── */}
              {step === 'info' && (
                <>
                  <div style={fieldStyle}>
                    <label style={labelStyle}>Property name *</label>
                    <input
                      style={inputStyle}
                      placeholder="e.g. Sunnybank Investment"
                      value={info.name}
                      onChange={e => setInfo(p => ({ ...p, name: e.target.value }))}
                    />
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                      A short label — only you see this
                    </div>
                  </div>

                  <div style={fieldStyle}>
                    <label style={labelStyle}>Street address *</label>
                    <input
                      style={inputStyle}
                      placeholder="123 Example Street"
                      value={info.street_address}
                      onChange={e => setInfo(p => ({ ...p, street_address: e.target.value }))}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 90px', gap: 10, marginBottom: 14 }}>
                    <div>
                      <label style={labelStyle}>Suburb *</label>
                      <input style={inputStyle} placeholder="Suburb" value={info.suburb}
                        onChange={e => setInfo(p => ({ ...p, suburb: e.target.value }))} />
                    </div>
                    <div>
                      <label style={labelStyle}>State *</label>
                      <select style={inputStyle} value={info.state}
                        onChange={e => setInfo(p => ({ ...p, state: e.target.value }))}>
                        {AUS_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>Postcode *</label>
                      <input style={inputStyle} placeholder="4000" maxLength={4}
                        value={info.postcode}
                        onChange={e => setInfo(p => ({ ...p, postcode: e.target.value }))} />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                    <div>
                      <label style={labelStyle}>Usage *</label>
                      <select style={inputStyle} value={info.usage}
                        onChange={e => setInfo(p => ({ ...p, usage: e.target.value }))}>
                        <option value="investment">Investment</option>
                        <option value="ppor">PPOR</option>
                        <option value="mixed">Mixed</option>
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>Property type *</label>
                      <select style={inputStyle} value={info.property_type}
                        onChange={e => setInfo(p => ({ ...p, property_type: e.target.value }))}>
                        <option value="established">Established</option>
                        <option value="off_the_plan">Off The Plan</option>
                        <option value="house_and_land">House & Land</option>
                        <option value="land">Vacant Land</option>
                      </select>
                    </div>
                  </div>

                  {info.usage === 'mixed' && (
                    <div style={{ ...fieldStyle, background: '#f9fafb', borderRadius: 9, padding: '12px 14px' }}>
                      <label style={labelStyle}>Investment use %</label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          style={{ ...inputStyle, width: 100 }}
                          type="number" min="1" max="99" placeholder="e.g. 70"
                          value={info.mixed_use_percent}
                          onChange={e => setInfo(p => ({ ...p, mixed_use_percent: e.target.value }))}
                        />
                        <span style={{ fontSize: 13, color: '#6b7280' }}>% of property used for investment</span>
                      </div>
                    </div>
                  )}

                  {info.property_type === 'house_and_land' && (
                    <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 9, padding: '11px 14px', marginTop: 4 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#1d4ed8', marginBottom: 3 }}>House & Land package selected</div>
                      <div style={{ fontSize: 11.5, color: '#3b82f6' }}>Next step will capture land settlement and construction details. The property will be set to <strong>pre-construction</strong> status.</div>
                    </div>
                  )}
                  {info.property_type === 'off_the_plan' && (
                    <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 9, padding: '11px 14px', marginTop: 4 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#166534', marginBottom: 3 }}>Off The Plan selected</div>
                      <div style={{ fontSize: 11.5, color: '#15803d' }}>Next step captures the contract price and date. Settlement date is optional — add it later once confirmed. You can track and capitalise holding costs during construction.</div>
                    </div>
                  )}
                </>
              )}

              {/* ── Step 2: Purchase (established / land) ── */}
              {step === 'purchase' && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                    <div>
                      <label style={labelStyle}>Contract date</label>
                      <input type="date" style={inputStyle} value={purchase.purchase_date}
                        onChange={e => setPurchase(p => ({ ...p, purchase_date: e.target.value }))} />
                    </div>
                    <div>
                      <label style={labelStyle}>Settlement date</label>
                      <input type="date" style={inputStyle} value={purchase.settlement_date}
                        onChange={e => setPurchase(p => ({ ...p, settlement_date: e.target.value }))} />
                    </div>
                    <div>
                      <label style={labelStyle}>Purchase price</label>
                      <input type="number" style={inputStyle} placeholder="e.g. 650000"
                        value={purchase.purchase_price}
                        onChange={e => setPurchase(p => ({ ...p, purchase_price: e.target.value }))} />
                    </div>
                  </div>

                  {/* Capitalise interest — OTP only */}
                  {info.property_type === 'off_the_plan' && (
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 14, cursor: 'pointer' }}>
                      <input type="checkbox" checked={purchase.capitalise_interest as unknown as boolean}
                        onChange={e => setPurchase(p => ({ ...p, capitalise_interest: e.target.checked }))}
                        style={{ width: 15, height: 15, marginTop: 2, accentColor: '#1d4ed8', flexShrink: 0 }} />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1e2e' }}>Capitalise construction interest</div>
                        <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 2 }}>Interest during construction is added to cost base instead of expensed</div>
                      </div>
                    </label>
                  )}

                  {/* Acquisition costs — optional */}
                  <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 16, marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>Acquisition costs</div>
                        <div style={{ fontSize: 11, color: '#9ca3af' }}>Optional — can be added later in Property Details</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setAcqRows(r => [...r, { type: 'stamp_duty', amount: '', description: '' }])}
                        style={{
                          padding: '5px 11px', background: '#f3f4f6', border: 'none',
                          borderRadius: 6, fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                        }}
                      >
                        + Add
                      </button>
                    </div>

                    {acqRows.map((row, i) => (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: '160px 100px 1fr 28px', gap: 6, marginBottom: 8, alignItems: 'start' }}>
                        <select style={{ ...inputStyle, fontSize: 12 }} value={row.type}
                          onChange={e => setAcqRows(r => r.map((x, j) => j === i ? { ...x, type: e.target.value } : x))}>
                          {ACQ_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                        <input type="number" style={{ ...inputStyle, fontSize: 12 }} placeholder="Amount"
                          value={row.amount}
                          onChange={e => setAcqRows(r => r.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />
                        <input style={{ ...inputStyle, fontSize: 12 }} placeholder={row.type === 'other' ? 'Description (required)' : 'Notes (optional)'}
                          value={row.description}
                          onChange={e => setAcqRows(r => r.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} />
                        <button type="button" onClick={() => setAcqRows(r => r.filter((_, j) => j !== i))}
                          style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: 16, cursor: 'pointer', lineHeight: 1, padding: '7px 0 0' }}>
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* ── Step 2: Construction (house_and_land) ── */}
              {step === 'construction' && (
                <>
                  <div style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: '#374151', marginBottom: 2 }}>Land</div>
                    <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 10 }}>
                      The land component of your House & Land package
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div>
                        <label style={labelStyle}>Land contract date</label>
                        <input type="date" style={inputStyle} value={construction.land_purchase_date}
                          onChange={e => setConstruction(p => ({ ...p, land_purchase_date: e.target.value }))} />
                      </div>
                      <div>
                        <label style={labelStyle}>Land price</label>
                        <input type="number" style={inputStyle} placeholder="e.g. 280000"
                          value={construction.land_price}
                          onChange={e => setConstruction(p => ({ ...p, land_price: e.target.value }))} />
                      </div>
                    </div>
                  </div>

                  <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 14, marginBottom: 14 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: '#374151', marginBottom: 10 }}>Build contract</div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                      <div>
                        <label style={labelStyle}>Builder name</label>
                        <input style={inputStyle} placeholder="e.g. Metricon Homes"
                          value={construction.builder}
                          onChange={e => setConstruction(p => ({ ...p, builder: e.target.value }))} />
                      </div>
                      <div>
                        <label style={labelStyle}>Contract amount *</label>
                        <input type="number" style={inputStyle} placeholder="e.g. 370000"
                          value={construction.contract_amount}
                          onChange={e => setConstruction(p => ({ ...p, contract_amount: e.target.value }))} />
                      </div>
                    </div>

                    <div style={fieldStyle}>
                      <label style={labelStyle}>Expected start date</label>
                      <input type="date" style={inputStyle} value={construction.start_date}
                        onChange={e => setConstruction(p => ({ ...p, start_date: e.target.value }))} />
                    </div>

                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', marginTop: 4 }}>
                      <input
                        type="checkbox"
                        checked={construction.capitalise_interest}
                        onChange={e => setConstruction(p => ({ ...p, capitalise_interest: e.target.checked }))}
                        style={{ marginTop: 2, accentColor: '#0c1929', width: 15, height: 15, flexShrink: 0 }}
                      />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>Capitalise construction interest</div>
                        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                          Construction loan interest is added to the cost base rather than claimed as a deduction
                        </div>
                      </div>
                    </label>
                  </div>
                </>
              )}

              {error && (
                <div style={{
                  background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8,
                  padding: '9px 12px', fontSize: 12.5, color: '#dc2626', marginBottom: 8,
                }}>
                  {error}
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{
              padding: '14px 22px', borderTop: '1px solid #e5e7eb',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              background: '#fafafa',
            }}>
              <button
                onClick={() => {
                  if (step === 'info') { setOpen(false) }
                  else { setStep('info'); setError(null) }
                }}
                style={{
                  padding: '8px 16px', background: 'none', border: '1px solid #d1d5db',
                  borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#374151',
                }}
              >
                {step === 'info' ? 'Cancel' : '← Back'}
              </button>

              <button
                onClick={goNext}
                disabled={saving}
                style={{
                  padding: '8px 20px',
                  background: saving ? '#9ca3af' : '#0c1929',
                  color: '#fff', border: 'none', borderRadius: 7,
                  fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer',
                }}
              >
                {saving ? 'Creating…' :
                  step === 'purchase' ? 'Create Property →' :
                  step === 'construction' ? 'Create Property →' :
                  'Next →'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
