'use client'

export default function LatestDecision() {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs uppercase tracking-wider text-[var(--fg-muted)]">Latest AI decision</h2>
        <span className="text-[10px] text-[var(--fg-dim)]">read from DecisionLog</span>
      </div>
      <div className="card p-6">
        <p className="text-sm text-[var(--fg-muted)] leading-relaxed">
          The Decision feed renders the most recent allocation call from
          Claude, with the reasoning text emitted as event data on Arc. It
          will populate after the first cron tick runs on Arc testnet (gas
          paid in USDC).
        </p>
      </div>
    </div>
  )
}
