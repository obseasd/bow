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

const ASSET_LIST: { key: AssetKey; label: string; sub: string; yieldPct: number; cls: string; bgCls: string }[] = [
  { key: 'USDC', label: 'USDC', sub: 'Pure stable, gas of Arc', yieldPct: 0.00, cls: 'asset-usdc', bgCls: 'bg-asset-usdc' },
  { key: 'USYC', label: 'USYC', sub: 'T-bill yield, Circle native', yieldPct: 3.55, cls: 'asset-usyc', bgCls: 'bg-asset-usyc' },
  { key: 'EURC', label: 'EURC', sub: 'Euro FX exposure', yieldPct: 0.00, cls: 'asset-eurc', bgCls: 'bg-asset-eurc' },
]

const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'o', type: 'address' }, { name: 's', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 's', type: 'address' }, { name: 'v', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const

const VAULT_ABI = [
  { name: 'deposit', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'asset', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { name: 'requestWithdraw', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'shares', type: 'uint256' }], outputs: [] },
  { name: 'claimWithdraw', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { name: 'shareBalance', type: 'function', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'pendingWithdraws', type: 'function', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [
    { name: 'shares', type: 'uint256' },
    { name: 'requestedRoundId', type: 'uint256' },
    { name: 'requestedAt', type: 'uint64' },
    { name: 'claimed', type: 'bool' },
  ] },
] as const

const TOURNAMENT_ABI = [
  { name: 'totalRounds', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const

type Tab = 'deposit' | 'withdraw'

export default function VaultPanel() {
  const [info, setInfo] = useState<VaultInfo | null>(null)
  const [tab, setTab] = useState<Tab>('deposit')

  const vaultAddr = (ACTIVE_CHAIN.contracts as any).bowVault as `0x${string}` | ''
  const tournamentAddr = (ACTIVE_CHAIN.contracts as any).tournamentVault as `0x${string}` | ''
  const isVaultDeployed = !!vaultAddr && vaultAddr.length === 42

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

  return (
    <div className="grid md:grid-cols-[1fr_360px] gap-4">
      {/* Left: AI's current allocation */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--fg-muted)]">Current AI allocation</div>
            <div className="text-xs text-[var(--fg-dim)] mt-1">Updated whenever the agent rebalances</div>
          </div>
          {(() => {
            // Blended yield = weighted average of (allocation% * yield%) / 100
            const allocs = ASSET_LIST.map(a => {
              const key = a.key === 'USDC' ? 'usdc' : a.key === 'USYC' ? 'usyc' : 'eurc'
              return { yieldPct: a.yieldPct, pct: info?.allocation[key as 'usdc' | 'usyc' | 'eurc'] ?? (a.key === 'USDC' ? 50 : a.key === 'USYC' ? 30 : 20) }
            })
            const blended = allocs.reduce((s, a) => s + (a.pct * a.yieldPct) / 100, 0)
            return (
              <div className="text-right">
                <div className="text-2xl mono font-medium text-[var(--accent)]">{blended.toFixed(2)}%</div>
                <div className="text-[10px] uppercase tracking-wider text-[var(--fg-muted)] mt-0.5">Blended APY</div>
              </div>
            )
          })()}
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
                <span className={`mt-1 inline-block w-2 h-2 shrink-0 ${a.bgCls}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex items-baseline gap-1.5">
                      <span className={`font-medium ${a.cls}`}>{a.label}</span>
                      <span className="mono text-[var(--fg)]">{pct}%</span>
                    </div>
                    <span className="text-[10px] mono text-[var(--fg-muted)]">
                      {a.yieldPct > 0 ? `${a.yieldPct.toFixed(2)}% APY` : '0% APY'}
                    </span>
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

      {/* Right: deposit + withdraw tabs */}
      <div className="card p-6">
        {/* Tabs */}
        <div className="flex gap-1 mb-4 text-xs">
          {(['deposit', 'withdraw'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-1.5 uppercase tracking-wider transition ${
                tab === t
                  ? 'border border-[var(--accent)] text-[var(--accent)]'
                  : 'border border-[var(--border)] text-[var(--fg-muted)] hover:border-[var(--border-strong)]'
              }`}
              style={{ borderRadius: 2 }}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 'deposit' ? (
          <DepositForm vaultAddr={vaultAddr} isVaultDeployed={isVaultDeployed} />
        ) : (
          <WithdrawForm vaultAddr={vaultAddr} tournamentAddr={tournamentAddr} isVaultDeployed={isVaultDeployed} />
        )}
      </div>
    </div>
  )
}

// =============== Deposit form ===============

function DepositForm({ vaultAddr, isVaultDeployed }: { vaultAddr: string; isVaultDeployed: boolean }) {
  const [selectedAsset, setSelectedAsset] = useState<AssetKey>('USDC')
  const [amount, setAmount] = useState('')
  const [step, setStep] = useState<'idle' | 'approving' | 'depositing'>('idle')

  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()

  const assetMeta = ASSETS[selectedAsset]

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

  const balance = balanceRaw ? formatUnits(balanceRaw as bigint, assetMeta.decimals) : '0'
  const allowance = allowanceRaw ? (allowanceRaw as bigint) : BigInt(0)
  const parsedAmount = amount && Number(amount) > 0 ? parseUnits(amount, assetMeta.decimals) : BigInt(0)
  const needsApproval = parsedAmount > BigInt(0) && allowance < parsedAmount
  const canDeposit = parsedAmount > BigInt(0) && !needsApproval && isVaultDeployed

  async function ensureChain() {
    if (chainId !== ACTIVE_CHAIN.id) await switchChainAsync({ chainId: ACTIVE_CHAIN.id })
  }

  async function handleApprove() {
    if (!parsedAmount || !vaultAddr) return
    try {
      setStep('approving')
      await ensureChain()
      await writeContractAsync({
        address: assetMeta.address as Address,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [vaultAddr as Address, parsedAmount],
        chainId: ACTIVE_CHAIN.id,
      })
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
      await writeContractAsync({
        address: vaultAddr as Address,
        abi: VAULT_ABI,
        functionName: 'deposit',
        args: [assetMeta.address as Address, parsedAmount],
        chainId: ACTIVE_CHAIN.id,
      })
      setTimeout(() => { refetchBalance(); refetchAllowance(); setAmount(''); setStep('idle') }, 2000)
    } catch (err) {
      console.error('deposit failed', err)
      setStep('idle')
    }
  }

  return (
    <>
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

      {isConnected && (
        <div className="flex items-center justify-between text-[10px] text-[var(--fg-dim)] mb-2">
          <span>Balance</span>
          <button onClick={() => setAmount(balance)} className="mono hover:text-[var(--accent)] transition" title="Use max">
            {parseFloat(balance).toFixed(4)} {assetMeta.symbol}
          </button>
        </div>
      )}

      <input
        type="text"
        inputMode="decimal"
        placeholder="0.00"
        value={amount}
        onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
        className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] px-3 py-2 text-sm mono focus:outline-none focus:border-[var(--accent)] transition"
        style={{ borderRadius: 2 }}
      />

      <div className="mt-3">
        {!isConnected ? (
          <div className="text-[11px] text-[var(--fg-dim)] text-center py-2">Connect a wallet to deposit</div>
        ) : !isVaultDeployed ? (
          <button className="btn-secondary w-full text-sm" style={{ borderRadius: 2 }} disabled>Vault not deployed</button>
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
        Deposit any of USDC, USYC, EURC. You receive shares of the vault, and the AI
        starts managing your exposure across all three based on live yield + FX state.
      </div>
    </>
  )
}

// =============== Withdraw form (request + claim with cooldown) ===============

function WithdrawForm({ vaultAddr, tournamentAddr, isVaultDeployed }: { vaultAddr: string; tournamentAddr: string; isVaultDeployed: boolean }) {
  const [amount, setAmount] = useState('')
  const [step, setStep] = useState<'idle' | 'requesting' | 'claiming'>('idle')

  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()

  // Read user share balance
  const { data: sharesRaw, refetch: refetchShares } = useReadContract({
    address: vaultAddr as Address,
    abi: VAULT_ABI,
    functionName: 'shareBalance',
    args: address ? [address] : undefined,
    query: { enabled: !!address && isVaultDeployed, refetchInterval: 5000 },
  })

  // Read pending withdraw
  const { data: pendingRaw, refetch: refetchPending } = useReadContract({
    address: vaultAddr as Address,
    abi: VAULT_ABI,
    functionName: 'pendingWithdraws',
    args: address ? [address] : undefined,
    query: { enabled: !!address && isVaultDeployed, refetchInterval: 5000 },
  })

  // Read current round
  const { data: totalRoundsRaw } = useReadContract({
    address: tournamentAddr as Address,
    abi: TOURNAMENT_ABI,
    functionName: 'totalRounds',
    query: { enabled: isVaultDeployed, refetchInterval: 10000 },
  })

  const shares = sharesRaw ? (sharesRaw as bigint) : BigInt(0)
  const pending = pendingRaw as readonly [bigint, bigint, bigint, boolean] | undefined
  const pendingShares = pending ? pending[0] : BigInt(0)
  const requestedRoundId = pending ? Number(pending[1]) : 0
  const claimed = pending ? pending[3] : false
  const currentRound = totalRoundsRaw ? Number(totalRoundsRaw as bigint) : 0
  const hasPending = pendingShares > BigInt(0) && !claimed
  const canClaim = hasPending && currentRound > requestedRoundId

  const parsedAmount = amount && Number(amount) > 0 ? parseUnits(amount, 6) : BigInt(0)
  const canRequest = parsedAmount > BigInt(0) && parsedAmount <= shares && !hasPending

  async function ensureChain() {
    if (chainId !== ACTIVE_CHAIN.id) await switchChainAsync({ chainId: ACTIVE_CHAIN.id })
  }

  async function handleRequestWithdraw() {
    if (!parsedAmount) return
    try {
      setStep('requesting')
      await ensureChain()
      await writeContractAsync({
        address: vaultAddr as Address,
        abi: VAULT_ABI,
        functionName: 'requestWithdraw',
        args: [parsedAmount],
        chainId: ACTIVE_CHAIN.id,
      })
      setTimeout(() => { refetchShares(); refetchPending(); setAmount(''); setStep('idle') }, 2000)
    } catch (err) {
      console.error('requestWithdraw failed', err)
      setStep('idle')
    }
  }

  async function handleClaim() {
    try {
      setStep('claiming')
      await ensureChain()
      await writeContractAsync({
        address: vaultAddr as Address,
        abi: VAULT_ABI,
        functionName: 'claimWithdraw',
        chainId: ACTIVE_CHAIN.id,
      })
      setTimeout(() => { refetchShares(); refetchPending(); setStep('idle') }, 2000)
    } catch (err) {
      console.error('claimWithdraw failed', err)
      setStep('idle')
    }
  }

  if (!isConnected) {
    return <div className="text-[11px] text-[var(--fg-dim)] text-center py-6">Connect a wallet to withdraw</div>
  }

  if (!isVaultDeployed) {
    return <div className="text-[11px] text-[var(--fg-dim)] text-center py-6">Vault not deployed</div>
  }

  return (
    <>
      {/* Share balance */}
      <div className="flex items-center justify-between text-[10px] text-[var(--fg-dim)] mb-3">
        <span>Your shares</span>
        <span className="mono text-[var(--fg)]">{parseFloat(formatUnits(shares, 6)).toFixed(4)}</span>
      </div>

      {hasPending ? (
        /* Pending withdraw card */
        <div className="border border-[var(--accent)] p-3 mb-3" style={{ borderRadius: 2, background: 'var(--accent-soft)' }}>
          <div className="text-[10px] uppercase tracking-wider text-[var(--accent)] mb-1">Pending withdraw</div>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="mono text-lg text-[var(--fg)]">{parseFloat(formatUnits(pendingShares, 18)).toFixed(4)}</span>
            <span className="text-[10px] text-[var(--fg-muted)]">shares</span>
          </div>
          <div className="text-[10px] text-[var(--fg-muted)] leading-relaxed mb-3">
            Requested at round #{requestedRoundId}. Current round #{currentRound}.
            {canClaim
              ? ' Cooldown elapsed, ready to claim.'
              : ` Available at the start of the next round (#${requestedRoundId + 1}).`}
          </div>
          <button
            className="btn-accent w-full text-sm"
            style={{ borderRadius: 2 }}
            onClick={handleClaim}
            disabled={!canClaim || step !== 'idle'}
          >
            {step === 'claiming' ? 'Claiming...' : canClaim ? 'Claim' : 'Waiting for next round'}
          </button>
        </div>
      ) : (
        /* Request withdraw form */
        <>
          <div className="flex items-center justify-between text-[10px] text-[var(--fg-dim)] mb-2">
            <span>Shares to burn</span>
            <button onClick={() => setAmount(formatUnits(shares, 6))} className="mono hover:text-[var(--accent)] transition" title="Max">
              max
            </button>
          </div>
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] px-3 py-2 text-sm mono focus:outline-none focus:border-[var(--accent)] transition"
            style={{ borderRadius: 2 }}
          />
          <div className="mt-3">
            <button
              className="btn-accent w-full text-sm"
              style={{ borderRadius: 2 }}
              onClick={handleRequestWithdraw}
              disabled={!canRequest || step !== 'idle'}
            >
              {step === 'requesting' ? 'Requesting...' : 'Request withdraw'}
            </button>
          </div>
        </>
      )}

      <div className="text-[10px] text-[var(--fg-dim)] mt-4 leading-relaxed">
        Withdraw uses a single-round cooldown: shares burn now, locked to round #{currentRound || '?'}. You
        claim at the start of round #{currentRound ? currentRound + 1 : '?'}. This prevents
        flash-deposit sandwich on the AI&apos;s rebalance.
      </div>
    </>
  )
}
