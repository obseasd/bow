import { NextResponse } from 'next/server'
import { ethers } from 'ethers'
import { ACTIVE_CHAIN } from '@/lib/chains'
import {
  buildPaymentRequired,
  verifyUSDCPayment,
  consumeSessionCredit,
  READ_PRICE_USDC_RAW,
} from '@/lib/x402'

export const dynamic = 'force-dynamic'

const DECISION_LOG_ABI = [
  'function totalDecisions() view returns (uint256)',
  'function decisions(uint256) view returns (uint8 usdcPct, uint8 usycPct, uint8 eurcPct, uint8 confidence, bytes32 reasoningHash, uint64 timestamp)',
  'event DecisionLogged(uint256 indexed id, address indexed agent, uint8 usdcPct, uint8 usycPct, uint8 eurcPct, uint8 confidence, bytes32 reasoningHash, string reasoning, uint64 timestamp)',
] as const

interface FullReasoning {
  id: number
  usdcPct: number
  usycPct: number
  eurcPct: number
  confidence: number
  reasoning: string
  reasoningHash: string
  timestamp: number
  txHash: string
  blockNumber: number
}

/// Fetch the full reasoning text for decision #id from DecisionLog events.
/// Free preview (no payment) returns only the first 80 chars; paid call
/// returns the full text plus the hash + tx receipt fields.
async function fetchDecision(id: number): Promise<FullReasoning | null> {
  const provider = new ethers.JsonRpcProvider(ACTIVE_CHAIN.rpc, undefined, { batchMaxCount: 1 })
  const log = new ethers.Contract(
    (ACTIVE_CHAIN.contracts as Record<string, string>).decisionLog,
    DECISION_LOG_ABI,
    provider,
  )
  try {
    const total = Number(await log.totalDecisions())
    if (id < 1 || id > total) return null
    const d = await log.decisions(id)
    const usdcPct = Number(d.usdcPct ?? d[0])
    const usycPct = Number(d.usycPct ?? d[1])
    const eurcPct = Number(d.eurcPct ?? d[2])
    const confidence = Number(d.confidence ?? d[3])
    const reasoningHash = String(d.reasoningHash ?? d[4])
    const timestamp = Number(d.timestamp ?? d[5])

    // Pull the matching DecisionLogged event for the full reasoning text + tx hash.
    let reasoning = '(reasoning not in event window)'
    let txHash = ''
    let blockNumber = 0
    try {
      const filter = log.filters.DecisionLogged(id)
      const events = await log.queryFilter(filter, -50000, 'latest')
      if (events.length > 0) {
        const e = events[events.length - 1] as ethers.EventLog
        reasoning = String(e.args?.reasoning ?? reasoning)
        txHash = e.transactionHash
        blockNumber = e.blockNumber
      }
    } catch {
      /* event window too large or RPC blip — fall through with defaults */
    }

    return { id, usdcPct, usycPct, eurcPct, confidence, reasoning, reasoningHash, timestamp, txHash, blockNumber }
  } catch (e) {
    console.error('[bow agent-reasoning] fetchDecision failed:', (e as Error).message)
    return null
  }
}

/// Three ways to call this endpoint:
///
///  A) GET without payment → returns HTTP 402 with payment instructions.
///     The body also includes a free preview (action + alloc + first 80 chars
///     of reasoning) so the user can decide whether the paid read is worth it.
///
///  B) GET with header X-Payment-Tx: 0x... → verifies the tx is a USDC
///     transfer of at least 0.005 USDC to the operator wallet, then serves
///     the full reasoning.
///
///  C) GET with header X-Session-Token: ... → consumes one credit from a
///     previously-opened session and serves the full reasoning.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await ctx.params
  const id = Number(idStr)
  if (!Number.isFinite(id) || id < 1) {
    return NextResponse.json({ error: 'Invalid decision id' }, { status: 400 })
  }
  const decision = await fetchDecision(id)
  if (!decision) {
    return NextResponse.json({ error: 'Decision not found' }, { status: 404 })
  }

  const sessionToken = req.headers.get('x-session-token')
  if (sessionToken) {
    const res = consumeSessionCredit(sessionToken)
    if (!res.ok) {
      return NextResponse.json(
        { error: res.reason, hint: 'Open a fresh session via /api/agent-session?action=open' },
        { status: 402 },
      )
    }
    return NextResponse.json(
      {
        ...decision,
        paidVia: 'session',
        creditsRemaining: res.creditsRemaining,
        creditsUsed: res.creditsUsed,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const paymentTx = req.headers.get('x-payment-tx')
  if (paymentTx) {
    const v = await verifyUSDCPayment(paymentTx, READ_PRICE_USDC_RAW)
    if (!v.ok) {
      return NextResponse.json(
        { error: v.reason, paymentRequired: buildPaymentRequired(READ_PRICE_USDC_RAW) },
        { status: 402 },
      )
    }
    return NextResponse.json(
      {
        ...decision,
        paidVia: 'x402',
        paymentTx: paymentTx.toLowerCase(),
        payerFrom: v.from,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

  // No payment, no session: return the 402 challenge plus a free preview.
  return NextResponse.json(
    {
      paymentRequired: buildPaymentRequired(READ_PRICE_USDC_RAW),
      preview: {
        id: decision.id,
        usdcPct: decision.usdcPct,
        usycPct: decision.usycPct,
        eurcPct: decision.eurcPct,
        confidence: decision.confidence,
        reasoningPreview: decision.reasoning.slice(0, 80) + (decision.reasoning.length > 80 ? '…' : ''),
        reasoningLength: decision.reasoning.length,
        timestamp: decision.timestamp,
        txHash: decision.txHash,
      },
      hint: 'Send 0.005 USDC to the recipient on chain 5042002 (Arc), then retry with header X-Payment-Tx: 0x... — or open a session at /api/agent-session?action=open after sending 1 USDC for 200 reads.',
    },
    { status: 402, headers: { 'Cache-Control': 'no-store' } },
  )
}
