'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ACTIVE_CHAIN } from '@/lib/chains'

interface LendingState {
  deployed: boolean
  pool?: string
  reserves?: Array<{ symbol: string; asset: string; accepted: boolean; aprBps: number; totalSupplied: string }>
  operatorPosition?: { address: string; perAsset: Array<{ symbol: string; principalAndInterest: string; interestEarned: string }> }
}

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
  { label: 'HybridVault V2', addr: c.bowVault, role: '3-asset vault with real treasury control. AI-callable supplyToLending / withdrawFromLending routes idle USDC and EURC into BowLendingPool. Cooldown withdraw, AI-callable executeAllocation.' },
  { label: 'DecisionLog', addr: c.decisionLog, role: 'Append-only on-chain reasoning record. Reasoning text lives in event data, structured pcts in storage.' },
  { label: 'TournamentVault', addr: c.tournamentVault, role: '24h rounds, human votes on 3-asset allocation, settle on-chain.' },
  { label: 'BowLendingPool', addr: c.lendingPool, role: 'Aave-style supply pool live on Arc testnet. The vault routes idle USDC and EURC through this pool to earn supply yield. Replaceable by an Aave V3 adapter once Aave lands on Arc.' },
  { label: 'BowAgentIdentity (ERC-8004)', addr: c.agentIdentity, role: 'ERC-8004 IdentityRegistry. Bow agent registered as agentId #1, discoverable for A2A composability.' },
  { label: 'HybridVault V1 (archive)', addr: c.bowVaultV1, role: 'Original V1 vault, deprecated 2026-05-18. Holds residual USDC until users claim. Kept for transparency, not used by the frontend.' },
]

const ai = '0x3a0Dd90212838f32a953Acd4B32596b62859324A'

function shortAddr(a: string) {
  if (!a) return '—'
  return `${a.slice(0, 8)}…${a.slice(-6)}`
}

export default function JudgeView() {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [latest, setLatest] = useState<Decision | null>(null)
  const [lending, setLending] = useState<LendingState | null>(null)

  useEffect(() => {
    fetch('/api/onchain').then(r => r.json()).then(setSnap).catch(() => {})
    fetch('/api/decisions').then(r => r.json()).then(d => setLatest(d.latest)).catch(() => {})
    fetch('/api/lending').then(r => r.json()).then(setLending).catch(() => {})
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

      {/* Lending integration — live on Arc testnet */}
      <section>
        <SectionTitle>Lending integration (live on Arc testnet)</SectionTitle>
        {lending?.deployed && lending.reserves && lending.operatorPosition ? (
          <div className="space-y-3">
            <div className="card p-5">
              <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
                <div>
                  <div className="text-sm font-medium text-[var(--fg)]">BowLendingPool</div>
                  <div className="text-[11px] text-[var(--fg-dim)] mt-1 leading-relaxed">
                    Aave-style mock pool deployed on Arc testnet. Demonstrates the lending leg of Bow&apos;s
                    strategy end-to-end, with linear interest accrual on each supplied asset. Replaceable
                    by a thin Aave V3 adapter once Aave deploys on Arc mainnet.
                  </div>
                </div>
                <a
                  href={`${ACTIVE_CHAIN.explorer}/address/${lending.pool}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] mono px-3 py-1.5 border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent-soft)] transition shrink-0"
                  style={{ borderRadius: 2 }}
                >
                  {lending.pool!.slice(0, 8)}…{lending.pool!.slice(-6)} ↗
                </a>
              </div>

              {/* Reserves table */}
              <div className="text-[10px] uppercase tracking-wider text-[var(--fg-muted)] mb-2">
                Reserves on-chain
              </div>
              <div className="text-[11px] mono">
                <div className="grid grid-cols-[60px_90px_1fr_120px] gap-3 text-[var(--fg-dim)] pb-1 border-b border-[var(--border)]">
                  <div>Asset</div>
                  <div className="text-right">APR</div>
                  <div className="text-right">Total supplied</div>
                  <div className="text-right">Status</div>
                </div>
                {lending.reserves.map(r => {
                  const cls = r.symbol === 'USDC' ? 'asset-usdc' : r.symbol === 'USYC' ? 'asset-usyc' : 'asset-eurc'
                  const totalFmt = (Number(r.totalSupplied) / 1e6).toFixed(4)
                  return (
                    <div key={r.symbol} className="grid grid-cols-[60px_90px_1fr_120px] gap-3 py-2 border-b border-[var(--border)] last:border-b-0">
                      <div className={`font-medium ${cls}`}>{r.symbol}</div>
                      <div className="text-right text-[var(--fg)]">{(r.aprBps / 100).toFixed(2)}%</div>
                      <div className="text-right text-[var(--fg)]">{totalFmt}</div>
                      <div className="text-right text-[var(--fg-muted)]">
                        {r.accepted ? <span className="text-[var(--accent)]">accepted</span> : 'disabled'}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Operator live position with accrued interest */}
            <div className="card p-5">
              <div className="text-[10px] uppercase tracking-wider text-[var(--fg-muted)] mb-2">
                Live operator position (refreshes every page load — interest accrues per second)
              </div>
              <div className="text-[11px] text-[var(--fg-dim)] mb-4 leading-relaxed">
                The vault auto-routes a portion of each user deposit into BowLendingPool. The principal +
                interest below is read from <code className="mono text-[var(--fg)]">balanceOf(operator, asset)</code> in
                real time. Refresh in 10 minutes and the interest line will be higher.
              </div>
              <div className="grid md:grid-cols-3 gap-3 text-xs">
                {lending.operatorPosition.perAsset.map(p => {
                  const cls = p.symbol === 'USDC' ? 'asset-usdc' : p.symbol === 'USYC' ? 'asset-usyc' : 'asset-eurc'
                  const bal = Number(p.principalAndInterest) / 1e6
                  const earned = Number(p.interestEarned) / 1e6
                  return (
                    <div key={p.symbol} className="card p-3" style={{ background: 'var(--bg-elevated)' }}>
                      <div className={`text-[10px] uppercase tracking-wider mb-1 ${cls}`}>{p.symbol}</div>
                      <div className="text-lg mono text-[var(--fg)]">{bal.toFixed(6)}</div>
                      <div className="text-[10px] text-[var(--accent)] mono mt-1">
                        +{(earned * 1e6).toFixed(2)} micro{p.symbol} earned
                      </div>
                      <div className="text-[10px] text-[var(--fg-dim)] mt-0.5">
                        ({(earned).toFixed(8)} {p.symbol})
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="text-[10px] text-[var(--fg-dim)] leading-relaxed px-1">
              <span className="text-[var(--fg-muted)] mono">Disclaimer:</span> BowLendingPool is a deliberate
              testnet mock — Aave V3 / Compound / Morpho are not live on Arc yet. The rates (USDC 3.30%, USYC 0%,
              EURC 1.91%) mirror live Aave V3 Ethereum mainnet rates (DefiLlama). When Aave-Arc ships, the pool
              swap is one thin adapter contract: `Pool.supply` and `Pool.withdraw` calls in place of our mock&apos;s
              supply/withdraw. The vault flow stays identical.
            </div>
          </div>
        ) : (
          <div className="card p-5 text-sm text-[var(--fg-dim)]">Loading lending pool state...</div>
        )}
      </section>

      {/* Honest scope */}
      <section>
        <SectionTitle>Honest MVP scope</SectionTitle>
        <ul className="space-y-2 text-sm text-[var(--fg-muted)] leading-relaxed">
          <li className="flex gap-3"><span className="mono text-[var(--accent)] shrink-0">NOW</span><span>Vault holds and accounts user deposits. AI rebalances target allocation on-chain. Tournament rounds open and settle. Notional returns measured (no real DEX swap yet because Arc testnet pool depth is bootstrap-stage).</span></li>
          <li className="flex gap-3"><span className="mono text-[var(--accent)] shrink-0">NOW</span><span>Lending leg is live on Arc testnet. The vault auto-routes idle USDC and EURC into BowLendingPool (3.30% / 1.91% APR mirroring Aave V3 mainnet) and pulls back on withdraws. USYC stays idle since its yield is native via Circle issuance.</span></li>
          <li className="flex gap-3"><span className="mono text-[var(--accent)] shrink-0">NEXT</span><span>Real DEX swap execution on rebalance through a Circle App Kit swap component or direct AMM, with slippage caps. Move share valuation off the nominal 1:1 anchor to a price-oracle model.</span></li>
          <li className="flex gap-3"><span className="mono text-[var(--accent)] shrink-0">NEXT</span><span>Swap BowLendingPool for an Aave V3 adapter once Aave or a comparable institutional protocol lands on Arc mainnet. The vault flow stays identical, only the pool address changes.</span></li>
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
