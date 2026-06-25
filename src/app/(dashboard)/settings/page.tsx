import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div style={{
      padding: '48px 28px',
      maxWidth: 680,
      margin: '0 auto',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      textAlign: 'center',
    }}>
      <div style={{
        background: '#fff',
        border: '1px solid #e4e7f0',
        borderRadius: 16,
        padding: '56px 40px',
      }}>
        <div style={{ fontSize: 40, marginBottom: 20 }}>⚙️</div>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: '#0c1929', margin: '0 0 10px' }}>
          Settings
        </h1>
        <p style={{ fontSize: 14, color: '#6b7280', margin: '0 0 6px', lineHeight: 1.6 }}>
          This section is under construction.
        </p>
        <p style={{ fontSize: 13, color: '#9ca3af', margin: 0, lineHeight: 1.6 }}>
          Planned: account details, password change, notification preferences, co-ownership invitations, and connected integrations.
        </p>
      </div>
    </div>
  )
}
