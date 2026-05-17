'use client'

import Link from 'next/link'
import WalletButton from './WalletButton'

export default function Nav() {
  return (
    <nav className="relative z-50 border-b border-[var(--border)]" style={{ background: 'rgba(10, 13, 18, 0.85)', backdropFilter: 'blur(8px)' }}>
      <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-3 group">
          <BowMark />
          <span className="font-medium text-lg tracking-tight">bow</span>
        </Link>
        <div className="flex items-center gap-1 text-sm">
          <Link
            href="/"
            className="px-3 py-1.5 text-[var(--fg-muted)] hover:text-white transition"
            style={{ borderRadius: 2 }}
          >
            Vault
          </Link>
          <Link
            href="/judge"
            className="px-3 py-1.5 text-[var(--accent)] hover:text-white transition"
            style={{ borderRadius: 2 }}
          >
            Judge
          </Link>
          <div className="ml-3">
            <WalletButton />
          </div>
        </div>
      </div>
    </nav>
  )
}

function BowMark() {
  // Minimal Arc-style geometric mark for Bow: a stylized bow/arc shape in cyan
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" className="transition group-hover:opacity-80">
      <path
        d="M4 22 Q14 4 24 22"
        stroke="var(--accent)"
        strokeWidth="2.2"
        strokeLinecap="square"
        fill="none"
      />
      <line x1="4" y1="22" x2="24" y2="22" stroke="var(--accent)" strokeWidth="1.2" />
      <circle cx="14" cy="22" r="1.5" fill="var(--accent)" />
    </svg>
  )
}
