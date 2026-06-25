'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    router.push('/portfolio')
    router.refresh()
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#f0f2f7', display: 'flex',
      alignItems: 'center', justifyContent: 'center', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, padding: '40px 36px',
        width: '100%', maxWidth: 400, boxShadow: '0 4px 24px rgba(0,0,0,.08)'
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32 }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%', background: '#f7c925',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 900, color: '#0c1929'
          }}>IC</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#0c1929' }}>ICFG Property Tracker</div>
            <div style={{ fontSize: 12, color: '#9ca3af' }}>Inner Circle Financial Group</div>
          </div>
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 6, color: '#1a1e2e' }}>Sign in</h1>
        <p style={{ fontSize: 13, color: '#5c6478', marginBottom: 24 }}>Track and manage your investment portfolio</p>

        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#5c6478', marginBottom: 6 }}>
              Email address
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              style={{
                width: '100%', padding: '10px 13px', border: '1px solid #e4e7f0',
                borderRadius: 9, fontSize: 14, color: '#1a1e2e', outline: 'none',
                boxSizing: 'border-box'
              }}
              placeholder="you@example.com"
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#5c6478', marginBottom: 6 }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              style={{
                width: '100%', padding: '10px 13px', border: '1px solid #e4e7f0',
                borderRadius: 9, fontSize: 14, color: '#1a1e2e', outline: 'none',
                boxSizing: 'border-box'
              }}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div style={{
              padding: '10px 13px', background: '#fef2f2', border: '1px solid #fca5a5',
              borderRadius: 9, fontSize: 13, color: '#c8332a', marginBottom: 16
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '11px', background: loading ? '#e4e7f0' : '#f7c925',
              color: '#1a1200', border: 'none', borderRadius: 9,
              fontSize: 14, fontWeight: 800, cursor: loading ? 'not-allowed' : 'pointer'
            }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p style={{ marginTop: 20, fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
          Don&apos;t have access? Contact your ICFG broker.
        </p>
      </div>
    </div>
  )
}
