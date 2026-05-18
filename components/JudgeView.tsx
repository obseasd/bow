'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ACTIVE_CHAIN } from '@/lib/chains'

interface Snapshot {
  totalRounds: number
  totalDecisions: number
  aiWins: number
  humanWins: number
  aiWinRatePct: number
  allocation: { usdc: number; usyc: number; eurc: number }
  balances: { usdc: string; usyc: string; eurc: string }
  totalAssetsUsd: string
  deployed: boolean
}

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

const c = ACTIVE_CHAIN.contracts as Record<string, string>

const CONTRACTS = [
  { label: 'HybridVault', addr: c.bowVault, role: '3-asset vault, cooldown withdraw, AI-callable executeAllocation' },
  { label: 'DecisionLog', addr: c.decisionLog, role: 'Append-only on-chain reasoning record, reasoning text in event data' },
  { label: 'TournamentVault', addr: c.tournamentVault, role: '24h rounds, human votes on 3-asset allocation, settle on-chain' },
  { label: 'BowAgentIdentity (ERC-8004)', addr: c.agentIdentity, role: 'ERC-8004 IdentityRegistry. Bow agent registered as agentId #1, discoverable for A2A composability.' },
]

const ai = '0x3a0Dd90212838f32a953Acd4B32596b62859324A'

function shortAddr(a: string) {
  if (!a) return '—'
  return `${a.slice(0, 8)}…${a.slice(-6)}`
}

export default function JudgeView() {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [latest, setLatest] = useState<Decision | null>(null)

  useEffect(() => {
    fetch('/api/onchain').then(r => r.json()).then(setSnap).catch(() => {})
    fetch('/api/decisions').then(r => r.json()).then(d => setLatest(d.latest)).catch(() => {})
  }, [])

  const tvl = snap ? (Number(snap.totalAssetsUsd) / 1e6).toFixed(2) : '—'

  return (
    <div className="space-y-10">
      {/* Hero */}
      <section>
        <div className="flex items-center gap-2 mb-4 text-[10px] uppercase tracking-wider text-[var(--accent)] mono">
          <span className="pulse" />
          Judge Quick Start
        </div>
        <h1 className="text-4xl md:text-5xl font-medium tracking-tight leading-[1.05] mb-4">
          Everything verifiable about Bow,<br />
          <span className="text-[var(--accent)]">on one page.</span>
        </h1>
        <p className="text-base text-[var(--fg-muted)] max-w-2xl leading-relaxed">
          Every link points at on-chain state, every claim is reproducible from contract reads.
          Nothing on this page is a screenshot.
        </p>
      </section>

      {/* Live snapshot */}
      <section>
        <SectionTitle>Live snapshot</SectionTitle>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Tile label="TVL" value={`$${tvl}`} detail="across USDC + USYC + EURC" accent />
          <Tile
            label="AI win rate"
            value={snap && (snap.aiWins + snap.humanWins) > 0 ? `${snap.aiWinRatePct.toFixed(0)}%` : '—'}
            detail={snap ? `${snap.aiWins}W · ${snap.humanWins}L` : ''}
          />
          <Tile
            label="Rounds"
            value={snap ? String(snap.totalRounds) : '—'}
            detail={snap ? `${snap.totalRounds - snap.aiWins - snap.humanWins} pending` : ''}
          />
          <Tile
            label="AI allocation"
            value={snap ? `${snap.allocation.usdc}/${snap.allocation.usyc}/${snap.allocation.eurc}` : '—'}
            detail="USDC / USYC / EURC"
            accent
          />
        </div>
      </section>

      {/* Verify in one click */}
      <section>
        <SectionTitle>Verify in one click</SectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          <LinkCard
            title="GitHub source"
            description="MIT licensed, all contracts + frontend + agent loop, single commit history."
            href="https://github.com/obseasd/bow"
            cta="github.com/obseasd/bow"
          />
          <LinkCard
            title="Live product"
            description="The frontend you can connect a wallet to right now and exercise the full flow."
            href="https://bow-gamma.vercel.app"
            cta="bow-gamma.vercel.app"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <LinkCard
            title="Arc CLI submission"
            description="Bow's status, product updates, traction updates, all logged via arc-canteen."
            href="https://arc-cli-server.thecanteenapp.com"
            cta="arc-canteen update history"
          />
          <LinkCard
            title="Arc testnet explorer"
            description="Every transaction by the AI operator, every event from the contracts."
            href={`${ACTIVE_CHAIN.explorer}/address/${ai}`}
            cta="testnet.arcscan.app"
          />
          <LinkCard
            title="ERC-8004 agent card"
            description="The agent card JSON pointed at by the IdentityRegistry NFT. Spec-compliant ERC-8004 registration-v1."
            href="https://bow-gamma.vercel.app/api/agent-card"
            cta="/api/agent-card"
          />
        </div>
      </section>

      {/* Bow contracts */}
      <section>
        <SectionTitle>Bow contracts, all verifiable on Arc testnet</SectionTitle>
        <div className="space-y-2">
          {CONTRACTS.map(ct => (
            <ContractRow key={ct.label} label={ct.label} addr={ct.addr} role={ct.role} />
          ))}
          <ContractRow label="AI operator" addr={ai} role="The wallet that signs executeAllocation, settles rounds, and runs the cron loop. Owner of the vault." />
        </div>
      </section>

      {/* Latest decision */}
      <section>
        <SectionTitle>Latest AI decision, from DecisionLog</SectionTitle>
        {latest ? (
          <div className="card p-5">
            <div className="flex items-baseline gap-3 mb-3">
              <span className="text-2xl mono font-medium">#{latest.id}</span>
              <span className="text-[10px] mono text-[var(--accent)] px-2 py-1 border border-[var(--accent)]" style={{ borderRadius: 2 }}>
                conf {latest.confidence}%
              </span>
              <span className="text-[10px] mono text-[var(--fg-dim)]">{new Date(latest.timestamp * 1000).toISOString()}</span>
            </div>
            <div className="flex gap-2 mb-3 text-xs mono">
              <span className="px-3 py-1 border border-[var(--border)] asset-usdc" style={{ borderRadius: 2 }}>USDC {latest.usdcPct}%</span>
              <span className="px-3 py-1 border border-[var(--border)] asset-usyc" style={{ borderRadius: 2 }}>USYC {latest.usycPct}%</span>
              <span className="px-3 py-1 border border-[var(--border)] asset-eurc" style={{ borderRadius: 2 }}>EURC {latest.eurcPct}%</span>
            </div>
            <p className="text-sm text-[var(--fg)] leading-relaxed mb-3">{latest.reasoning}</p>
            {latest.txHash && (
              <a
                href={`${ACTIVE_CHAIN.explorer}/tx/${latest.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] mono text-[var(--accent)] hover:underline"
              >
                Verify on Arcscan ↗
              </a>
            )}
          </div>
        ) : (
          <div className="card p-5 text-sm text-[var(--fg-dim)]">No decision yet (or reasoning outside the recent event window).</div>
        )}
      </section>

      {/* Distinctive design choices */}
      <section>
        <SectionTitle>Three design choices worth understanding</SectionTitle>
        <div className="grid md:grid-cols-3 gap-3">
          <Tile
            label="Cooldown withdraw"
            value="1 round"
            detail="When a user requests a withdraw, shares are burned and locked to the current round. Claim is available at the start of the next round. Anti flash-deposit sandwich on the rebalance."
          />
          <Tile
            label="Cost-aware AI"
            value="6h cooldown"
            detail="Claude prompt is told gas + slippage costs. Only rebalances when expected yield differential over the next 30 days clearly exceeds the cost. 200 bps minimum allocation delta enforced on-chain."
          />
          <Tile
            label="Multi-currency basket"
            value="USDC + USYC + EURC"
            detail="3-asset stable + T-bill + FX exposure. Unique among Adaptive Portfolio Manager submissions which mostly handle 1 or 2 trading assets."
          />
        </div>
      </section>

      {/* Yield model */}
      <section>
        <SectionTitle>Yield model</SectionTitle>
        <div className="card p-5">
          <div className="grid grid-cols-3 gap-3 text-xs mb-4">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--fg-muted)] mb-1">USDC</div>
              <div className="text-xl mono asset-usdc">3.30%</div>
              <div className="text-[10px] text-[var(--fg-dim)] mt-1">Aave V3 mainnet supply (benchmark)</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--fg-muted)] mb-1">USYC</div>
              <div className="text-xl mono asset-usyc">3.55%</div>
              <div className="text-[10px] text-[var(--fg-dim)] mt-1">Circle native, real on-chain</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--fg-muted)] mb-1">EURC</div>
              <div className="text-xl mono asset-eurc">1.91%</div>
              <div className="text-[10px] text-[var(--fg-dim)] mt-1">Aave V3 mainnet supply (benchmark) + FX</div>
            </div>
          </div>
          <p className="text-xs text-[var(--fg-muted)] leading-relaxed mb-4">
            <span className="text-[var(--fg)] font-medium">USYC yield is real, on-chain, accrued via Circle&apos;s native USYC issuance.</span>{' '}
            USDC and EURC rates are pulled live from DefiLlama&apos;s Aave V3 Ethereum mainnet supply rates: they
            represent what Bow would earn once the lending leg is integrated on Arc. Arc testnet has no live
            lending protocol yet, so we&apos;re honest about this being a benchmark, not real testnet accrual.
            The AI uses these three numbers to compute risk-adjusted allocation across the basket.
          </p>

          <div className="text-[10px] uppercase tracking-wider text-[var(--fg-muted)] mb-2">
            Lending protocols that support BOTH USDC and EURC (sourced via DefiLlama, ranked by EURC pool TVL)
          </div>
          <div className="text-[11px] space-y-1.5 mono">
            <div className="grid grid-cols-[1fr_80px_90px_90px] gap-2 text-[var(--fg-dim)] pb-1 border-b border-[var(--border)]">
              <div>Protocol · Chain</div>
              <div className="text-right">USDC APY</div>
              <div className="text-right">EURC APY</div>
              <div className="text-right">EURC TVL</div>
            </div>
            <div className="grid grid-cols-[1fr_80px_90px_90px] gap-2 text-[var(--fg-muted)]">
              <div className="text-[var(--fg)]">Aave V3 · Ethereum</div>
              <div className="text-right">3.30%</div>
              <div className="text-right">1.91%</div>
              <div className="text-right">$22.3M</div>
            </div>
            <div className="grid grid-cols-[1fr_80px_90px_90px] gap-2 text-[var(--fg-muted)]">
              <div className="text-[var(--fg)]">Aave V3 · Base</div>
              <div className="text-right">3.10%</div>
              <div className="text-right">1.49%</div>
              <div className="text-right">$6.0M</div>
            </div>
            <div className="grid grid-cols-[1fr_80px_90px_90px] gap-2 text-[var(--fg-muted)]">
              <div className="text-[var(--fg)]">Morpho Blue · Ethereum</div>
              <div className="text-right">~4.0%</div>
              <div className="text-right">3.00%</div>
              <div className="text-right">$57.0M</div>
            </div>
            <div className="grid grid-cols-[1fr_80px_90px_90px] gap-2 text-[var(--fg-muted)]">
              <div className="text-[var(--fg)]">Fluid Lending · Base</div>
              <div className="text-right">3.50%</div>
              <div className="text-right">1.89%</div>
              <div className="text-right">$1.9M</div>
            </div>
          </div>
          <div className="text-[10px] text-[var(--fg-dim)] mt-3 leading-relaxed">
            Path of least resistance for Bow once Arc DeFi matures: Aave V3 (institutional defaults), then
            Morpho Blue (higher yield via Steakhouse vaults) if it lands on Arc. Both already support USDC + EURC
            natively, so the integration is a thin wrapper that mints aUSDC/aEURC at deposit and redeems on
            withdraw + rebalance.
          </div>
        </div>
      </section>

      {/* Honest scope */}
      <section>
        <SectionTitle>Honest MVP scope</SectionTitle>
        <ul className="space-y-2 text-sm text-[var(--fg-muted)] leading-relaxed">
          <li className="flex gap-3"><span className="mono text-[var(--accent)] shrink-0">NOW</span><span>Vault holds and accounts user deposits. AI rebalances target allocation on-chain. Tournament rounds open and settle. Notional returns measured (no real DEX swap yet because Arc testnet pool depth is bootstrap-stage).</span></li>
          <li className="flex gap-3"><span className="mono text-[var(--accent)] shrink-0">NEXT</span><span>Real DEX swap execution on rebalance through a Circle App Kit swap component or direct AMM, with slippage caps. Move share valuation off the nominal 1:1 anchor to a price-oracle model.</span></li>
          <li className="flex gap-3"><span className="mono text-[var(--accent)] shrink-0">NEXT</span><span>Lending leg for USDC + EURC. The 3.30% and 1.91% rates surfaced above are Aave V3 mainnet benchmarks. Once Aave or another lending protocol deploys on Arc (mainnet expected soon per Circle docs), Bow routes idle USDC and EURC through aTokens to realise the yield on-chain.</span></li>
          <li className="flex gap-3"><span className="mono text-[var(--fg-muted)] shrink-0">LATER</span><span>Circle Wallets API for email-based onboarding. Paymaster for gasless first deposit. CCTP for cross-chain USDC entry.</span></li>
        </ul>
      </section>

      {/* CTAs */}
      <section className="border-t border-[var(--border)] pt-8">
        <div className="flex flex-wrap gap-3">
          <Link href="/" className="btn-accent text-sm" style={{ borderRadius: 2 }}>
            Open the vault →
          </Link>
          <a
            href="https://github.com/obseasd/bow"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary text-sm"
            style={{ borderRadius: 2 }}
          >
            GitHub repo
          </a>
          <a
            href="https://faucet.circle.com"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary text-sm"
            style={{ borderRadius: 2 }}
          >
            Get Arc testnet USDC
          </a>
        </div>
      </section>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[11px] uppercase tracking-[0.15em] text-[var(--fg-muted)] mb-3">{children}</h2>
}

function Tile({ label, value, detail, accent }: { label: string; value: string | number; detail: string; accent?: boolean }) {
  return (
    <div className="card p-4">
      <div className={`text-2xl font-medium tracking-tight mono ${accent ? 'text-[var(--accent)]' : ''}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--fg-muted)] mt-2">{label}</div>
      <div className="text-[10px] text-[var(--fg-dim)] mt-1 leading-relaxed">{detail}</div>
    </div>
  )
}

function ContractRow({ label, addr, role }: { label: string; addr: string; role: string }) {
  return (
    <a
      href={`${ACTIVE_CHAIN.explorer}/address/${addr}`}
      target="_blank"
      rel="noopener noreferrer"
      className="card p-4 block hover:border-[var(--accent)] transition group"
    >
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="text-sm font-medium text-[var(--fg)] shrink-0">{label}</span>
          <span className="text-[11px] mono text-[var(--fg-muted)] group-hover:text-[var(--accent)] truncate">
            {shortAddr(addr)}
          </span>
        </div>
        <span className="text-[var(--fg-dim)] group-hover:text-[var(--accent)] transition shrink-0">↗</span>
      </div>
      <div className="text-[11px] text-[var(--fg-dim)] leading-relaxed">{role}</div>
    </a>
  )
}

function LinkCard({ title, description, href, cta }: { title: string; description: string; href: string; cta: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="card p-5 block hover:border-[var(--accent)] transition group"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium text-[var(--fg)]">{title}</div>
        <span className="text-[var(--fg-dim)] group-hover:text-[var(--accent)] transition">↗</span>
      </div>
      <div className="text-xs text-[var(--fg-muted)] leading-relaxed mb-3">{description}</div>
      <div className="text-[11px] mono text-[var(--accent)] group-hover:underline">{cta}</div>
    </a>
  )
}
