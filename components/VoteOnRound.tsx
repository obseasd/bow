'use client'

import { useState } from 'react'
import { useAccount, useReadContract, useWriteContract, useSwitchChain, useChainId } from 'wagmi'
import type { Address } from 'viem'
import { ACTIVE_CHAIN } from '@/lib/chains'

const TOURNAMENT_ABI = [
  { name: 'voteHuman', type: 'function', stateMutability: 'nonpayable', inputs: [
    { name: 'roundId', type: 'uint256' },
    { name: 'usdcPct', type: 'uint8' },
    { name: 'usycPct', type: 'uint8' },
    { name: 'eurcPct', type: 'uint8' },
  ], outputs: [] },
  { name: 'votes', type: 'function', stateMutability: 'view', inputs: [
    { name: 'roundId', type: 'uint256' },
    { name: 'voter', type: 'address' },
  ], outputs: [
    { name: 'usdcPct', type: 'uint8' },
    { name: 'usycPct', type: 'uint8' },
    { name: 'eurcPct', type: 'uint8' },
    { name: 'timestamp', type: 'uint64' },
  ] },
] as const

interface Preset { label: string; usdc: number; usyc: number; eurc: number }

const PRESETS: Preset[] = [
  { label: 'Balanced 33/33/33', usdc: 34, usyc: 33, eurc: 33 },
  { label: 'Yield max', usdc: 10, usyc: 80, eurc: 10 },
  { label: 'Risk-off', usdc: 80, usyc: 10, eurc: 10 },
  { label: 'FX bet', usdc: 20, usyc: 30, eurc: 50 },
]

export default function VoteOnRound({ roundId, aiUsdcPct, aiUsycPct, aiEurcPct, onClose }: {
  roundId: number
  aiUsdcPct: number
  aiUsycPct: number
  aiEurcPct: number
  onClose?: () => void
}) {
  const [usdcPct, setUsdcPct] = useState(34)
  const [usycPct, setUsycPct] = useState(33)
  const [eurcPct, setEurcPct] = useState(33)
  const [step, setStep] = useState<'idle' | 'voting'>('idle')

  const tournamentAddr = (ACTIVE_CHAIN.contracts as any).tournamentVault as `0x${string}`
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()

  // Has user already voted on this round?
  const { data: existingVote, refetch: refetchVote } = useReadContract({
    address: tournamentAddr,
    abi: TOURNAMENT_ABI,
    functionName: 'votes',
    args: address ? [BigInt(roundId), address] : undefined,
    query: { enabled: !!address, refetchInterval: 5000 },
  })

  const alreadyVoted = existingVote && Number((existingVote as readonly [number, number, number, bigint])[3]) > 0
  const sum = usdcPct + usycPct + eurcPct
  const sumValid = sum === 100

  function applyPreset(p: Preset) {
    setUsdcPct(p.usdc); setUsycPct(p.usyc); setEurcPct(p.eurc)
  }

  async function ensureChain() {
    if (chainId !== ACTIVE_CHAIN.id) await switchChainAsync({ chainId: ACTIVE_CHAIN.id })
  }

  async function handleVote() {
    if (!sumValid || !isConnected) return
    try {
      setStep('voting')
      await ensureChain()
      await writeContractAsync({
        address: tournamentAddr,
        abi: TOURNAMENT_ABI,
        functionName: 'voteHuman',
        args: [BigInt(roundId), usdcPct, usycPct, eurcPct],
        chainId: ACTIVE_CHAIN.id,
      })
      setTimeout(() => { refetchVote(); setStep('idle'); onClose?.() }, 2000)
    } catch (err) {
      console.error('vote failed', err)
      setStep('idle')
    }
  }

  if (alreadyVoted) {
    const v = existingVote as readonly [number, number, number, bigint]
    return (
      <div className="card p-4 mt-3" style={{ background: 'var(--accent-soft)', borderColor: 'var(--accent)' }}>
        <div className="text-[10px] uppercase tracking-wider text-[var(--accent)] mb-2">Your vote on round #{roundId}</div>
        <div className="flex items-center gap-3 text-xs mono">
          <span className="asset-usdc">USDC {Number(v[0])}%</span>
          <span className="text-[var(--fg-dim)]">·</span>
          <span className="asset-usyc">USYC {Number(v[1])}%</span>
          <span className="text-[var(--fg-dim)]">·</span>
          <span className="asset-eurc">EURC {Number(v[2])}%</span>
        </div>
        <div className="text-[10px] text-[var(--fg-dim)] mt-2">
          AI bet {aiUsdcPct}/{aiUsycPct}/{aiEurcPct}. Outcome settles when the round ends.
        </div>
      </div>
    )
  }

  return (
    <div className="card p-4 mt-3" style={{ background: 'var(--bg-elevated)' }}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--accent)]">Vote on round #{roundId}</div>
          <div className="text-[10px] text-[var(--fg-dim)] mt-1">AI bet {aiUsdcPct}/{aiUsycPct}/{aiEurcPct}. Pick your own split.</div>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-[var(--fg-dim)] hover:text-[var(--fg)] text-lg leading-none" title="Close">
            ×
          </button>
        )}
      </div>

      {/* Presets */}
      <div className="flex flex-wrap gap-1 mb-3 text-[10px]">
        {PRESETS.map(p => (
          <button
            key={p.label}
            onClick={() => applyPreset(p)}
            className="px-2 py-1 border border-[var(--border)] text-[var(--fg-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition mono"
            style={{ borderRadius: 2 }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* 3 sliders */}
      <SliderRow label="USDC" cls="asset-usdc" value={usdcPct} onChange={setUsdcPct} />
      <SliderRow label="USYC" cls="asset-usyc" value={usycPct} onChange={setUsycPct} />
      <SliderRow label="EURC" cls="asset-eurc" value={eurcPct} onChange={setEurcPct} />

      {/* Sum + warning */}
      <div className="flex items-center justify-between text-[10px] mt-2 mb-3">
        <span className="text-[var(--fg-muted)]">Sum</span>
        <span className={`mono ${sumValid ? 'text-[var(--accent)]' : 'text-[var(--negative)]'}`}>
          {sum}% {sumValid ? '✓' : '(must equal 100)'}
        </span>
      </div>

      {/* Submit */}
      <button
        className="btn-accent w-full text-sm"
        style={{ borderRadius: 2 }}
        onClick={handleVote}
        disabled={!isConnected || !sumValid || step !== 'idle'}
      >
        {!isConnected ? 'Connect wallet' : step === 'voting' ? 'Voting...' : 'Vote against AI'}
      </button>

      <div className="text-[10px] text-[var(--fg-dim)] mt-3 leading-relaxed">
        Settles in 24h based on actual asset moves. If your split beats the AI&apos;s,
        the round records HUMAN_WINS and your reputation goes up. No stake required on this MVP.
      </div>
    </div>
  )
}

function SliderRow({ label, cls, value, onChange }: { label: string; cls: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="mb-2">
      <div className="flex items-center justify-between text-[10px] mb-1">
        <span className={`font-medium ${cls}`}>{label}</span>
        <span className="mono text-[var(--fg)]">{value}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--accent)]"
      />
    </div>
  )
}
