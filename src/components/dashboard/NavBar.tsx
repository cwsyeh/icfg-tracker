'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const NAV_LINKS = [
  { label: 'Portfolio', href: '/portfolio' },
  { label: 'Properties', href: '/properties' },
  { label: 'Cashflow', href: '/cashflow' },
  { label: 'Finance', href: '/finance' },
  { label: 'Reports', href: '/reports' },
  { label: 'Settings', href: '/settings' },
]

export default function NavBar() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <nav style={{
      display: 'flex', alignItems: 'center', height: 56, padding: '0 28px',
      background: '#0c1929', gap: 4, position: 'sticky', top: 0, zIndex: 100
    }}>
      {/* Logo */}
      <Link href="/portfolio" style={{
        display: 'flex', alignItems: 'center', gap: 9, marginRight: 24, textDecoration: 'none'
      }}>
        <div style={{
          width: 30, height: 30, borderRadius: '50%', background: '#f7c925',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
        }}>
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="8" stroke="#0c1929" strokeWidth="2.5"/>
            <circle cx="10" cy="10" r="5" stroke="#0c1929" strokeWidth="2"/>
            <circle cx="10" cy="10" r="2" fill="#0c1929"/>
          </svg>
        </div>
        <span style={{ fontSize: 13.5, fontWeight: 800, color: '#f7c925', letterSpacing: '.05em' }}>
          ICFG
        </span>
      </Link>

      {/* Nav links */}
      {NAV_LINKS.map(link => {
        const active = pathname.startsWith(link.href)
        return (
          <Link key={link.href} href={link.href} style={{
            padding: '7px 13px', fontSize: 13, borderRadius: 7, textDecoration: 'none',
            color: active ? '#fff' : 'rgba(255,255,255,.5)',
            background: active ? 'rgba(255,255,255,.1)' : 'transparent',
            transition: '.15s'
          }}>
            {link.label}
          </Link>
        )
      })}

      <div style={{ flex: 1 }} />

      {/* CTA */}
      <button style={{
        padding: '7px 16px', background: '#f7c925', color: '#1a1200', border: 'none',
        borderRadius: 8, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', marginRight: 8
      }}>
        Book Loan Review
      </button>

      {/* Avatar / sign out */}
      <button onClick={handleSignOut} title="Sign out" style={{
        width: 30, height: 30, borderRadius: '50%', background: 'rgba(255,255,255,.12)',
        border: '1.5px solid rgba(247,201,37,.4)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#f7c925', cursor: 'pointer'
      }}>
        SY
      </button>
    </nav>
  )
}
