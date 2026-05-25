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
      {
        symbol: 'USDC', address: c.USDC, role: 'stable-reserve', decimals: 6, issuer: 'Circle',
        yieldApr: 3.30,
        yieldSource: 'Aave V3 Ethereum mainnet supply rate (DefiLlama, benchmark for what USDC would earn once Bow routes it through a lending leg on Arc; no lending protocol live on Arc testnet yet)',
      },
      {
        symbol: 'USYC', address: c.USYC, role: 'tbill-yield', decimals: 6, issuer: 'Circle',
        yieldApr: 3.55,
        yieldSource: 'Circle native USYC issuance, real on-chain accrual',
      },
      {
        symbol: 'EURC', address: c.EURC, role: 'fx-leg', decimals: 6, issuer: 'Circle',
        yieldApr: 1.91,
        yieldSource: 'Aave V3 Ethereum mainnet supply rate (DefiLlama, same benchmark caveat as USDC) + EUR/USD FX exposure',
      },
    ],

    capabilities: [
      'deposit(asset, amount)',
      'requestWithdraw(shares) + claimWithdraw() with 1-round cooldown',
      'executeAllocation(usdcPct, usycPct, eurcPct, reasoning, confidence) [AI operator only]',
      'voteHuman(roundId, usdcPct, usycPct, eurcPct) [permissionless]',
      'reads market state every 6h via GitHub Actions cron',
      'rebalance threshold: 200bps minimum allocation delta, 6h cooldown enforced on-chain',
      'x402 pay-per-read on agent reasoning: 0.005 USDC per decision unlock',
      'session keys for repeated reads: 1 USDC opens a 200-credit, 24h-expiry session with refundable close',
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
        name: 'read-latest-decision-summary',
        method: 'HTTP GET',
        url: 'https://bow-gamma.vercel.app/api/decisions',
        gated: false,
      },
      {
        name: 'read-full-reasoning-x402',
        method: 'HTTP GET',
        url: 'https://bow-gamma.vercel.app/api/agent-reasoning/{decisionId}',
        gated: true,
        pricing: {
          scheme: 'arc-erc20-usdc-v1',
          asset: c.USDC,
          recipient: '0x3a0Dd90212838f32a953Acd4B32596b62859324A',
          amount: '5000',
          amountHuman: '0.005 USDC',
          retryHeader: 'X-Payment-Tx',
        },
        spec: 'On first call returns HTTP 402 with payment instructions. Client signs USDC.transfer(operator, 5000) on Arc, retries with X-Payment-Tx header. Server verifies the on-chain receipt then serves the full Claude reasoning trace + reasoningHash + tx receipt.',
      },
      {
        name: 'open-reasoning-session',
        method: 'HTTP GET',
        url: 'https://bow-gamma.vercel.app/api/agent-session?action=open&tx={txHash}',
        gated: true,
        pricing: {
          scheme: 'arc-erc20-usdc-v1',
          asset: c.USDC,
          recipient: '0x3a0Dd90212838f32a953Acd4B32596b62859324A',
          amount: '1000000',
          amountHuman: '1.000 USDC',
          creditsGranted: 200,
          perCreditCostHuman: '0.005 USDC',
          windowHours: 24,
        },
        spec: 'After a 1 USDC transfer, server issues an HMAC-signed session token. Subsequent reads pass X-Session-Token on /api/agent-reasoning/{id}, each consumes one credit. /api/agent-session?action=close returns a signed refund manifest for unused credits. Pattern: open once, call many, close once.',
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
