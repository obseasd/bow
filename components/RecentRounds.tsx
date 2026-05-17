'use client'

import { useEffect, useState } from 'react'

interface Round {
  id: number
  aiUsdcPct: number
  aiUsycPct: number
  aiEurcPct: number
  humanUsdcPct: number
  humanUsycPct: number
  humanEurcPct: number
  startTime: number
  settlementTime: number
  aiReturnBps: number
  humanReturnBps: number
  outcome: number
  settled: boolean
}

function countdown(settlementTime: number): string {
  const remaining = settlementTime - Math.floor(Date.now() / 1000)
  if (remaining <= 0) return 'ready to settle'
  const h = Math.floor(remaining / 3600)
  const m = Math.floor((remaining % 3600) / 60)
  if (h >= 1) return `${h}h ${m}m`
  return `${m}m`
}

function outcomeLabel(o: number): { label: string; color: string } {
  if (o === 1) return { label: 'AI', color: 'text-[var(--accent)]' }
  if (o === 2) return { label: 'BASE', color: 'text-white' }
  if (o === 3) return { label: 'TIE', color: 'text-[var(--fg-muted)]' }
  return { label: 'PEND', color: 'text-[var(--fg-dim)]' }
}

export default function RecentRounds() {
  const [rounds, setRounds] = useState<Round[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/rounds')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.rounds)) setRounds(data.rounds)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs uppercase tracking-wider text-[var(--fg-muted)]">Recent rounds</h2>
        <span className="text-[10px] text-[var(--fg-dim)]">AI vs human, settled on-chain</span>
      </div>

      {loading ? (
        <div className="card p-6 text-sm text-[var(--fg-dim)]">Loading...</div>
      ) : rounds.length === 0 ? (
        <div className="card p-6 text-sm text-[var(--fg-muted)]">
          No rounds yet. A round opens with each AI rebalance.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <div className="min-w-[680px]">
            <div className="grid grid-cols-[60px_1fr_120px_120px_80px] gap-3 px-5 py-3 border-b border-[var(--border)] text-[10px] uppercase tracking-wider text-[var(--fg-muted)]">
              <div>Round</div>
              <div>AI allocation (U/Y/E)</div>
              <div className="text-right">AI return</div>
              <div className="text-right">Alpha vs human</div>
              <div className="text-right">Status</div>
            </div>
            {rounds.map((r) => {
              const alpha = r.settled ? r.aiReturnBps - r.humanReturnBps : null
              const o = outcomeLabel(r.outcome)
              return (
                <div
                  key={r.id}
                  className="grid grid-cols-[60px_1fr_120px_120px_80px] gap-3 px-5 py-3 border-b border-[var(--border)] last:border-b-0 text-sm hover:bg-white/[0.02] transition"
                >
                  <div className="mono text-[var(--fg-muted)]">#{r.id}</div>
                  <div className="flex items-center gap-2 text-xs mono">
                    <span className="asset-usdc">{r.aiUsdcPct}%</span>
                    <span className="text-[var(--fg-dim)]">/</span>
                    <span className="asset-usyc">{r.aiUsycPct}%</span>
                    <span className="text-[var(--fg-dim)]">/</span>
                    <span className="asset-eurc">{r.aiEurcPct}%</span>
                  </div>
                  <div className={`mono text-right text-xs ${r.settled ? (r.aiReturnBps >= 0 ? 'text-[var(--accent)]' : 'text-[var(--negative)]') : 'text-[var(--fg-dim)]'}`}>
                    {r.settled ? `${r.aiReturnBps >= 0 ? '+' : ''}${r.aiReturnBps}bps` : 'pending'}
                  </div>
                  <div className={`mono text-right text-xs ${alpha === null ? 'text-[var(--fg-dim)]' : alpha >= 0 ? 'text-[var(--accent)]' : 'text-[var(--negative)]'}`}>
                    {alpha === null ? countdown(r.settlementTime) : `${alpha >= 0 ? '+' : ''}${alpha}bps`}
                  </div>
                  <div className="text-right">
                    <span className={`text-[10px] mono px-2 py-0.5 border border-[var(--border)] ${o.color}`} style={{ borderRadius: 2 }}>
                      {o.label}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
