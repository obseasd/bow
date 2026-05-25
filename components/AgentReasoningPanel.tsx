'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAccount, useChainId, useSwitchChain, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { ACTIVE_CHAIN } from '@/lib/chains'
import { showToast } from './Toast'

/// Two-flow agent monetization panel.
///
/// Flow A: Pay-per-read (x402)
///   User sends 0.005 USDC to the operator wallet, the API verifies the tx,
///   then unlocks the full Claude reasoning trace for one decision.
///
/// Flow B: Session subscribe (ArcPort-inspired)
///   User sends 1 USDC once, the API issues a signed session token good for
///   200 reads. Each subsequent read consumes one credit. The user can close
///   the session and receive a signed refund manifest for unused credits.
///
/// Why both: pay-per-read is the simplest market interaction (clean x402),
/// session keys make repeated agent usage practical without spamming
/// micro-approvals. Together they map directly to the Canteen team's hint
/// about "x402 client-side + session keys on top of ArcOSS primitives".

const USDC_TRANSFER_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const

const READ_PRICE_RAW = BigInt(5000)         // 0.005 USDC (6 decimals)
const SESSION_PRICE_RAW = BigInt(1_000_000)  // 1 USDC (6 decimals)

const SESSION_STORAGE_KEY = 'bow_agent_session_v1'

interface PaymentRequired {
  recipient: string
  asset: string
  amount: string
  amountHuman: string
  chain: { id: number; name: string; explorer: string }
}

interface ReasoningPayload {
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
  paidVia: 'x402' | 'session'
  paymentTx?: string
  creditsRemaining?: number
  creditsUsed?: number
}

interface Preview {
  id: number
  usdcPct: number
  usycPct: number
  eurcPct: number
  confidence: number
  reasoningPreview: string
  reasoningLength: number
  timestamp: number
  txHash: string
}

interface StoredSession {
  token: string
  totalCredits: number
  expiresAt: number
  paymentTx: string
  openedAt: number
}

function timeAgo(ts: number): string {
  const seconds = Math.floor(Date.now() / 1000 - ts)
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

function explainError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (msg.match(/user rejected|user denied/i)) return 'You cancelled the transaction.'
  if (msg.match(/insufficient/i)) return 'Insufficient USDC balance (use the Circle faucet).'
  if (msg.match(/chain.*mismatch/i)) return 'Wrong network. Switch to Arc testnet.'
  if (msg.length > 140) return msg.slice(0, 140) + '...'
  return msg
}

export default function AgentReasoningPanel() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { switchChainAsync } = useSwitchChain()
  const isOnArc = chainId === ACTIVE_CHAIN.id

  const [decisionId, setDecisionId] = useState<number | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [paymentChallenge, setPaymentChallenge] = useState<PaymentRequired | null>(null)
  const [unlocked, setUnlocked] = useState<ReasoningPayload | null>(null)
  const [session, setSession] = useState<StoredSession | null>(null)
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'idle' | 'paying-read' | 'subscribing' | 'reading' | 'closing'>('idle')

  // Restore stored session from localStorage on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as StoredSession
      if (parsed.expiresAt > Math.floor(Date.now() / 1000)) {
        setSession(parsed)
      } else {
        localStorage.removeItem(SESSION_STORAGE_KEY)
      }
    } catch {
      /* corrupt entry, ignore */
    }
  }, [])

  // Fetch the latest decision id + the 402 preview on mount.
  const loadPreview = useCallback(async (overrideId?: number) => {
    setLoading(true)
    try {
      // Step 1: figure out the latest decision id via the existing /api/decisions surface.
      let id = overrideId
      if (!id) {
        const r = await fetch('/api/decisions')
        const j = await r.json()
        if (j?.latest?.id) id = j.latest.id
      }
      if (!id) {
        setDecisionId(null)
        setPreview(null)
        return
      }
      setDecisionId(id)
      // Step 2: GET /api/agent-reasoning/[id] without payment, get back 402 + preview.
      const r = await fetch(`/api/agent-reasoning/${id}`)
      if (r.status === 402) {
        const j = await r.json()
        setPaymentChallenge(j.paymentRequired)
        setPreview(j.preview)
      } else if (r.ok) {
        // Shouldn't happen for an unauthenticated call but guard anyway.
        const j = (await r.json()) as ReasoningPayload
        setUnlocked(j)
      }
    } catch (e) {
      console.error('[reasoning panel] preview fetch failed:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadPreview() }, [loadPreview])

  const { writeContractAsync, data: txHash } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash })

  const ensureChain = async (): Promise<boolean> => {
    if (isOnArc) return true
    try {
      await switchChainAsync({ chainId: ACTIVE_CHAIN.id })
      return true
    } catch {
      showToast(`Switch to ${ACTIVE_CHAIN.name} cancelled`, 'error')
      return false
    }
  }

  // Flow A: pay 0.005 USDC -> retry the endpoint with X-Payment-Tx
  const handlePayPerRead = async () => {
    if (!address) {
      showToast('Connect your wallet first', 'error')
      return
    }
    if (!decisionId) return
    if (!(await ensureChain())) return
    setBusy('paying-read')
    try {
      const tx = await writeContractAsync({
        chainId: ACTIVE_CHAIN.id,
        address: ACTIVE_CHAIN.contracts.USDC as `0x${string}`,
        abi: USDC_TRANSFER_ABI,
        functionName: 'transfer',
        args: [paymentChallenge?.recipient as `0x${string}`, READ_PRICE_RAW],
      })
      showToast('Payment sent, waiting for confirmation...', 'success')
      // Poll for the tx receipt, then call the endpoint with the tx hash.
      const settled = await waitForReceipt(tx)
      if (!settled) {
        setBusy('idle')
        showToast('Tx not confirmed yet, retry once it lands', 'error')
        return
      }
      const r = await fetch(`/api/agent-reasoning/${decisionId}`, { headers: { 'X-Payment-Tx': tx } })
      if (r.ok) {
        const j = (await r.json()) as ReasoningPayload
        setUnlocked(j)
        showToast('Reasoning unlocked', 'success')
      } else {
        const j = await r.json()
        showToast(`Read failed: ${j.error ?? 'unknown'}`, 'error')
      }
    } catch (e) {
      showToast(`Payment failed: ${explainError(e)}`, 'error')
    } finally {
      setBusy('idle')
    }
  }

  // Flow B: send 1 USDC, then call /api/agent-session?action=open&tx=...
  const handleSubscribe = async () => {
    if (!address) {
      showToast('Connect your wallet first', 'error')
      return
    }
    if (!(await ensureChain())) return
    setBusy('subscribing')
    try {
      const tx = await writeContractAsync({
        chainId: ACTIVE_CHAIN.id,
        address: ACTIVE_CHAIN.contracts.USDC as `0x${string}`,
        abi: USDC_TRANSFER_ABI,
        functionName: 'transfer',
        args: [paymentChallenge?.recipient as `0x${string}`, SESSION_PRICE_RAW],
      })
      showToast('Subscribing, waiting for tx...', 'success')
      const settled = await waitForReceipt(tx)
      if (!settled) {
        setBusy('idle')
        showToast('Tx not confirmed yet, retry once it lands', 'error')
        return
      }
      const r = await fetch(`/api/agent-session?action=open&tx=${tx}`)
      const j = await r.json()
      if (!r.ok) {
        showToast(`Session open failed: ${j.error ?? 'unknown'}`, 'error')
        setBusy('idle')
        return
      }
      const stored: StoredSession = {
        token: j.token,
        totalCredits: j.totalCredits,
        expiresAt: j.expiresAt,
        paymentTx: j.paymentTx,
        openedAt: Math.floor(Date.now() / 1000),
      }
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(stored))
      setSession(stored)
      setCreditsRemaining(j.totalCredits)
      showToast(`Session open: ${j.totalCredits} reads`, 'success')
    } catch (e) {
      showToast(`Subscribe failed: ${explainError(e)}`, 'error')
    } finally {
      setBusy('idle')
    }
  }

  // Read a decision using the active session (consumes one credit server-side).
  const handleSessionRead = async () => {
    if (!session || !decisionId) return
    setBusy('reading')
    try {
      const r = await fetch(`/api/agent-reasoning/${decisionId}`, { headers: { 'X-Session-Token': session.token } })
      if (r.ok) {
        const j = (await r.json()) as ReasoningPayload
        setUnlocked(j)
        if (typeof j.creditsRemaining === 'number') setCreditsRemaining(j.creditsRemaining)
        showToast(`Unlocked, ${j.creditsRemaining} reads left`, 'success')
      } else {
        const j = await r.json()
        showToast(`Read failed: ${j.error ?? 'unknown'}`, 'error')
        // If session expired or unknown server-side, clear it.
        if (r.status === 402 || r.status === 404) {
          localStorage.removeItem(SESSION_STORAGE_KEY)
          setSession(null)
          setCreditsRemaining(null)
        }
      }
    } catch (e) {
      showToast(`Read failed: ${explainError(e)}`, 'error')
    } finally {
      setBusy('idle')
    }
  }

  // Close the session and surface the refund manifest.
  const handleClose = async () => {
    if (!session) return
    setBusy('closing')
    try {
      const r = await fetch(`/api/agent-session?action=close&token=${encodeURIComponent(session.token)}`)
      const j = await r.json()
      if (!r.ok) {
        showToast(`Close failed: ${j.error ?? 'unknown'}`, 'error')
        return
      }
      localStorage.removeItem(SESSION_STORAGE_KEY)
      setSession(null)
      setCreditsRemaining(null)
      showToast(`Session closed, refund ${j.refundAmountHuman}`, 'success')
      console.log('[bow] refund manifest:', j.refundManifest)
    } catch (e) {
      showToast(`Close failed: ${explainError(e)}`, 'error')
    } finally {
      setBusy('idle')
    }
  }

  // Pre-emptive freshness check on the session via the status endpoint.
  useEffect(() => {
    if (!session) return
    fetch(`/api/agent-session?action=status&token=${encodeURIComponent(session.token)}`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(s => setCreditsRemaining(s.creditsRemaining))
      .catch(() => {
        // session unknown server-side (likely cold start), wipe.
        localStorage.removeItem(SESSION_STORAGE_KEY)
        setSession(null)
      })
  }, [session?.token])

  // Tiny polling helper. Wagmi's useWaitForTransactionReceipt is the React
  // way but we want a single awaitable from inside an event handler.
  async function waitForReceipt(tx: string, attempts = 30, intervalMs = 1500): Promise<boolean> {
    for (let i = 0; i < attempts; i++) {
      try {
        const r = await fetch(`${ACTIVE_CHAIN.publicRpc}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [tx] }),
        })
        const j = await r.json()
        if (j?.result?.status === '0x1') return true
        if (j?.result?.status === '0x0') return false
      } catch {
        /* keep polling */
      }
      await new Promise(res => setTimeout(res, intervalMs))
    }
    return false
  }

  const hasUsableSession = !!session && (creditsRemaining ?? session.totalCredits) > 0
  // Mark txHash referenced for the wagmi hook tracking (not directly used in render).
  void txHash; void isConfirming; void isConfirmed

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-medium">Agent reasoning (paid)</h2>
          <p className="text-[11px] text-[var(--fg-muted)] mt-0.5">
            Pay-per-read via x402, or subscribe for 200 reads. All payments in native USDC on {ACTIVE_CHAIN.name}.
          </p>
        </div>
        {hasUsableSession && (
          <div className="text-right">
            <div className="text-xs mono text-[var(--accent)]">{creditsRemaining ?? session?.totalCredits} reads left</div>
            <button onClick={handleClose} disabled={busy !== 'idle'} className="text-[10px] text-[var(--fg-dim)] hover:text-[var(--fg-muted)] underline mt-0.5">
              close + refund
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-[var(--fg-dim)]">Loading latest decision...</p>
      ) : !decisionId || !preview ? (
        <p className="text-sm text-[var(--fg-muted)]">No decision yet. Agent cron runs every 6h.</p>
      ) : (
        <>
          {/* Preview block, free */}
          <div className="mb-5">
            <div className="flex items-baseline gap-3 mb-2">
              <span className="text-2xl font-medium mono">#{preview.id}</span>
              <span className="text-xs text-[var(--fg-muted)]">{timeAgo(preview.timestamp)}</span>
              <span className="text-[10px] mono text-[var(--fg-dim)] ml-auto">free preview</span>
            </div>
            <div className="flex items-baseline gap-4 mb-3 text-sm mono">
              <span><span className="asset-usdc">USDC</span> {preview.usdcPct}%</span>
              <span><span className="asset-usyc">USYC</span> {preview.usycPct}%</span>
              <span><span className="asset-eurc">EURC</span> {preview.eurcPct}%</span>
              <span className="text-[var(--fg-muted)] text-xs ml-auto">conf {preview.confidence}%</span>
            </div>
            <p className="text-sm text-[var(--fg-muted)] leading-relaxed italic">
              &ldquo;{preview.reasoningPreview}&rdquo;
            </p>
            <p className="text-[10px] text-[var(--fg-dim)] mt-1">
              {preview.reasoningLength} chars total, the rest is gated.
            </p>
          </div>

          {/* Unlocked full text */}
          {unlocked && (
            <div className="mb-5 p-4 rounded-md border border-[var(--accent)]/40" style={{ background: 'var(--accent-soft)' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] uppercase tracking-wider text-[var(--accent)]">
                  Unlocked via {unlocked.paidVia === 'session' ? 'session' : 'x402 pay-per-read'}
                </span>
                <a
                  href={`${ACTIVE_CHAIN.explorer}/tx/${unlocked.paymentTx ?? unlocked.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] mono text-[var(--fg-muted)] hover:text-[var(--accent)] transition"
                >
                  {(unlocked.paymentTx ?? unlocked.txHash).slice(0, 10)}…
                </a>
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{unlocked.reasoning}</p>
              <p className="text-[10px] text-[var(--fg-dim)] mono mt-3">
                reasoningHash {unlocked.reasoningHash.slice(0, 18)}… · block {unlocked.blockNumber}
              </p>
            </div>
          )}

          {/* Action row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-3 border-t border-[var(--border)]">
            {hasUsableSession ? (
              <button
                onClick={handleSessionRead}
                disabled={busy !== 'idle'}
                className="btn-accent text-sm"
              >
                {busy === 'reading' ? 'Reading...' : `Read with session (1 credit)`}
              </button>
            ) : (
              <button
                onClick={handlePayPerRead}
                disabled={!isConnected || busy !== 'idle'}
                className="btn-accent text-sm"
                title={!isConnected ? 'Connect wallet to pay' : ''}
              >
                {busy === 'paying-read' ? 'Paying 0.005 USDC...' : 'Read for 0.005 USDC'}
              </button>
            )}
            <button
              onClick={handleSubscribe}
              disabled={!isConnected || busy !== 'idle' || hasUsableSession}
              className="btn-secondary text-sm"
              title={hasUsableSession ? 'You already have an active session' : ''}
            >
              {busy === 'subscribing'
                ? 'Subscribing...'
                : hasUsableSession
                ? 'Subscribed'
                : 'Subscribe (1 USDC = 200 reads)'}
            </button>
          </div>
          {!isConnected && (
            <p className="text-[10px] text-[var(--fg-dim)] mt-2">
              Connect a wallet to use either flow. USDC payments go to the operator wallet on chain {ACTIVE_CHAIN.id}.
            </p>
          )}
          <p className="text-[10px] text-[var(--fg-dim)] mt-3 leading-relaxed">
            Pay-per-read follows the HTTP 402 x402 pattern: client signs a USDC transfer, server verifies the receipt
            before serving the resource. Session keys cap a budget once and amortize 200 reads against it, refund the
            unused balance on close. Pattern: <span className="mono">open once, call many, close once</span>.
          </p>
        </>
      )}
    </div>
  )
}
