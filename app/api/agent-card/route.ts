import { NextResponse } from 'next/server'
import { ACTIVE_CHAIN } from '@/lib/chains'

// ERC-8004 agent card. Returned at this stable URL so the IdentityRegistry
// NFT's tokenURI(1) points here and any A2A-compatible agent can read this
// JSON, learn what Bow does, and compose with it programmatically.

export const dynamic = 'force-dynamic'
export const revalidate = 60

export async function GET() {
  const c = ACTIVE_CHAIN.contracts as Record<string, string>

  return NextResponse.json({
    type: 'eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: 'Bow',
    tagline: 'Hybrid AI staking primitive on Arc',
    description:
      'An autonomous AI treasury agent that allocates user deposits across USDC, USYC, and EURC on Arc. Every allocation decision is reasoned by Claude Haiku 4.5, logged on-chain in the DecisionLog contract, and challenged by humans in a 24h Turing tournament settled on-chain. Withdraws use a single-round cooldown to prevent flash-deposit sandwich on the AI rebalance call.',

    agent: {
      id: 1,
      owner: '0x3a0Dd90212838f32a953Acd4B32596b62859324A',
      model: 'claude-haiku-4-5',
      provider: 'Anthropic',
      kind: 'treasury-management',
      autonomy: 'fully-autonomous',
      humanInLoop: 'optional-via-tournament',
    },

    chain: {
      id: ACTIVE_CHAIN.id,
      name: ACTIVE_CHAIN.name,
      rpc: 'https://rpc.testnet.arc.network',
      explorer: ACTIVE_CHAIN.explorer,
    },

    contracts: {
      hybridVault: c.bowVault,
      decisionLog: c.decisionLog,
      tournamentVault: c.tournamentVault,
      agentIdentity: c.agentIdentity,
    },

    managedAssets: [
      { symbol: 'USDC', address: c.USDC, role: 'pure-stable', yieldApr: 0.0, decimals: 6, issuer: 'Circle' },
      { symbol: 'USYC', address: c.USYC, role: 'tbill-yield',  yieldApr: 3.55, decimals: 6, issuer: 'Circle' },
      { symbol: 'EURC', address: c.EURC, role: 'fx',            yieldApr: 0.0, decimals: 6, issuer: 'Circle' },
    ],

    capabilities: [
      'deposit(asset, amount)',
      'requestWithdraw(shares) + claimWithdraw() with 1-round cooldown',
      'executeAllocation(usdcPct, usycPct, eurcPct, reasoning, confidence) [AI operator only]',
      'voteHuman(roundId, usdcPct, usycPct, eurcPct) [permissionless]',
      'reads market state every 6h via GitHub Actions cron',
      'rebalance threshold: 200bps minimum allocation delta, 6h cooldown enforced on-chain',
    ],

    services: [
      {
        name: 'view-current-allocation',
        method: 'eth_call',
        target: c.bowVault,
        signature: 'getAllocation() returns (uint8, uint8, uint8)',
      },
      {
        name: 'view-tvl-usd',
        method: 'eth_call',
        target: c.bowVault,
        signature: 'totalAssetsUsd() returns (uint256)',
      },
      {
        name: 'read-latest-decision-reasoning',
        method: 'HTTP GET',
        url: 'https://bow-gamma.vercel.app/api/decisions',
      },
    ],

    economics: {
      performanceFeeBps: 0,
      managementFeeBps: 0,
      cooldownRounds: 1,
      roundDurationHours: 24,
    },

    links: {
      product: 'https://bow-gamma.vercel.app',
      judgeQuickStart: 'https://bow-gamma.vercel.app/judge',
      sourceCode: 'https://github.com/obseasd/bow',
      arcCliSubmission: 'https://arc-cli-server.thecanteenapp.com',
    },

    hackathon: {
      name: 'Agora Agents Hackathon',
      organizer: 'Canteen + Circle + Arc',
      tracks: ['adaptive-portfolio-manager'],
    },

    metadata: {
      registeredAt: '2026-05-17',
      registry: c.agentIdentity,
      tokenId: 1,
      schemaVersion: 'eip-8004-registration-v1',
    },
  }, {
    headers: {
      'Cache-Control': 'public, max-age=60, s-maxage=300',
    },
  })
}
