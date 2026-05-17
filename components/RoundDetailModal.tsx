'use client'

import { useEffect, useState } from 'react'
import { ACTIVE_CHAIN } from '@/lib/chains'

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

interface DecisionLite {
  id: number
  usdcPct: number
  usycPct: number
  eurcPct: number
  confidence: number
  reasoning: string
  txHash: string
  timestamp: number
}

function fmtTs(ts: number): string {
  return new Date(ts * 1000).toLocaleString()
}

function outcomeLabel(o: number): { label: string; color: string } {
  if (o === 1) return { label: 'AI wins', color: 'var(--accent)' }
  if (o === 2) return { label: 'Human wins', color: '#ffffff' }
  if (o === 3) return { label: 'Tie', color: 'var(--fg-muted)' }
  return { label: 'Pending', color: 'var(--accent)' }
}

const ASSET_COLORS: Record<'usdc' | 'usyc' | 'eurc', string> = {
  usdc: 'var(--asset-usdc)',
  usyc: 'var(--asset-usyc)',
  eurc: 'var(--asset-eurc)',
}

function AllocBar({ usdc, usyc, eurc, label }: { usdc: number; usyc: number; eurc: number; label: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--fg-muted)] mb-1">{label}</div>
      <div className="flex h-2 w-full overflow-hidden border border-[var(--border)]" style={{ borderRadius: 2 }}>
        <div style={{ width: `${usdc}%`, background: ASSET_COLORS.usdc, borderRight: '1px solid var(--bg)' }} />
        <div style={{ width: `${usyc}%`, background: ASSET_COLORS.usyc, borderRight: '1px solid var(--bg)' }} />
        <div style={{ width: `${eurc}%`, background: ASSET_COLORS.eurc }} />
      </div>
      <div className="flex items-center gap-3 text-[11px] mono mt-1.5">
        <span className="asset-usdc">{usdc}%</span>
        <span className="text-[var(--fg-dim)]">/</span>
        <span className="asset-usyc">{usyc}%</span>
        <span className="text-[var(--fg-dim)]">/</span>
        <span className="asset-eurc">{eurc}%</span>
      </div>
    </div>
  )
}

export default function RoundDetailModal({ round, onClose }: { round: Round | null; onClose: () => void }) {
  const [decision, setDecision] = useState<DecisionLite | null>(null)
  const [loadingDecision, setLoadingDecision] = useState(true)

  useEffect(() => {
    if (!round) return
    setLoadingDecision(true)
    fetch('/api/decisions')
      .then(r => r.json())
      .then(d => {
        if (d.latest && d.latest.id === round.id) setDecision(d.latest)
      })
      .catch(console.error)
      .finally(() => setLoadingDecision(false))
  }, [round])

  // Escape key closes
  useEffect(() => {
    if (!round) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [round, onClose])

  if (!round) return null

  const o = outcomeLabel(round.outcome)
  const alpha = round.settled ? round.aiReturnBps - round.humanReturnBps : null
  const fmtBps = (b: number) => `${b >= 0 ? '+' : ''}${b} bps`
  const fmtPct = (b: number) => `${b >= 0 ? '+' : ''}${(b / 100).toFixed(2)}%`

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center p-4 modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel card max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        style={{ background: 'var(--bg-card)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-[var(--border)]">
          <div>
            <div className="flex items-baseline gap-3 mb-1">
              <span className="text-3xl font-medium mono text-[var(--fg)]">Round #{round.id}</span>
              <span
                className="text-[10px] mono px-2 py-1 border"
                style={{ color: o.color, borderColor: o.color, borderRadius: 2 }}
              >
                {o.label}
              </span>
            </div>
            <div className="text-xs text-[var(--fg-dim)] mono">
              opened {fmtTs(round.startTime)}
              {round.settled
                ? ` · settled ${fmtTs(round.settlementTime)}`
                : ` · settles ${fmtTs(round.settlementTime)}`}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--fg-dim)] hover:text-[var(--fg)] text-2xl leading-none ml-3"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          {/* Allocations side by side */}
          <div className="grid md:grid-cols-2 gap-6">
            <AllocBar usdc={round.aiUsdcPct} usyc={round.aiUsycPct} eurc={round.aiEurcPct} label="AI allocation" />
            {round.settled ? (
              <AllocBar usdc={round.humanUsdcPct} usyc={round.humanUsycPct} eurc={round.humanEurcPct} label="Human aggregate" />
            ) : (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[var(--fg-muted)] mb-1">Human aggregate</div>
                <div className="text-xs text-[var(--fg-dim)] italic">
                  Set on settlement (off-chain reputation-weighted median of votes)
                </div>
              </div>
            )}
          </div>

          {/* Returns */}
          {round.settled && (
            <div className="grid md:grid-cols-3 gap-3">
              <div className="card p-4">
                <div className="text-[10px] uppercase tracking-wider text-[var(--fg-muted)] mb-1">AI return</div>
                <div className={`text-xl mono ${round.aiReturnBps >= 0 ? 'text-[var(--accent)]' : 'text-[var(--negative)]'}`}>
                  {fmtBps(round.aiReturnBps)}
                </div>
                <div className="text-[10px] text-[var(--fg-dim)] mt-0.5 mono">{fmtPct(round.aiReturnBps)}</div>
              </div>
              <div className="card p-4">
                <div className="text-[10px] uppercase tracking-wider text-[var(--fg-muted)] mb-1">Human return</div>
                <div className={`text-xl mono ${round.humanReturnBps >= 0 ? 'text-[var(--accent)]' : 'text-[var(--negative)]'}`}>
                  {fmtBps(round.humanReturnBps)}
                </div>
                <div className="text-[10px] text-[var(--fg-dim)] mt-0.5 mono">{fmtPct(round.humanReturnBps)}</div>
              </div>
              <div className="card p-4">
                <div className="text-[10px] uppercase tracking-wider text-[var(--fg-muted)] mb-1">Alpha (AI − Human)</div>
                <div className={`text-xl mono ${alpha !== null && alpha >= 0 ? 'text-[var(--accent)]' : 'text-[var(--negative)]'}`}>
                  {alpha !== null ? fmtBps(alpha) : '—'}
                </div>
                <div className="text-[10px] text-[var(--fg-dim)] mt-0.5">
                  {alpha === null ? '' : alpha >= 0 ? 'AI outperformed' : 'Human outperformed'}
                </div>
              </div>
            </div>
          )}

          {/* AI reasoning */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--fg-muted)] mb-2">
              AI reasoning (from DecisionLog event)
            </div>
            {loadingDecision ? (
              <div className="text-xs text-[var(--fg-dim)] italic">Loading reasoning...</div>
            ) : decision ? (
              <div className="card p-4">
                <p className="text-sm text-[var(--fg)] leading-relaxed mb-3">{decision.reasoning}</p>
                <div className="flex items-center justify-between text-[10px] text-[var(--fg-dim)] mono">
                  <span>confidence {decision.confidence}%</span>
                  {decision.txHash && (
                    <a
                      href={`${ACTIVE_CHAIN.explorer}/tx/${decision.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--accent)] hover:underline"
                    >
                      Verify on Arcscan ↗
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-xs text-[var(--fg-dim)] italic">
                Reasoning not in the recent event window. Read directly from the DecisionLog contract on Arcscan.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
