/// Bow x402 + agent session layer.
///
/// Two parallel monetization surfaces, both denominated in native USDC on
/// Arc (ERC-20, 6 decimals):
///
///  1. Pay-per-read (HTTP 402, x402 pattern):
///     - Client GETs /api/agent-reasoning/[id]
///     - Server replies 402 with payment instructions (recipient, asset, amount, chain)
///     - Client signs and broadcasts a USDC.transfer to recipient, then retries
///       the GET with the tx hash in the X-Payment-Tx header
///     - Server verifies the tx on chain (correct recipient + amount + asset + freshness)
///       and serves the paid resource
///     - Each tx is single-use: marked consumed in an in-process set so the
///       same payment can't unlock two reads
///
///  2. Session keys (ArcPort-inspired):
///     - Client opens a bounded session by sending 1 USDC (200 read credits)
///       to the operator wallet
///     - Server verifies the tx, issues an HMAC-signed session token carrying
///       (sessionId, totalCredits, expiresAt, paymentTx)
///     - Each subsequent read consumes 1 credit, tracked in-process
///     - Client can close the session at any time, server emits a signed
///       refund manifest the user can present to claim back unused USDC
///
/// In-process state survives until the next cold start / redeploy, which is
/// the right scope for a hackathon-stage demo. Production would persist the
/// consumption state on chain (the session vault contract) instead of in
/// memory; the contract design is sketched in BowSessionVault below but not
/// deployed in V1.

import { ethers } from 'ethers'
import { createHmac, randomBytes } from 'crypto'
import { ACTIVE_CHAIN } from './chains'

/// Wallet that receives x402 payments and session deposits.
/// Same address as the AI operator so the operator wallet earns the
/// agent revenue directly. Could be split to a treasury multi-sig in V2.
export const OPERATOR_WALLET = '0x3a0Dd90212838f32a953Acd4B32596b62859324A'

/// Pay-per-read price: 0.005 USDC = 5000 (6 decimals).
export const READ_PRICE_USDC_RAW = BigInt(5000)

/// Session subscribe price: 1 USDC = 1_000_000 (6 decimals).
export const SESSION_PRICE_USDC_RAW = BigInt(1_000_000)

/// Number of read credits granted per subscribed session.
export const SESSION_READ_CREDITS = 200

/// Maximum freshness of a payment tx that can unlock a read. 30 min, enough
/// to absorb Arc finality and a slow user, short enough that a leaked tx
/// hash from yesterday cannot replay against the API forever.
const PAYMENT_MAX_AGE_SEC = 30 * 60

/// USDC ERC-20 ABI minimal subset for tx verification.
const USDC_ABI = [
  'function decimals() view returns (uint8)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]

function getProvider() {
  return new ethers.JsonRpcProvider(ACTIVE_CHAIN.rpc, undefined, { batchMaxCount: 1 })
}

/// Tx hashes consumed by a paid read (or a session open). Prevents replay
/// across requests. In-process Set, fine until cold start.
const consumedTxs = new Set<string>()

/// Live sessions: sessionId -> { credits remaining, expires, payment tx }.
/// Cleared on cold start (acceptable for hackathon demo, see header).
interface SessionState {
  id: string
  totalCredits: number
  creditsUsed: number
  expiresAt: number
  paymentTx: string
  openedAt: number
  closed: boolean
}
const sessions = new Map<string, SessionState>()

export interface PaymentRequiredResponse {
  paymentRequired: true
  scheme: 'arc-erc20-usdc-v1'
  amount: string         // raw 6-decimal USDC units as decimal string
  amountHuman: string    // "0.005 USDC" for display
  asset: string          // USDC contract address on Arc
  recipient: string      // operator wallet
  chain: { id: number; name: string; explorer: string }
  retryHeader: string    // header name the client should set on retry
  validitySeconds: number
}

export function buildPaymentRequired(amountRaw: bigint): PaymentRequiredResponse {
  return {
    paymentRequired: true,
    scheme: 'arc-erc20-usdc-v1',
    amount: amountRaw.toString(),
    amountHuman: `${(Number(amountRaw) / 1e6).toFixed(3)} USDC`,
    asset: ACTIVE_CHAIN.contracts.USDC,
    recipient: OPERATOR_WALLET,
    chain: {
      id: ACTIVE_CHAIN.id,
      name: ACTIVE_CHAIN.name,
      explorer: ACTIVE_CHAIN.explorer,
    },
    retryHeader: 'X-Payment-Tx',
    validitySeconds: PAYMENT_MAX_AGE_SEC,
  }
}

export interface PaymentVerification {
  ok: boolean
  reason?: string
  amountPaidRaw?: bigint
  from?: string
}

/// Verify that `txHash` is a USDC transfer to OPERATOR_WALLET for at least
/// `requiredAmountRaw` (6-decimal units), confirmed within the freshness
/// window, on Arc. Marks the tx as consumed if it succeeds.
export async function verifyUSDCPayment(
  txHash: string,
  requiredAmountRaw: bigint,
): Promise<PaymentVerification> {
  const normalized = txHash.toLowerCase()
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) {
    return { ok: false, reason: 'Invalid tx hash format' }
  }
  if (consumedTxs.has(normalized)) {
    return { ok: false, reason: 'Payment already consumed' }
  }

  const provider = getProvider()
  let receipt: ethers.TransactionReceipt | null = null
  let block: ethers.Block | null = null
  try {
    receipt = await provider.getTransactionReceipt(normalized)
  } catch (e) {
    return { ok: false, reason: `RPC error fetching receipt: ${(e as Error).message}` }
  }
  if (!receipt) return { ok: false, reason: 'Tx not found (still pending or wrong chain?)' }
  if (receipt.status !== 1) return { ok: false, reason: 'Tx reverted' }

  try {
    block = await provider.getBlock(receipt.blockNumber)
  } catch {
    /* block fetch failure is non-fatal, only used for freshness; default to now */
  }
  const blockTime = block ? Number(block.timestamp) : Math.floor(Date.now() / 1000)
  const age = Math.floor(Date.now() / 1000) - blockTime
  if (age > PAYMENT_MAX_AGE_SEC) {
    return { ok: false, reason: `Payment too old (${age}s > ${PAYMENT_MAX_AGE_SEC}s window)` }
  }

  // Decode Transfer events from the USDC contract within this receipt.
  const usdcAddr = ACTIVE_CHAIN.contracts.USDC.toLowerCase()
  const iface = new ethers.Interface(USDC_ABI)
  let from = ''
  let totalToOperator = BigInt(0)
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== usdcAddr) continue
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data })
      if (parsed?.name !== 'Transfer') continue
      const to = String(parsed.args[1]).toLowerCase()
      if (to !== OPERATOR_WALLET.toLowerCase()) continue
      const value = parsed.args[2] as bigint
      totalToOperator += value
      from = String(parsed.args[0])
    } catch {
      // not a Transfer log we can decode, skip
    }
  }

  if (totalToOperator < requiredAmountRaw) {
    return {
      ok: false,
      reason: `Insufficient amount: paid ${totalToOperator}, required ${requiredAmountRaw}`,
    }
  }

  consumedTxs.add(normalized)
  return { ok: true, amountPaidRaw: totalToOperator, from }
}

/// HMAC-signed session token. Format: base64url(payload) "." base64url(sig).
/// Payload is JSON { id, total, expiresAt, paymentTx }. Sig is HMAC-SHA256 of
/// the payload with BOW_SESSION_SECRET. Allows the server to verify a token
/// is its own issuance without persisting the secret across requests.
function getSessionSecret(): string {
  const s = process.env.BOW_SESSION_SECRET
  if (s && s.length >= 32) return s
  // Dev fallback so /agent works without setting the env. Production should
  // always provision BOW_SESSION_SECRET explicitly.
  return 'bow-dev-session-secret-do-not-use-in-production-this-string-is-long-enough'
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

function signPayload(payload: object): string {
  const json = JSON.stringify(payload)
  const sig = createHmac('sha256', getSessionSecret()).update(json).digest()
  return `${b64url(Buffer.from(json))}.${b64url(sig)}`
}

function verifyToken(token: string): { id: string; total: number; expiresAt: number; paymentTx: string } | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  let payload: { id: string; total: number; expiresAt: number; paymentTx: string }
  try {
    payload = JSON.parse(b64urlDecode(parts[0]).toString('utf8'))
  } catch {
    return null
  }
  const expectedSig = createHmac('sha256', getSessionSecret()).update(JSON.stringify(payload)).digest()
  const givenSig = b64urlDecode(parts[1])
  if (expectedSig.length !== givenSig.length) return null
  if (!expectedSig.equals(givenSig)) return null
  return payload
}

export interface OpenSessionResult {
  ok: boolean
  reason?: string
  sessionId?: string
  token?: string
  totalCredits?: number
  expiresAt?: number
  paymentTx?: string
}

/// Open a bounded session backed by a confirmed 1 USDC payment.
/// Returns a signed token the client stores and presents on each read.
export async function openSession(paymentTx: string): Promise<OpenSessionResult> {
  const v = await verifyUSDCPayment(paymentTx, SESSION_PRICE_USDC_RAW)
  if (!v.ok) return { ok: false, reason: v.reason }

  const sessionId = b64url(randomBytes(12))
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + 24 * 60 * 60  // 24h session window
  const state: SessionState = {
    id: sessionId,
    totalCredits: SESSION_READ_CREDITS,
    creditsUsed: 0,
    expiresAt,
    paymentTx: paymentTx.toLowerCase(),
    openedAt: now,
    closed: false,
  }
  sessions.set(sessionId, state)
  const token = signPayload({
    id: sessionId,
    total: SESSION_READ_CREDITS,
    expiresAt,
    paymentTx: paymentTx.toLowerCase(),
  })
  return {
    ok: true,
    sessionId,
    token,
    totalCredits: SESSION_READ_CREDITS,
    expiresAt,
    paymentTx: paymentTx.toLowerCase(),
  }
}

export interface SessionReadResult {
  ok: boolean
  reason?: string
  creditsRemaining?: number
  creditsUsed?: number
}

/// Consume one credit from the session. Validates token signature, expiry,
/// closed-state, and in-memory consumption count.
export function consumeSessionCredit(token: string): SessionReadResult {
  const payload = verifyToken(token)
  if (!payload) return { ok: false, reason: 'Invalid or tampered session token' }
  const now = Math.floor(Date.now() / 1000)
  if (now > payload.expiresAt) return { ok: false, reason: 'Session expired' }
  const state = sessions.get(payload.id)
  if (!state) return { ok: false, reason: 'Session not found (server may have restarted, please re-open)' }
  if (state.closed) return { ok: false, reason: 'Session already closed' }
  if (state.creditsUsed >= state.totalCredits) {
    return { ok: false, reason: 'No credits remaining (open a new session or use pay-per-read)' }
  }
  state.creditsUsed += 1
  return {
    ok: true,
    creditsRemaining: state.totalCredits - state.creditsUsed,
    creditsUsed: state.creditsUsed,
  }
}

export interface SessionStatus {
  id: string
  totalCredits: number
  creditsUsed: number
  creditsRemaining: number
  expiresAt: number
  paymentTx: string
  closed: boolean
}

export function getSessionStatus(token: string): SessionStatus | null {
  const payload = verifyToken(token)
  if (!payload) return null
  const state = sessions.get(payload.id)
  if (!state) return null
  return {
    id: state.id,
    totalCredits: state.totalCredits,
    creditsUsed: state.creditsUsed,
    creditsRemaining: state.totalCredits - state.creditsUsed,
    expiresAt: state.expiresAt,
    paymentTx: state.paymentTx,
    closed: state.closed,
  }
}

export interface CloseSessionResult {
  ok: boolean
  reason?: string
  creditsRemaining?: number
  refundAmountRaw?: string
  refundAmountHuman?: string
  refundManifest?: {
    sessionId: string
    paymentTx: string
    creditsRemaining: number
    refundAmountUsdc: string
    operatorWallet: string
    note: string
  }
}

/// Close a session and produce a signed refund manifest. The manifest is the
/// proof a user can attach to a manual refund request (operator pays back
/// `creditsRemaining * READ_PRICE_USDC_RAW` USDC). V1 keeps the refund path
/// off-chain; V2 will move the consumption + refund logic to a session vault
/// contract so refunds are trustless.
export function closeSession(token: string): CloseSessionResult {
  const payload = verifyToken(token)
  if (!payload) return { ok: false, reason: 'Invalid session token' }
  const state = sessions.get(payload.id)
  if (!state) return { ok: false, reason: 'Session not found' }
  if (state.closed) return { ok: false, reason: 'Session already closed' }
  state.closed = true
  const remaining = state.totalCredits - state.creditsUsed
  const refundRaw = BigInt(remaining) * READ_PRICE_USDC_RAW
  return {
    ok: true,
    creditsRemaining: remaining,
    refundAmountRaw: refundRaw.toString(),
    refundAmountHuman: `${(Number(refundRaw) / 1e6).toFixed(3)} USDC`,
    refundManifest: {
      sessionId: state.id,
      paymentTx: state.paymentTx,
      creditsRemaining: remaining,
      refundAmountUsdc: refundRaw.toString(),
      operatorWallet: OPERATOR_WALLET,
      note: 'Manual refund in V1: attach this manifest in a DM to the operator. V2 ships a BowSessionVault contract for trustless refunds.',
    },
  }
}
