'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function ClickableRow({ href, style, children }: { href: string; style?: React.CSSProperties; children: React.ReactNode }) {
  const router = useRouter()
  const [hovered, setHovered] = useState(false)
  return (
    <tr
      onClick={() => router.push(href)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ cursor: 'pointer', background: hovered ? '#f5f7fb' : undefined, transition: 'background .1s', ...style }}
    >
      {children}
    </tr>
  )
}

export function HoverableRow({ href, style, children }: { href: string; style?: React.CSSProperties; children: React.ReactNode }) {
  const [hovered, setHovered] = useState(false)
  return (
    <Link href={href} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ background: hovered ? '#f5f7fb' : undefined, transition: 'background .1s', ...style }}
      >
        {children}
      </div>
    </Link>
  )
}
