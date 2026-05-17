import VaultPanel from '@/components/VaultPanel'
import StatsBar from '@/components/StatsBar'
import LatestDecision from '@/components/LatestDecision'
import RecentRounds from '@/components/RecentRounds'
import Nav from '@/components/Nav'

export default function HomePage() {
  return (
    <div className="min-h-screen relative">
      <Nav />
      <main className="relative z-10 max-w-6xl mx-auto px-6 pt-16 pb-20">
        {/* Hero */}
        <section className="mb-12">
          <div className="flex flex-wrap items-center gap-2 mb-6">
            <span className="inline-flex items-center gap-2 px-3 py-1 text-xs text-[var(--fg-muted)] border border-[var(--border)]" style={{ borderRadius: 2 }}>
              <span className="pulse" />
              Live on Arc Testnet
            </span>
            <span className="inline-flex items-center gap-2 px-3 py-1 text-xs text-[var(--accent)] border border-[var(--accent)] mono" style={{ borderRadius: 2 }}>
              Powered by Circle
            </span>
            <span className="inline-flex items-center gap-2 px-3 py-1 text-xs text-[var(--fg-muted)] border border-[var(--border)] mono" style={{ borderRadius: 2 }}>
              Claude Haiku 4.5
            </span>
          </div>

          <h1 className="text-5xl md:text-6xl font-medium tracking-tight leading-[1.05] mb-5">
            <span className="text-[var(--fg)]">A hybrid AI staking primitive,</span><br />
            <span className="text-[var(--accent)]">built on Arc.</span>
          </h1>

          <p className="text-lg text-[var(--fg-muted)] max-w-2xl leading-relaxed mb-3">
            Bow allocates your deposits across <span className="asset-usdc font-medium">USDC</span>,
            {' '}<span className="asset-usyc font-medium">USYC</span>{' '}
            (Circle&apos;s tokenized T-bills) and{' '}
            <span className="asset-eurc font-medium">EURC</span>{' '}
            based on live yield and FX signals. Every decision is reasoned by
            Claude, logged on-chain, and challenged by humans in a 24h tournament.
          </p>
          <p className="text-sm text-[var(--fg-dim)] max-w-2xl leading-relaxed">
            Withdraws have a single-round cooldown to keep the strategy honest
            (no flash-deposit sandwich). The agent is cost-aware: gas plus
            slippage are inputs to every rebalance decision.
          </p>
        </section>

        {/* Live stats */}
        <StatsBar />

        {/* Vault panel (deposit + position + AI allocation) */}
        <section className="mt-10">
          <VaultPanel />
        </section>

        {/* Latest AI decision card */}
        <section className="mt-12">
          <LatestDecision />
        </section>

        {/* Recent tournament rounds */}
        <section className="mt-12">
          <RecentRounds />
        </section>

        {/* Footer */}
        <footer className="mt-20 pt-10 border-t border-[var(--border)] text-[11px] text-[var(--fg-dim)] flex flex-col md:flex-row gap-3 md:gap-6 justify-between">
          <div>
            Bow is an open-source experiment built on{' '}
            <a href="https://www.arc.io" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--accent)] transition">Arc</a>{' '}
            with Circle&apos;s developer platform. MIT licensed. No financial advice.
          </div>
          <div className="flex gap-4">
            <a href="https://testnet.arcscan.app" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--accent)] transition">Arcscan</a>
            <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--accent)] transition">Faucet</a>
            <a href="https://developers.circle.com" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--accent)] transition">Circle docs</a>
          </div>
        </footer>
      </main>
    </div>
  )
}
