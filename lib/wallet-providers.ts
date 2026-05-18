'use client'

import { useEffect, useState } from 'react'

// EIP-6963 multi-wallet discovery.
// When multiple browser wallet extensions are installed (MetaMask,
// Pelagus, Backpack, Leap, Phantom, etc.) they all want to inject
// themselves into window.ethereum. The race produces "Cannot set
// property ethereum" errors and an unpredictable single winner.
// EIP-6963 standardised an alternative: each wallet dispatches an
// 'announceProvider' event on window, carrying its info + provider
// instance. We listen for those, build a list, and let the user pick.

export interface DetectedProvider {
  uuid: string
  name: string
  icon: string
  rdns: string
  provider: any
}

export function useDetectedProviders(): DetectedProvider[] {
  const [providers, setProviders] = useState<DetectedProvider[]>([])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const seen = new Map<string, DetectedProvider>()

    function onAnnounce(event: any) {
      const detail = event?.detail
      if (!detail?.info?.uuid || !detail?.provider) return
      const p: DetectedProvider = {
        uuid: detail.info.uuid,
        name: detail.info.name || 'Wallet',
        icon: detail.info.icon || '',
        rdns: detail.info.rdns || '',
        provider: detail.provider,
      }
      // Dedupe by rdns first (canonical wallet id), then uuid
      const key = p.rdns || p.uuid
      if (!seen.has(key)) {
        seen.set(key, p)
        setProviders(Array.from(seen.values()))
      }
    }

    window.addEventListener('eip6963:announceProvider', onAnnounce as EventListener)
    // Trigger fresh announcements from wallets that are already loaded
    window.dispatchEvent(new Event('eip6963:requestProvider'))

    // Refresh shortly after mount in case wallets injected late
    const t = setTimeout(() => {
      window.dispatchEvent(new Event('eip6963:requestProvider'))
    }, 500)

    return () => {
      clearTimeout(t)
      window.removeEventListener('eip6963:announceProvider', onAnnounce as EventListener)
    }
  }, [])

  return providers
}
