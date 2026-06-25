'use client'

import { useState } from 'react'
import AddPropertyModal from './AddPropertyModal'

export default function AddPropertyButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{ padding: '6px 13px', background: '#0c1929', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
        + Add Property
      </button>
      {open && <AddPropertyModal onClose={() => setOpen(false)} />}
    </>
  )
}
