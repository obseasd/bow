'use client'

import { useEffect, useState } from 'react'
import { ACTIVE_CHAIN } from '@/lib/chains'

interface Decision {
  id: number
  usdcPct: number
  usycPct: number
  eurcPct: number
  confidence: number
  reasoning: string
  txHash: string
  timestamp: number
}

function timeAgo(ts: number): string {
  const seconds = Math.floor(Date.now() / 1000 - ts)
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

export default function LatestDecision() {
  const [d, setD] = useState<Decision | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/decisions')
      .then((r) => r.json())
      .then((data) => {
        if (data.latest) setD(data.latest)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs uppercase tracking-wider text-[var(--fg-muted)]">Latest AI decision</h2>
        <span className="text-[10px] text-[var(--fg-dim)]">read from DecisionLog</span>
      </div>
      <div className="card p-6">
        {loading ? (
          <p className="text-sm text-[var(--fg-dim)]">Loading...</p>
        ) : !d ? (
          <p className="text-sm text-[var(--fg-muted)] leading-relaxed">
            No decision logged yet. The agent loop runs every 6h on GitHub Actions.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="flex items-baseline gap-3">
                  <span className="text-2xl font-medium mono">#{d.id}</span>
                  <span className="text-xs text-[var(--fg-muted)]">{timeAgo(d.timestamp)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-[var(--fg-dim)]">
                <span>conf</span>
                <span className="mono text-[var(--accent)]">{d.confidence}%</span>
              </div>
            </div>

            {/* Allocation pills */}
            <div className="flex gap-2 mb-4 text-xs">
              <span className="px-3 py-1 border border-[var(--border)] mono asset-usdc" style={{ borderRadius: 2 }}>
                USDC {d.usdcPct}%
              </span>
              <span className="px-3 py-1 border border-[var(--border)] mono asset-usyc" style={{ borderRadius: 2 }}>
                USYC {d.usycPct}%
              </span>
              <span className="px-3 py-1 border border-[var(--border)] mono asset-eurc" style={{ borderRadius: 2 }}>
                EURC {d.eurcPct}%
              </span>
            </div>

            {/* Reasoning */}
            <div className="text-[10px] uppercase tracking-wider text-[var(--fg-muted)] mb-2">Reasoning</div>
            <p className="text-sm text-[var(--fg)] leading-relaxed mb-4">{d.reasoning}</p>

            {/* tx link */}
            {d.txHash && (
              <a
                href={`${ACTIVE_CHAIN.explorer}/tx/${d.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] mono text-[var(--accent)] hover:underline"
              >
                Verify on Arcscan ↗
              </a>
            )}
          </>
        )}
      </div>
    </div>
  )
}
