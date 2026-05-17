'use client'

export default function RecentRounds() {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs uppercase tracking-wider text-[var(--fg-muted)]">Recent rounds</h2>
        <span className="text-[10px] text-[var(--fg-dim)]">AI vs human, settled on-chain</span>
      </div>
      <div className="card p-6">
        <p className="text-sm text-[var(--fg-muted)] leading-relaxed">
          The Turing tournament will display each settled 24h round here:
          AI&apos;s 3-asset allocation, human aggregate allocation, who beat
          who in basis points. Empty until the first round settles after
          deployment to Arc testnet.
        </p>
      </div>
    </div>
  )
}
