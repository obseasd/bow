'use client'

import { useState } from 'react'
import { useAccount, useChainId, useSwitchChain } from 'wagmi'
import { ACTIVE_CHAIN } from '@/lib/chains'

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
    }
  }
}

export default function ChainSwitchBanner() {
  const { isConnected } = useAccount()
  const chainId = useChainId()
  const { switchChainAsync } = useSwitchChain()
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<string | null>(null)

  if (!isConnected || chainId === ACTIVE_CHAIN.id) return null

  async function handleSwitch() {
    setBusy(true)
    setStep('Switching...')
    try {
      // First try: standard wagmi switch
      await switchChainAsync({ chainId: ACTIVE_CHAIN.id })
      setStep(null)
    } catch (err) {
      console.warn('switchChain failed, trying wallet_addEthereumChain', err)
      // Fallback: ask the wallet to add the chain explicitly. Most wallets
      // will follow up by selecting the newly added chain automatically.
      try {
        if (typeof window === 'undefined' || !window.ethereum) {
          throw new Error('No injected wallet')
        }
        setStep('Adding Arc Testnet to your wallet...')
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: `0x${ACTIVE_CHAIN.id.toString(16)}`,
            chainName: ACTIVE_CHAIN.name,
            nativeCurrency: ACTIVE_CHAIN.nativeCurrency,
            rpcUrls: [ACTIVE_CHAIN.publicRpc],
            blockExplorerUrls: [ACTIVE_CHAIN.explorer],
          }],
        })
        setStep(null)
      } catch (addErr) {
        console.error('wallet_addEthereumChain failed', addErr)
        setStep('Add manually (see below)')
      }
    } finally {
      setBusy(false)
    }
  }

  const targetHex = `0x${ACTIVE_CHAIN.id.toString(16)}`

  return (
    <div
      className="card p-4 mb-4"
      style={{ borderColor: '#ff5577', background: 'rgba(255, 85, 119, 0.06)', borderRadius: 2 }}
    >
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-[#ff5577]">Wrong chain detected</div>
          <div className="text-[11px] text-[var(--fg-muted)] mt-1 leading-relaxed">
            Your wallet is on chain {chainId}. Bow runs on{' '}
            <span className="mono text-[var(--fg)]">{ACTIVE_CHAIN.name}</span> (chainId{' '}
            <span className="mono text-[var(--fg)]">{ACTIVE_CHAIN.id}</span>). Transactions will revert until you switch.
          </div>
        </div>
        <button
          onClick={handleSwitch}
          disabled={busy}
          className="btn-accent text-xs px-4 py-2 shrink-0"
          style={{ borderRadius: 2 }}
        >
          {step ?? 'Switch to Arc Testnet'}
        </button>
      </div>

      <details className="mt-3">
        <summary className="text-[10px] text-[var(--fg-dim)] cursor-pointer hover:text-[var(--fg-muted)]">
          Manual add instructions
        </summary>
        <div className="text-[10px] mono text-[var(--fg-muted)] mt-2 space-y-1 leading-relaxed">
          <div>Chain ID:           {ACTIVE_CHAIN.id} ({targetHex})</div>
          <div>Network name:       {ACTIVE_CHAIN.name}</div>
          <div>RPC URL:            {ACTIVE_CHAIN.publicRpc}</div>
          <div>Currency symbol:    {ACTIVE_CHAIN.nativeCurrency.symbol}</div>
          <div>Decimals:           {ACTIVE_CHAIN.nativeCurrency.decimals}</div>
          <div>Block explorer:     {ACTIVE_CHAIN.explorer}</div>
          <div className="text-[var(--fg-dim)] pt-1">
            If your wallet has a stale &quot;Arc Network Testnet&quot; entry at the wrong chainId,
            delete it first then click Switch above.
          </div>
        </div>
      </details>
    </div>
  )
}
