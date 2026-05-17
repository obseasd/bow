/// Bow agent loop. Same architecture as Mensa Mantle but with 3 assets and
/// Arc-specific market state. The agent reads real yield + FX state, reads
/// its own on-chain track record, and proposes a (usdc, usyc, eurc) split.

import Anthropic from '@anthropic-ai/sdk'

export interface MarketState {
  /// Asset prices in USD (1:1 placeholder until V2 wires real oracles)
  usdcPriceUsd: number
  usycPriceUsd: number
  eurcPriceUsd: number
  /// Annual yields per asset (%, e.g. 3.55 for 3.55%)
  usdcYieldPct: number
  usycYieldPct: number
  eurcYieldPct: number
  /// EUR / USD spot for FX context
  eurUsdSpot: number
  /// Current allocation
  currentUsdcPct: number
  currentUsycPct: number
  currentEurcPct: number
  /// TVL (USD)
  totalTvlUsd: number
  /// Timestamp
  timestamp: number
}

export interface AgentDecision {
  action: 'REBALANCE' | 'HOLD'
  newUsdcPct: number
  newUsycPct: number
  newEurcPct: number
  confidence: number
  reasoning: string
  marketSnapshot: MarketState
  proposedAt: number
  source: 'claude' | 'heuristic'
}

const SYSTEM_PROMPT = `You are Bow, an autonomous AI treasury agent on Arc (Circle's stablecoin L1).
Your job is to allocate funds across three managed assets:

1. USDC, the native gas token of Arc. Pure USD stable, zero yield, zero
   internal slippage. The risk-off leg.

2. USYC, Circle's US Yield Coin. Tokenized short-term US Treasury Bills.
   Earns roughly 3 to 4 percent APY. Permissioned issuance via Circle.
   The yield leg.

3. EURC, Circle's Euro stablecoin. EUR-denominated. Provides FX exposure
   to EUR vs USD movements, plus any yield Circle attaches (currently 0
   but architecturally similar to USDC). The FX leg.

You decide a target allocation across the three (sum equals 100, each in
percentage points 0 to 100).

PRIMARY OBJECTIVE:
- Optimize for risk-adjusted yield. Capture the spread when USYC yield
  exceeds the cost of holding USDC. Capture FX upside when EUR strengthens
  vs USD. Stay defensive (high USDC) when risks rise.

REBALANCE ECONOMICS (must consider before proposing REBALANCE):
- On Arc, gas is paid in USDC and is roughly 0.01 USD per transaction.
- DEX slippage on Arc testnet is meaningful for small pools. Assume 0.5%
  of trade size at production pool depth.
- Only propose REBALANCE if expected yield differential captured over the
  next 30 days clearly exceeds the rebalance cost.
- The on-chain rebalance threshold is 200bps (2 percentage points on the
  max-changing leg). Target moves must clear that gap to be accepted.

STICKINESS (anti flip-flop):
- Do not reverse a direction (increase then decrease a leg, or vice versa)
  within 24 hours unless market state changed by more than 300 bps on the
  underlying spread.
- If you rebalanced toward USYC last round and the yield spread has not
  widened further, prefer HOLD over reversing.
- Treat your own recent track record (provided below) as evidence. If you
  rebalanced 3+ times in the last 24h, the bar to act again should be very
  high.

ACTION BIAS (when conditions justify):
- Tilt to USYC (45 to 70%) when T-bill APY exceeds USDC opportunity cost by
  100 bps or more AND a clear yield path exists.
- Tilt to EURC (20 to 50%) when EUR/USD is in a clear uptrend AND macro
  signals favor EUR vs USD (rate cuts ahead in the US, etc.). Treat FX as
  an opportunistic leg, not a default holding.
- Tilt to USDC (40 to 70%) defensively when volatility spikes or the
  yield spread compresses to less than 50 bps.
- Maintain diversification: keep each asset between 10% and 70% under
  normal conditions. Single-asset concentration is reserved for very high
  conviction.

OUTPUT FORMAT:
You will receive the current market state and must respond with:
1. action: REBALANCE or HOLD
2. newUsdcPct, newUsycPct, newEurcPct: target percentages (integers, sum 100)
3. confidence: 0 to 100 integer
4. reasoning: ONE clear sentence in plain English, including the cost
   consideration if you chose HOLD

Format your response as valid JSON only. No prose outside the JSON.`

export async function decideAllocation(state: MarketState, apiKey?: string): Promise<AgentDecision> {
  const key = apiKey || process.env.ANTHROPIC_API_KEY
  if (!key) return heuristicDecision(state)

  const userMessage = `Current market state:

USDC:
  Price: $${state.usdcPriceUsd.toFixed(4)}
  Yield: ${state.usdcYieldPct.toFixed(2)}%

USYC:
  Price: $${state.usycPriceUsd.toFixed(4)}
  T-bill APY: ${state.usycYieldPct.toFixed(2)}%

EURC:
  Price: $${state.eurcPriceUsd.toFixed(4)}
  Yield: ${state.eurcYieldPct.toFixed(2)}%
  EUR/USD spot: ${state.eurUsdSpot.toFixed(4)}

Vault:
  Current allocation: USDC ${state.currentUsdcPct}% · USYC ${state.currentUsycPct}% · EURC ${state.currentEurcPct}%
  Total TVL: $${state.totalTvlUsd.toFixed(2)}

USYC yield premium vs USDC: ${(state.usycYieldPct - state.usdcYieldPct).toFixed(2)}pp

Make your allocation decision. Respond with JSON only.`

  try {
    const client = new Anthropic({ apiKey: key })
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    })
    const text = resp.content[0].type === 'text' ? resp.content[0].text : ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON in Claude response')
    const parsed = JSON.parse(jsonMatch[0])

    let u = clampPct(parsed.newUsdcPct ?? state.currentUsdcPct)
    let y = clampPct(parsed.newUsycPct ?? state.currentUsycPct)
    let e = clampPct(parsed.newEurcPct ?? state.currentEurcPct)
    const total = u + y + e
    if (total !== 100) {
      // Renormalize defensively so the contract accepts the call.
      u = Math.round((u * 100) / total)
      y = Math.round((y * 100) / total)
      e = 100 - u - y
    }

    return {
      action: parsed.action === 'REBALANCE' ? 'REBALANCE' : 'HOLD',
      newUsdcPct: u,
      newUsycPct: y,
      newEurcPct: e,
      confidence: clampPct(parsed.confidence ?? 50),
      reasoning: parsed.reasoning || 'No reasoning provided',
      marketSnapshot: state,
      proposedAt: Date.now(),
      source: 'claude',
    }
  } catch (err) {
    console.error('[bow] Claude call failed, falling back to heuristic:', (err as Error).message)
    return heuristicDecision(state)
  }
}

function heuristicDecision(state: MarketState): AgentDecision {
  const spread = state.usycYieldPct - state.usdcYieldPct
  let u = state.currentUsdcPct
  let y = state.currentUsycPct
  let e = state.currentEurcPct
  let action: AgentDecision['action'] = 'HOLD'
  let reasoning = ''

  if (spread > 2) {
    // Strong USYC yield premium, tilt to USYC
    y = Math.min(60, y + 10)
    u = Math.max(20, u - 5)
    e = 100 - u - y
    action = 'REBALANCE'
    reasoning = `USYC T-bill APY exceeds USDC by ${spread.toFixed(2)}pp. Tilting to USYC for higher carry. EUR neutral.`
  } else if (spread < 0.5) {
    // Defensive
    u = Math.min(60, u + 10)
    y = Math.max(20, y - 5)
    e = 100 - u - y
    action = 'REBALANCE'
    reasoning = `USYC yield premium has compressed to ${spread.toFixed(2)}pp. Defensive tilt to USDC, FX neutral.`
  } else {
    reasoning = `USYC premium ${spread.toFixed(2)}pp insufficient to justify rebalance cost (gas + slippage). Holding current ${u}/${y}/${e} mix.`
  }

  return {
    action,
    newUsdcPct: u,
    newUsycPct: y,
    newEurcPct: e,
    confidence: 60,
    reasoning,
    marketSnapshot: state,
    proposedAt: Date.now(),
    source: 'heuristic',
  }
}

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, Math.floor(Number(n) || 0)))
}
