#!/usr/bin/env node
// Bow agent loop — runs every cron tick on Arc testnet.
//
// What it does:
//   1. Read on-chain state of the HybridVault (current allocation, last
//      rebalance, balances) and the TournamentVault (open rounds, time
//      remaining).
//   2. Build a market snapshot for the 3 assets:
//      - USDC price: anchored at $1
//      - USYC price: $1 (V1 simplification; V2 reads Circle oracle)
//      - EURC price: spot EUR/USD (fetched from Coingecko)
//      - Yields: USDC 0%, USYC 3.55% (DefiLlama or Ondo-style anchor),
//        EURC 0% (no Circle yield yet)
//   3. Call Claude (via lib/agent.ts logic, inlined here for Node) to
//      decide a new target allocation.
//   4. If Claude returns REBALANCE and the target clears on-chain
//      thresholds, send executeAllocation(...) signed by the AI operator.
//   5. Auto-settle expired rounds (>24h since open).
//
// Required env:
//   PRIVATE_KEY        — AI operator private key (0x + 64 hex)
//   ANTHROPIC_API_KEY  — optional; without it the agent uses a heuristic
//   BOW_VAULT          — HybridVault address on Arc
//   BOW_DECISION_LOG   — DecisionLog address on Arc
//   BOW_TOURNAMENT     — TournamentVault address on Arc

import { ethers } from 'ethers'
import Anthropic from '@anthropic-ai/sdk'

const RPC = 'https://rpc.testnet.arc.network'
const CHAIN_ID = 5042002

// Circle native on Arc testnet
const USDC = '0x3600000000000000000000000000000000000000'
const USYC = '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C'
const EURC = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a'

const VAULT_ABI = [
  'function getAllocation() view returns (uint8 u, uint8 y, uint8 e)',
  'function getBalances() view returns (uint256 usdc, uint256 usyc, uint256 eurc)',
  'function totalAssetsUsd() view returns (uint256)',
  'function minRebalanceBps() view returns (uint256)',
  'function minTimeBetweenRebalances() view returns (uint256)',
  'function lastRebalanceAt() view returns (uint256)',
  'function executeAllocation(uint8 newUsdcPct, uint8 newUsycPct, uint8 newEurcPct, string calldata reasoning, uint8 confidence) external returns (uint256, uint256)',
]

const TOURNAMENT_ABI = [
  'function totalRounds() view returns (uint256)',
  'function aiWins() view returns (uint256)',
  'function humanWins() view returns (uint256)',
  'function rounds(uint256) view returns (uint256 id, uint64 startTime, uint64 settlementTime, uint256 startUsdcPrice, uint256 startUsycPrice, uint256 startEurcPrice, uint256 settleUsdcPrice, uint256 settleUsycPrice, uint256 settleEurcPrice, uint8 aiUsdcPct, uint8 aiUsycPct, uint8 aiEurcPct, uint8 humanUsdcPct, uint8 humanUsycPct, uint8 humanEurcPct, int256 aiReturnBps, int256 humanReturnBps, uint8 outcome, bool settled)',
  'function settleRound(uint256 roundId, uint256 settleUsdcPrice, uint256 settleUsycPrice, uint256 settleEurcPrice, uint8 humanUsdcPct, uint8 humanUsycPct, uint8 humanEurcPct) external',
]

const SYSTEM_PROMPT = `You are Bow, an autonomous AI treasury agent on Arc (Circle's stablecoin L1).
You allocate funds across three managed assets:
1. USDC, pure USD stable, gas token, no yield, the risk-off leg.
2. USYC, Circle's tokenized US Treasury bills, ~3.55% APY, the yield leg.
3. EURC, Circle's Euro stablecoin, FX exposure to EUR/USD, the FX leg.

You output JSON with: action (REBALANCE or HOLD), newUsdcPct, newUsycPct,
newEurcPct (sum to 100), confidence (0-100), reasoning (one sentence).

RULES:
- The on-chain min-rebalance threshold is 200 bps (2pp). Any single-leg
  change must clear that gap.
- Rebalance cooldown is 6 hours.
- Each rebalance costs about $0.01 in gas plus slippage at production
  pool depth (~0.5% of trade size). Only rebalance when the captured
  yield differential over 30 days clearly exceeds that cost.
- Stickiness: do not reverse a leg you just moved within 24h unless the
  underlying spread moved by more than 300 bps.
- Maintain diversification: each asset between 10% and 70% under normal
  conditions.`

function sign(n) { return n >= 0 ? '+' : '' }
function clampPct(n) { return Math.max(0, Math.min(100, Math.floor(Number(n) || 0))) }

async function fetchMarketState(vault) {
  const [alloc, balances, totalAssets] = await Promise.all([
    vault.getAllocation(),
    vault.getBalances(),
    vault.totalAssetsUsd(),
  ])
  // Fetch EUR/USD spot from Coingecko
  let eurUsdSpot = 1.08
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=tether-eurt&vs_currencies=usd')
    if (r.ok) {
      const j = await r.json()
      const px = j?.['tether-eurt']?.usd
      if (typeof px === 'number' && px > 0.5 && px < 2) eurUsdSpot = px
    }
  } catch {}
  return {
    currentUsdcPct: Number(alloc[0]),
    currentUsycPct: Number(alloc[1]),
    currentEurcPct: Number(alloc[2]),
    usdcBalance: balances[0],
    usycBalance: balances[1],
    eurcBalance: balances[2],
    totalAssetsUsd: Number(ethers.formatUnits(totalAssets, 6)),
    usdcYieldPct: 0,
    usycYieldPct: 3.55,
    eurcYieldPct: 0,
    eurUsdSpot,
    timestamp: Date.now(),
  }
}

async function fetchTrackRecord(tournament) {
  const [total, aiW, hW] = await Promise.all([
    tournament.totalRounds(),
    tournament.aiWins(),
    tournament.humanWins(),
  ])
  const t = Number(total)
  if (t === 0) return { lines: ['Track record: no settled rounds yet, this is your early decision-making.'] }

  const lines = [`Track record: ${aiW} AI wins, ${hW} baseline wins, ${t} total rounds.`]
  // Pull last 5 settled
  const recent = []
  for (let i = t; i >= Math.max(1, t - 5); i--) {
    const r = await tournament.rounds(i)
    if (r[18]) {
      const aiBps = Number(r[15])
      const baseBps = Number(r[16])
      const alpha = aiBps - baseBps
      recent.push(`  Round #${i}: AI alloc ${r[9]}/${r[10]}/${r[11]} (USDC/USYC/EURC), alpha vs human ${sign(alpha)}${alpha}bps`)
    }
  }
  if (recent.length) {
    lines.push('Recent settled rounds:')
    lines.push(...recent)
  }
  return { lines }
}

async function decideAllocation(state, trackRecord, apiKey) {
  if (!apiKey) return heuristic(state)

  const userMsg = `Current market state:

USDC: $1.00, yield 0%
USYC: $1.00, T-bill APY 3.55%
EURC: $${state.eurUsdSpot.toFixed(4)}, yield 0%
EUR/USD spot: ${state.eurUsdSpot.toFixed(4)}

Vault:
  Current allocation: USDC ${state.currentUsdcPct}% / USYC ${state.currentUsycPct}% / EURC ${state.currentEurcPct}%
  Total TVL: $${state.totalAssetsUsd.toFixed(2)}

USYC yield premium vs USDC: 3.55pp (constant for now)

${trackRecord.lines.join('\n')}

Make your allocation decision. Respond with JSON only.`

  try {
    const client = new Anthropic({ apiKey })
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMsg }],
    })
    const text = resp.content[0].type === 'text' ? resp.content[0].text : ''
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) throw new Error('No JSON in Claude response')
    const parsed = JSON.parse(m[0])
    let u = clampPct(parsed.newUsdcPct ?? state.currentUsdcPct)
    let y = clampPct(parsed.newUsycPct ?? state.currentUsycPct)
    let e = clampPct(parsed.newEurcPct ?? state.currentEurcPct)
    const sum = u + y + e
    if (sum !== 100) {
      u = Math.round((u * 100) / sum)
      y = Math.round((y * 100) / sum)
      e = 100 - u - y
    }
    return {
      action: parsed.action === 'REBALANCE' ? 'REBALANCE' : 'HOLD',
      newUsdcPct: u,
      newUsycPct: y,
      newEurcPct: e,
      confidence: clampPct(parsed.confidence ?? 50),
      reasoning: parsed.reasoning || 'No reasoning',
      source: 'claude',
    }
  } catch (err) {
    console.warn('[bow] Claude failed, fallback heuristic:', err.message)
    return heuristic(state)
  }
}

function heuristic(state) {
  // USYC always yields more than USDC in our anchor (3.55% vs 0%), so
  // tilt USYC unless we just rebalanced.
  const target = state.currentUsdcPct === 40 && state.currentUsycPct === 50 ? null : { u: 40, y: 50, e: 10 }
  if (!target) {
    return {
      action: 'HOLD',
      newUsdcPct: state.currentUsdcPct,
      newUsycPct: state.currentUsycPct,
      newEurcPct: state.currentEurcPct,
      confidence: 55,
      reasoning: 'Allocation already aligned with USYC yield premium, holding.',
      source: 'heuristic',
    }
  }
  return {
    action: 'REBALANCE',
    newUsdcPct: target.u,
    newUsycPct: target.y,
    newEurcPct: target.e,
    confidence: 65,
    reasoning: 'USYC yields 3.55% vs 0% for USDC. Tilting to 50% USYC, 40% USDC defensive, 10% EURC FX leg.',
    source: 'heuristic',
  }
}

async function tryExecute(wallet, vault, decision, state) {
  if (decision.action !== 'REBALANCE') {
    console.log('[bow] HOLD. Reasoning:', decision.reasoning)
    return false
  }
  // Check cooldown
  const last = Number(await vault.lastRebalanceAt())
  const cooldown = Number(await vault.minTimeBetweenRebalances())
  const now = Math.floor(Date.now() / 1000)
  if (last > 0 && now < last + cooldown) {
    const remaining = last + cooldown - now
    console.log(`[bow] Cooldown active. ${remaining}s remaining. Skipping.`)
    return false
  }
  // Check min delta
  const minBps = Number(await vault.minRebalanceBps())
  const dU = Math.abs(decision.newUsdcPct - state.currentUsdcPct)
  const dY = Math.abs(decision.newUsycPct - state.currentUsycPct)
  const dE = Math.abs(decision.newEurcPct - state.currentEurcPct)
  const maxD = Math.max(dU, dY, dE) * 100
  if (maxD < minBps) {
    console.log(`[bow] Max leg delta ${maxD} bps below threshold ${minBps}. Skipping.`)
    return false
  }
  // Send tx
  console.log(`[bow] Sending executeAllocation: USDC=${decision.newUsdcPct}% USYC=${decision.newUsycPct}% EURC=${decision.newEurcPct}%`)
  console.log(`[bow] Reasoning: ${decision.reasoning}`)
  try {
    const tx = await vault.executeAllocation(decision.newUsdcPct, decision.newUsycPct, decision.newEurcPct, decision.reasoning, decision.confidence)
    console.log('[bow] tx hash:', tx.hash)
    await tx.wait()
    console.log('[bow] Confirmed.')
    return true
  } catch (err) {
    console.error('[bow] executeAllocation failed:', err.shortMessage || err.message)
    return false
  }
}

async function settleExpired(wallet, tournament) {
  const total = Number(await tournament.totalRounds())
  if (total === 0) return 0
  let settled = 0
  for (let i = 1; i <= total; i++) {
    const r = await tournament.rounds(i)
    if (r[18]) continue // already settled
    const settlementTime = Number(r[2])
    const now = Math.floor(Date.now() / 1000)
    if (now < settlementTime) continue
    // Ready to settle. V1: assume prices stayed at 1e8 (we don't have
    // oracles wired yet on Arc testnet). The settle reads identical
    // start/settle prices so all returns are 0 and the round resolves
    // as TIE. This is honest for an MVP without price feeds.
    try {
      const tx = await tournament.settleRound(i, 1e8, 1e8, 1e8, 33, 34, 33)
      console.log(`[bow] Settling round #${i}: tx ${tx.hash}`)
      await tx.wait()
      settled++
    } catch (err) {
      console.error(`[bow] settle round #${i} failed:`, err.shortMessage || err.message)
    }
  }
  return settled
}

async function main() {
  const pk = (process.env.PRIVATE_KEY || '').trim().replace(/^["']|["']$/g, '')
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    console.error('PRIVATE_KEY missing or malformed (expect 0x + 64 hex chars)')
    process.exit(1)
  }
  const vaultAddr = process.env.BOW_VAULT
  const tournamentAddr = process.env.BOW_TOURNAMENT
  if (!vaultAddr || !tournamentAddr) {
    console.error('Set BOW_VAULT and BOW_TOURNAMENT env (post-deploy addresses)')
    process.exit(1)
  }

  const provider = new ethers.JsonRpcProvider(RPC)
  const wallet = new ethers.Wallet(pk, provider)
  const vault = new ethers.Contract(vaultAddr, VAULT_ABI, wallet)
  const tournament = new ethers.Contract(tournamentAddr, TOURNAMENT_ABI, wallet)

  console.log('=== Bow agent loop ===')
  console.log('Wallet:', wallet.address)
  console.log('Vault :', vaultAddr)
  console.log('Tournament:', tournamentAddr)

  // 1. Settle expired rounds
  const settledCount = await settleExpired(wallet, tournament)
  if (settledCount > 0) console.log(`[bow] Settled ${settledCount} round(s).`)

  // 2. Read state + decide
  const state = await fetchMarketState(vault)
  const trackRecord = await fetchTrackRecord(tournament)
  const decision = await decideAllocation(state, trackRecord, process.env.ANTHROPIC_API_KEY)
  console.log(`[bow] Decision (${decision.source}): ${decision.action} USDC=${decision.newUsdcPct} USYC=${decision.newUsycPct} EURC=${decision.newEurcPct} conf=${decision.confidence}`)

  // 3. Execute if needed
  await tryExecute(wallet, vault, decision, state)
}

main().catch(err => { console.error(err); process.exit(1) })
