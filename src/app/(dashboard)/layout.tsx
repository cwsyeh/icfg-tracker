import NavBar from '@/components/dashboard/NavBar'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f7' }}>
      <NavBar />
      {children}
    </div>
  )
}
