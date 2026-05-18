'use client'

import { useEffect, useState } from 'react'
import { useConnect } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { useDetectedProviders, type DetectedProvider } from '@/lib/wallet-providers'

export default function WalletPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const providers = useDetectedProviders()
  const { connect, isPending } = useConnect()
  const [pickingUuid, setPickingUuid] = useState<string | null>(null)

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  async function pick(p: DetectedProvider) {
    try {
      setPickingUuid(p.uuid)
      const connector = injected({
        target: () => ({
          id: p.rdns || p.uuid,
          name: p.name,
          provider: p.provider,
        }),
      })
      connect({ connector }, {
        onSuccess: () => { setPickingUuid(null); onClose() },
        onError: (err) => {
          console.error('connect failed', err)
          setPickingUuid(null)
        },
      })
    } catch (err) {
      console.error('pick failed', err)
      setPickingUuid(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[500] modal-backdrop overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="card flex flex-col fade-in"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'var(--bg-card)',
          width: 'min(380px, calc(100vw - 32px))',
          maxHeight: 'min(80vh, 560px)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header — fixed */}
        <div className="flex items-start justify-between px-4 py-3 border-b border-[var(--border)] shrink-0">
          <div>
            <div className="text-sm font-medium text-[var(--fg)]">Connect a wallet</div>
            <div className="text-[10px] text-[var(--fg-dim)] mt-0.5">
              {providers.length} wallet{providers.length === 1 ? '' : 's'} detected
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--fg-dim)] hover:text-[var(--fg)] text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Wallet list — scrollable */}
        <div className="p-2 space-y-1 overflow-y-auto flex-1 min-h-0">
          {providers.length === 0 ? (
            <div className="text-xs text-[var(--fg-muted)] p-4 text-center leading-relaxed">
              No wallet detected. Install a browser wallet like MetaMask, Backpack, or Phantom and refresh this page.
            </div>
          ) : providers.map(p => {
            const isPicking = pickingUuid === p.uuid
            return (
              <button
                key={p.uuid}
                onClick={() => pick(p)}
                disabled={isPending || isPicking}
                className="w-full flex items-center gap-2.5 px-3 py-2 border border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] transition text-left disabled:opacity-60 disabled:cursor-not-allowed"
                style={{ borderRadius: 2 }}
              >
                {p.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.icon} alt={p.name} className="w-6 h-6 rounded-sm shrink-0" />
                ) : (
                  <div className="w-6 h-6 rounded-sm bg-[var(--bg-elevated)] shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-[var(--fg)] truncate">{p.name}</div>
                  {p.rdns && <div className="text-[9px] text-[var(--fg-dim)] mono truncate">{p.rdns}</div>}
                </div>
                {isPicking && (
                  <div className="text-[9px] mono text-[var(--accent)] shrink-0">connecting…</div>
                )}
              </button>
            )
          })}
        </div>

        {/* Footer — fixed */}
        <div className="px-4 py-2 border-t border-[var(--border)] text-[10px] text-[var(--fg-dim)] leading-snug shrink-0">
          Bow runs on Arc testnet (chain 5042002). Your wallet will switch chains after connect.
        </div>
      </div>
    </div>
  )
}
