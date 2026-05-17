'use client'

import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { useState, useEffect } from 'react'

export default function WalletButton() {
  const { address, isConnected } = useAccount()
  const { connect, connectors } = useConnect()
  const { disconnect } = useDisconnect()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!mounted) {
    return (
      <button className="btn-secondary text-xs px-3 py-1.5" style={{ borderRadius: 2 }} disabled>
        Connect
      </button>
    )
  }

  if (!isConnected) {
    return (
      <button
        className="btn-accent text-xs px-3 py-1.5"
        style={{ borderRadius: 2 }}
        onClick={() => connect({ connector: connectors[0] || injected() })}
      >
        Connect wallet
      </button>
    )
  }
  const short = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : ''
  return (
    <button
      className="btn-secondary text-xs px-3 py-1.5 mono"
      style={{ borderRadius: 2 }}
      onClick={() => disconnect()}
      title="Disconnect"
    >
      {short}
    </button>
  )
}
