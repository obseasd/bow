'use client'

import { useAccount, useDisconnect } from 'wagmi'
import { useEffect, useState } from 'react'
import WalletPicker from './WalletPicker'

export default function WalletButton() {
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const [mounted, setMounted] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

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
      <>
        <button
          className="btn-accent text-xs px-3 py-1.5"
          style={{ borderRadius: 2 }}
          onClick={() => setPickerOpen(true)}
        >
          Connect wallet
        </button>
        <WalletPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
      </>
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
