'use client'

import { useEffect, useState } from 'react'

interface Stats {
  totalRounds: number
  aiWins: number
  humanWins: number
  aiWinRatePct: number
  totalAssetsUsd: string
  allocation: { usdc: number; usyc: number; eurc: number }
}

export default function StatsBar() {
  const [s, setS] = useState<Stats | null>(null)

  useEffect(() => {
    let mounted = true
    fetch('/api/onchain')
      .then((r) => r.json())
      .then((d) => { if (mounted && !d.error) setS(d) })
      .catch(() => {})
    return () => { mounted = false }
  }, [])

  const settled = s ? s.aiWins + s.humanWins : 0
  const totalAssetsDisplay = s
    ? (Number(s.totalAssetsUsd) / 1e6).toFixed(2)
    : '—'

  const tiles = [
    {
      label: 'TVL',
      value: s ? `$${totalAssetsDisplay}` : '—',
      detail: s ? 'across USDC + USYC + EURC' : 'connect to read on-chain',
    },
    {
      label: 'AI win rate',
      value: settled > 0 ? `${s!.aiWinRatePct.toFixed(0)}%` : '—',
      detail: s ? `${s.aiWins}W / ${s.humanWins}L · ${settled} settled` : '',
    },
    {
      label: 'Rounds',
      value: s ? String(s.totalRounds) : '—',
      detail: s ? `${s.totalRounds - settled} pending` : '',
    },
    {
      label: 'AI alloc',
      value: s ? `${s.allocation.usdc}/${s.allocation.usyc}/${s.allocation.eurc}` : '—',
      detail: 'USDC / USYC / EURC',
      accent: true,
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {tiles.map((t, i) => (
        <div
          key={t.label}
          className="card p-4 stat-card"
          style={{ animationDelay: `${i * 80}ms` }}
        >
          <div className={`text-2xl font-medium tracking-tight mono ${t.accent ? 'text-[var(--accent)]' : ''}`}>{t.value}</div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--fg-muted)] mt-2">{t.label}</div>
          <div className="text-[10px] text-[var(--fg-dim)] mt-0.5">{t.detail}</div>
        </div>
      ))}
    </div>
  )
}
