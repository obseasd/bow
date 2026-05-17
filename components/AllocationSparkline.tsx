'use client'

import { useEffect, useState } from 'react'

interface Round {
  id: number
  aiUsdcPct: number
  aiUsycPct: number
  aiEurcPct: number
  settled: boolean
}

/// Stacked-area sparkline of AI allocation across rounds.
/// Tells the story of how the agent shifts between USDC / USYC / EURC
/// over time. Read at a glance: if it's mostly one color, the agent
/// is staying defensive (or aggressive). Bands shifting = active
/// rebalancing decisions.
export default function AllocationSparkline() {
  const [rounds, setRounds] = useState<Round[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/rounds')
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d.rounds)) {
          // Reverse to chronological order (oldest -> newest)
          setRounds([...d.rounds].sort((a, b) => a.id - b.id))
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) return null
  if (rounds.length === 0) return null

  const W = 1000
  const H = 110
  const PAD_X = 8
  const PAD_TOP = 8
  const PAD_BOTTOM = 8

  const xOf = (i: number) => PAD_X + (i / Math.max(1, rounds.length - 1)) * (W - 2 * PAD_X)
  const yOf = (cumPct: number) => PAD_TOP + (1 - cumPct / 100) * (H - PAD_TOP - PAD_BOTTOM)

  // Build 3 stacked area paths.
  // Bottom layer (USDC): from 0 to usdcPct
  // Middle layer (USYC): from usdcPct to usdcPct + usycPct
  // Top layer (EURC): from usdcPct + usycPct to 100
  function buildArea(top: (r: Round) => number, bottom: (r: Round) => number): string {
    const topPts = rounds.map((r, i) => `${xOf(i).toFixed(2)},${yOf(top(r)).toFixed(2)}`)
    const botPtsRev = [...rounds].reverse().map((r, i) => {
      const idx = rounds.length - 1 - i
      return `${xOf(idx).toFixed(2)},${yOf(bottom(r)).toFixed(2)}`
    })
    return `M ${topPts.join(' L ')} L ${botPtsRev.join(' L ')} Z`
  }

  const usdcArea = buildArea(
    r => r.aiUsdcPct,
    () => 0,
  )
  const usycArea = buildArea(
    r => r.aiUsdcPct + r.aiUsycPct,
    r => r.aiUsdcPct,
  )
  const eurcArea = buildArea(
    () => 100,
    r => r.aiUsdcPct + r.aiUsycPct,
  )

  const lastRound = rounds[rounds.length - 1]

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--fg-muted)]">
            Allocation trajectory · {rounds.length} round{rounds.length === 1 ? '' : 's'}
          </div>
          <div className="text-xs text-[var(--fg-dim)] mt-1">How the AI has shifted USDC / USYC / EURC over time</div>
        </div>
        <div className="flex items-center gap-3 text-[10px] mono">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 bg-asset-usdc" /> {lastRound.aiUsdcPct}%</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 bg-asset-usyc" /> {lastRound.aiUsycPct}%</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 bg-asset-eurc" /> {lastRound.aiEurcPct}%</span>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 'auto', maxHeight: 140 }}>
        <path d={usdcArea} fill="var(--asset-usdc)" stroke="var(--bg)" strokeWidth="0.5" />
        <path d={usycArea} fill="var(--asset-usyc)" stroke="var(--bg)" strokeWidth="0.5" />
        <path d={eurcArea} fill="var(--asset-eurc)" stroke="var(--bg)" strokeWidth="0.5" />

        {/* Per-round x marks (only first / last to avoid noise) */}
        <text x={xOf(0)} y={H - 1} textAnchor="middle" fontSize="9" fill="var(--fg-dim)" fontFamily="JetBrains Mono, monospace">
          #{rounds[0].id}
        </text>
        {rounds.length > 1 && (
          <text x={xOf(rounds.length - 1)} y={H - 1} textAnchor="middle" fontSize="9" fill="var(--fg-dim)" fontFamily="JetBrains Mono, monospace">
            #{lastRound.id}
          </text>
        )}
      </svg>
    </div>
  )
}
