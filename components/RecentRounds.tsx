'use client'

import { useEffect, useState } from 'react'
import VoteOnRound from './VoteOnRound'
import RoundDetailModal from './RoundDetailModal'

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
  return { label: 'PEND', color: 'text-[var(--accent)]' }
}

export default function RecentRounds() {
  const [rounds, setRounds] = useState<Round[]>([])
  const [loading, setLoading] = useState(true)
  const [openVoteId, setOpenVoteId] = useState<number | null>(null)
  const [detailRound, setDetailRound] = useState<Round | null>(null)

  useEffect(() => {
    fetch('/api/rounds')
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data.rounds)) setRounds(data.rounds) })
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
        <div className="space-y-2">
          {/* Header */}
          <div className="grid grid-cols-[60px_1fr_120px_120px_140px] gap-3 px-5 py-2 text-[10px] uppercase tracking-wider text-[var(--fg-muted)]">
            <div>Round</div>
            <div>AI allocation</div>
            <div
              className="text-right cursor-help"
              title="The AI allocation's basis-points return over the 24h round, weighted across USDC, USYC and EURC price moves."
            >
              AI bps ⓘ
            </div>
            <div
              className="text-right cursor-help"
              title="AI return minus the human aggregate's return, in basis points. Positive = AI beat humans, negative = humans beat the AI."
            >
              Alpha vs human ⓘ
            </div>
            <div className="text-right">Status</div>
          </div>

          <div className="text-[10px] text-[var(--fg-dim)] px-5 mb-1 leading-relaxed">
            <span className="text-[var(--fg-muted)]">How to read:</span> AI bps is the AI&apos;s 24h return.
            Alpha vs human shows by how many bps the AI beat or lost to the human aggregate (pending rounds show settle countdown instead). Click any row for full reasoning.
          </div>

          {rounds.map((r) => {
            const alpha = r.settled ? r.aiReturnBps - r.humanReturnBps : null
            const o = outcomeLabel(r.outcome)
            const isPending = !r.settled
            const voteOpen = openVoteId === r.id

            return (
              <div key={r.id} className="card overflow-hidden">
                <div
                  className="grid grid-cols-[60px_1fr_120px_120px_140px] gap-3 px-5 py-3 text-sm items-center cursor-pointer hover:bg-white/[0.02] transition"
                  onClick={() => setDetailRound(r)}
                  title="Click for round details"
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
                  <div
                    className="text-right flex items-center justify-end gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {isPending ? (
                      <button
                        onClick={() => setOpenVoteId(voteOpen ? null : r.id)}
                        className="text-[10px] mono px-2 py-1 border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent-soft)] transition"
                        style={{ borderRadius: 2 }}
                      >
                        {voteOpen ? 'Close' : 'Vote against AI'}
                      </button>
                    ) : (
                      <span className={`text-[10px] mono px-2 py-0.5 border border-[var(--border)] ${o.color}`} style={{ borderRadius: 2 }}>
                        {o.label}
                      </span>
                    )}
                  </div>
                </div>

                {isPending && voteOpen && (
                  <div className="px-5 pb-5">
                    <VoteOnRound
                      roundId={r.id}
                      aiUsdcPct={r.aiUsdcPct}
                      aiUsycPct={r.aiUsycPct}
                      aiEurcPct={r.aiEurcPct}
                      onClose={() => setOpenVoteId(null)}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <RoundDetailModal round={detailRound} onClose={() => setDetailRound(null)} />
    </div>
  )
}
