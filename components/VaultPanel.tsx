'use client'

import { useEffect, useState } from 'react'
import { useAccount, useReadContract, useWriteContract, useSwitchChain, useChainId } from 'wagmi'
import { parseUnits, formatUnits, type Address } from 'viem'
import { ACTIVE_CHAIN, ASSETS, type AssetKey } from '@/lib/chains'

interface VaultInfo {
  allocation: { usdc: number; usyc: number; eurc: number }
  balances: { usdc: string; usyc: string; eurc: string }
  totalAssetsUsd: string
  deployed: boolean
}

const ASSET_LIST: { key: AssetKey; label: string; sub: string; cls: string; bgCls: string }[] = [
  { key: 'USDC', label: 'USDC', sub: 'Pure stable, gas of Arc', cls: 'asset-usdc', bgCls: 'bg-asset-usdc' },
  { key: 'USYC', label: 'USYC', sub: 'T-bill yield (~3.55%)', cls: 'asset-usyc', bgCls: 'bg-asset-usyc' },
  { key: 'EURC', label: 'EURC', sub: 'Euro FX exposure', cls: 'asset-eurc', bgCls: 'bg-asset-eurc' },
]

const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'o', type: 'address' }, { name: 's', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 's', type: 'address' }, { name: 'v', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const

const VAULT_ABI = [
  { name: 'deposit', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'asset', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
] as const

export default function VaultPanel() {
  const [info, setInfo] = useState<VaultInfo | null>(null)
  const [selectedAsset, setSelectedAsset] = useState<AssetKey>('USDC')
  const [amount, setAmount] = useState('')
  const [step, setStep] = useState<'idle' | 'approving' | 'depositing'>('idle')

  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()

  const assetMeta = ASSETS[selectedAsset]
  const vaultAddr = (ACTIVE_CHAIN.contracts as any).bowVault as `0x${string}` | ''
  const isVaultDeployed = !!vaultAddr && vaultAddr.length === 42

  // Live read user's balance + allowance for the selected asset
  const { data: balanceRaw, refetch: refetchBalance } = useReadContract({
    address: assetMeta.address as Address,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 5000 },
  })

  const { data: allowanceRaw, refetch: refetchAllowance } = useReadContract({
    address: assetMeta.address as Address,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address && vaultAddr ? [address, vaultAddr as Address] : undefined,
    query: { enabled: !!address && isVaultDeployed, refetchInterval: 3000 },
  })

  useEffect(() => {
    fetch('/api/onchain')
      .then((r) => r.json())
      .then((d) => {
        if (d.error) return
        setInfo({
          allocation: d.allocation,
          balances: d.balances,
          totalAssetsUsd: d.totalAssetsUsd,
          deployed: !!d.deployed,
        })
      })
      .catch(() => {})
  }, [])

  const balance = balanceRaw ? formatUnits(balanceRaw as bigint, assetMeta.decimals) : '0'
  const allowance = allowanceRaw ? (allowanceRaw as bigint) : BigInt(0)
  const parsedAmount = amount && Number(amount) > 0 ? parseUnits(amount, assetMeta.decimals) : BigInt(0)
  const needsApproval = parsedAmount > BigInt(0) && allowance < parsedAmount
  const canDeposit = parsedAmount > BigInt(0) && !needsApproval && isVaultDeployed

  async function ensureChain() {
    if (chainId !== ACTIVE_CHAIN.id) {
      await switchChainAsync({ chainId: ACTIVE_CHAIN.id })
    }
  }

  async function handleApprove() {
    if (!parsedAmount || !vaultAddr) return
    try {
      setStep('approving')
      await ensureChain()
      const tx = await writeContractAsync({
        address: assetMeta.address as Address,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [vaultAddr as Address, parsedAmount],
        chainId: ACTIVE_CHAIN.id,
      })
      console.log('approve tx', tx)
      // Wait a beat for allowance to refresh
      setTimeout(() => { refetchAllowance(); setStep('idle') }, 1500)
    } catch (err) {
      console.error('approve failed', err)
      setStep('idle')
    }
  }

  async function handleDeposit() {
    if (!parsedAmount || !vaultAddr) return
    try {
      setStep('depositing')
      await ensureChain()
      const tx = await writeContractAsync({
        address: vaultAddr as Address,
        abi: VAULT_ABI,
        functionName: 'deposit',
        args: [assetMeta.address as Address, parsedAmount],
        chainId: ACTIVE_CHAIN.id,
      })
      console.log('deposit tx', tx)
      setTimeout(() => {
        refetchBalance()
        refetchAllowance()
        setAmount('')
        setStep('idle')
      }, 2000)
    } catch (err) {
      console.error('deposit failed', err)
      setStep('idle')
    }
  }

  return (
    <div className="grid md:grid-cols-[1fr_360px] gap-4">
      {/* Left: AI's current allocation */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--fg-muted)]">Current AI allocation</div>
            <div className="text-xs text-[var(--fg-dim)] mt-1">Updated whenever the agent rebalances</div>
          </div>
          <span className="text-[10px] mono text-[var(--accent)] px-2 py-0.5 border border-[var(--accent)]" style={{ borderRadius: 2 }}>
            LIVE
          </span>
        </div>

        <div className="flex h-3 w-full overflow-hidden mb-5" style={{ borderRadius: 2 }}>
          {ASSET_LIST.map((a) => {
            const key = a.key === 'USDC' ? 'usdc' : a.key === 'USYC' ? 'usyc' : 'eurc'
            const pct = info?.allocation[key as 'usdc' | 'usyc' | 'eurc'] ?? 33
            return <div key={a.key} className={a.bgCls} style={{ width: `${pct}%` }} title={`${a.label} ${pct}%`} />
          })}
        </div>

        <div className="grid grid-cols-3 gap-3 text-xs">
          {ASSET_LIST.map((a) => {
            const key = a.key === 'USDC' ? 'usdc' : a.key === 'USYC' ? 'usyc' : 'eurc'
            const pct = info?.allocation[key as 'usdc' | 'usyc' | 'eurc'] ?? 0
            return (
              <div key={a.key} className="flex items-start gap-2">
                <span className={`mt-1 inline-block w-2 h-2 ${a.bgCls}`} />
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className={`font-medium ${a.cls}`}>{a.label}</span>
                    <span className="mono text-[var(--fg)]">{pct}%</span>
                  </div>
                  <div className="text-[10px] text-[var(--fg-dim)] mt-0.5">{a.sub}</div>
                </div>
              </div>
            )
          })}
        </div>

        {info && !info.deployed && (
          <div className="mt-5 p-3 text-[11px] text-[var(--accent)] border border-[var(--accent)]" style={{ borderRadius: 2, background: 'var(--accent-soft)' }}>
            Vault not yet deployed. Default 50/30/20 shown.
          </div>
        )}
      </div>

      {/* Right: deposit panel */}
      <div className="card p-6">
        <div className="text-[10px] uppercase tracking-wider text-[var(--fg-muted)] mb-3">Deposit</div>

        {/* Asset selector */}
        <div className="flex gap-1 mb-3 text-xs">
          {ASSET_LIST.map(a => (
            <button
              key={a.key}
              onClick={() => setSelectedAsset(a.key)}
              className={`flex-1 py-1.5 transition mono ${
                selectedAsset === a.key
                  ? 'border border-[var(--accent)] text-[var(--accent)]'
                  : 'border border-[var(--border)] text-[var(--fg-muted)] hover:border-[var(--border-strong)]'
              }`}
              style={{ borderRadius: 2 }}
            >
              {a.label}
            </button>
          ))}
        </div>

        {/* Balance row */}
        {isConnected && (
          <div className="flex items-center justify-between text-[10px] text-[var(--fg-dim)] mb-2">
            <span>Balance</span>
            <button
              onClick={() => setAmount(balance)}
              className="mono hover:text-[var(--accent)] transition"
              title="Use max"
            >
              {parseFloat(balance).toFixed(4)} {assetMeta.symbol}
            </button>
          </div>
        )}

        {/* Amount input */}
        <input
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
          className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] px-3 py-2 text-sm mono focus:outline-none focus:border-[var(--accent)] transition"
          style={{ borderRadius: 2 }}
        />

        {/* Action button */}
        <div className="mt-3">
          {!isConnected ? (
            <div className="text-[11px] text-[var(--fg-dim)] text-center py-2">
              Connect a wallet to deposit
            </div>
          ) : !isVaultDeployed ? (
            <button className="btn-secondary w-full text-sm" style={{ borderRadius: 2 }} disabled>
              Vault not deployed
            </button>
          ) : needsApproval ? (
            <button
              className="btn-accent w-full text-sm"
              style={{ borderRadius: 2 }}
              onClick={handleApprove}
              disabled={step !== 'idle' || parsedAmount === BigInt(0)}
            >
              {step === 'approving' ? 'Approving...' : `Approve ${assetMeta.symbol}`}
            </button>
          ) : (
            <button
              className="btn-accent w-full text-sm"
              style={{ borderRadius: 2 }}
              onClick={handleDeposit}
              disabled={!canDeposit || step !== 'idle'}
            >
              {step === 'depositing' ? 'Depositing...' : 'Deposit'}
            </button>
          )}
        </div>

        <div className="text-[10px] text-[var(--fg-dim)] mt-4 leading-relaxed">
          Withdraw uses a single-round cooldown: when you request a withdraw,
          your shares are burned into a pending claim locked to the current
          round. You can claim at the start of the next round. This prevents
          flash-deposit sandwich on the AI&apos;s rebalance.
        </div>
      </div>
    </div>
  )
}
