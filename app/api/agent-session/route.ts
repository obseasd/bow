import { NextResponse } from 'next/server'
import {
  openSession,
  closeSession,
  getSessionStatus,
  SESSION_PRICE_USDC_RAW,
  SESSION_READ_CREDITS,
  buildPaymentRequired,
} from '@/lib/x402'

export const dynamic = 'force-dynamic'

/// Session lifecycle endpoint.
///
///   GET /api/agent-session?action=open&tx=0x...
///     Verify a 1 USDC tx to the operator wallet on Arc, then issue a
///     signed session token carrying 200 read credits.
///
///   GET /api/agent-session?action=status&token=...
///     Read remaining credits + expiry without consuming.
///
///   GET /api/agent-session?action=close&token=...
///     Close the session, emit a signed refund manifest the user can
///     present for off-chain refund of unused credits.
///
///   GET /api/agent-session (no params)
///     Returns the payment requirements for opening a session.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const action = url.searchParams.get('action')

  if (!action) {
    return NextResponse.json({
      info: 'Bow agent session keys',
      pricing: {
        ...buildPaymentRequired(SESSION_PRICE_USDC_RAW),
        creditsGranted: SESSION_READ_CREDITS,
        perCreditCostHuman: '0.005 USDC',
        windowHours: 24,
      },
      actions: {
        open: '/api/agent-session?action=open&tx=0x... (after sending 1 USDC to recipient)',
        status: '/api/agent-session?action=status&token=...',
        close: '/api/agent-session?action=close&token=...',
        read: 'Pass the X-Session-Token header on GET /api/agent-reasoning/[id]',
      },
    })
  }

  if (action === 'open') {
    const tx = url.searchParams.get('tx')
    if (!tx) {
      return NextResponse.json(
        { error: 'Missing tx parameter', paymentRequired: buildPaymentRequired(SESSION_PRICE_USDC_RAW) },
        { status: 400 },
      )
    }
    const res = await openSession(tx)
    if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 402 })
    return NextResponse.json(
      {
        sessionId: res.sessionId,
        token: res.token,
        totalCredits: res.totalCredits,
        expiresAt: res.expiresAt,
        paymentTx: res.paymentTx,
        usage: 'Store the token locally and pass it as X-Session-Token on each GET /api/agent-reasoning/[id]',
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

  if (action === 'status') {
    const token = url.searchParams.get('token')
    if (!token) return NextResponse.json({ error: 'Missing token parameter' }, { status: 400 })
    const status = getSessionStatus(token)
    if (!status) return NextResponse.json({ error: 'Invalid or unknown session token' }, { status: 404 })
    return NextResponse.json(status, { headers: { 'Cache-Control': 'no-store' } })
  }

  if (action === 'close') {
    const token = url.searchParams.get('token')
    if (!token) return NextResponse.json({ error: 'Missing token parameter' }, { status: 400 })
    const res = closeSession(token)
    if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 400 })
    return NextResponse.json(
      {
        closed: true,
        creditsRemaining: res.creditsRemaining,
        refundAmountRaw: res.refundAmountRaw,
        refundAmountHuman: res.refundAmountHuman,
        refundManifest: res.refundManifest,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
}
