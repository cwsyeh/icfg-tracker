'use client'
import { useState, useCallback } from 'react'
import PortfolioView from './PortfolioView'
import PropertyView from './PropertyView'
import TaxView from './TaxView'
import type { PropertyReport, ReportType, FyLabel } from './types'
import { FY_OPTIONS } from './types'

interface Props {
  properties: PropertyReport[]
  ownerName: string
  generatedAt: string
}

const TABS: { key: ReportType; label: string; desc: string }[] = [
  { key: 'portfolio', label: 'Portfolio', desc: 'Trend view across all properties' },
  { key: 'property', label: 'Property Performance', desc: 'Property-by-property deep dive' },
  { key: 'tax', label: 'ATO Tax', desc: 'NAT 1836 rental schedule per year' },
]

export default function ReportsPage({ properties, ownerName, generatedAt }: Props) {
  const [reportType, setReportType] = useState<ReportType>('portfolio')
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>(properties[0]?.property.id ?? '')
  const [selectedFy, setSelectedFy] = useState<FyLabel>('FY25')
  const [pdfLoading, setPdfLoading] = useState(false)

  const selectedProperty = properties.find(p => p.property.id === selectedPropertyId) ?? properties[0]
  const showPropertySelector = reportType === 'property' || reportType === 'tax'
  const showFySelector = reportType === 'tax'

  const handleExportPdf = useCallback(async () => {
    setPdfLoading(true)
    try {
      const params = new URLSearchParams({ type: reportType, fy: selectedFy })
      if (showPropertySelector && selectedPropertyId) params.set('propertyId', selectedPropertyId)
      const res = await fetch(`/api/reports/pdf?${params}`)
      if (!res.ok) throw new Error('PDF generation failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const propName = showPropertySelector ? selectedProperty?.property.name?.replace(/\s+/g, '-') ?? 'property' : 'all'
      a.download = `ICFG-${reportType}-${propName}-${selectedFy}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error(err)
      alert('PDF generation failed. Please try again.')
    } finally {
      setPdfLoading(false)
    }
  }, [reportType, selectedFy, selectedPropertyId, selectedProperty, showPropertySelector])

  if (properties.length === 0) {
    return (
      <div style={{ padding: '24px 28px', maxWidth: 1360, margin: '0 auto', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
        <div style={{ background: '#fff', borderRadius: 14, boxShadow: '0 1px 3px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.04)', padding: '64px 32px', textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>No properties found</div>
          <div style={{ fontSize: 13, color: '#9ca3af' }}>Add properties to generate reports.</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '24px 28px 48px', maxWidth: 1360, margin: '0 auto', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>

      {/* Page title */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0, letterSpacing: '-.3px' }}>Reports</h1>
        {ownerName && <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 3 }}>{ownerName} · Generated {new Date(generatedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}</div>}
      </div>

      {/* Controls card */}
      <div style={{ background: '#fff', borderRadius: 14, boxShadow: '0 1px 3px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.04)', padding: '12px 20px', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' as const }}>

        {/* Tab switcher */}
        <div style={{ display: 'flex', gap: 4, padding: 3, background: '#f0f2f7', borderRadius: 9 }}>
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setReportType(tab.key)}
              title={tab.desc}
              style={{
                padding: '7px 14px', border: 'none', borderRadius: 7, fontSize: 12.5, cursor: 'pointer',
                fontWeight: reportType === tab.key ? 800 : 500,
                background: reportType === tab.key ? '#0c1929' : 'transparent',
                color: reportType === tab.key ? '#f7c925' : '#6b7280',
                transition: 'all .15s',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {(showPropertySelector || showFySelector) && (
          <div style={{ width: 1, height: 28, background: '#e4e7f0' }} />
        )}

        {showFySelector && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.08em' }}>Year</span>
            <select
              value={selectedFy}
              onChange={e => setSelectedFy(e.target.value as FyLabel)}
              style={{ padding: '6px 10px', border: '1px solid #e4e7f0', borderRadius: 7, fontSize: 13, fontWeight: 700, color: '#1a1a2e', background: '#f9fafb', cursor: 'pointer', outline: 'none' }}
            >
              {FY_OPTIONS.map(fy => <option key={fy} value={fy}>{fy}</option>)}
            </select>
          </div>
        )}


        {showPropertySelector && (
          <>
            {showFySelector && <div style={{ width: 1, height: 28, background: '#e4e7f0' }} />}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.08em' }}>Property</span>
              <select
                value={selectedPropertyId}
                onChange={e => setSelectedPropertyId(e.target.value)}
                style={{ padding: '6px 10px', border: '1px solid #e4e7f0', borderRadius: 7, fontSize: 13, fontWeight: 700, color: '#1a1a2e', background: '#f9fafb', cursor: 'pointer', outline: 'none', maxWidth: 240 }}
              >
                {properties.map(p => <option key={p.property.id} value={p.property.id}>{p.property.name}</option>)}
              </select>
            </div>
          </>
        )}

        {reportType === 'tax' && (
          <>
            <div style={{ width: 1, height: 28, background: '#e4e7f0', marginLeft: 'auto' }} />
            <button
              onClick={handleExportPdf}
              disabled={pdfLoading}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 16px', background: pdfLoading ? '#6b7280' : '#0c1929', color: '#f7c925', border: 'none', borderRadius: 8, fontSize: 12.5, fontWeight: 800, cursor: pdfLoading ? 'not-allowed' : 'pointer' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                {pdfLoading
                  ? <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                  : <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>}
              </svg>
              {pdfLoading ? 'Generating…' : 'Export PDF'}
            </button>
          </>
        )}
      </div>

      {/* Report content */}
      {reportType === 'portfolio' && <PortfolioView properties={properties} />}
      {reportType === 'property' && selectedProperty && <PropertyView property={selectedProperty} />}
      {reportType === 'tax' && selectedProperty && <TaxView property={selectedProperty} fy={selectedFy} />}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
