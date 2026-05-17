/// Bow on-chain reads. Mirrors the lib/contract.ts pattern from Mensa
/// but for a 3-asset vault on Arc.

import { ethers } from 'ethers'
import { ACTIVE_CHAIN } from './chains'

const VAULT_ABI = [
  'function targetUsdcPct() view returns (uint8)',
  'function targetUsycPct() view returns (uint8)',
  'function targetEurcPct() view returns (uint8)',
  'function totalShares() view returns (uint256)',
  'function shareBalance(address) view returns (uint256)',
  'function totalAssetsUsd() view returns (uint256)',
  'function getAllocation() view returns (uint8 u, uint8 y, uint8 e)',
  'function getBalances() view returns (uint256 usdcBal, uint256 usycBal, uint256 eurcBal)',
  'function lastRebalanceAt() view returns (uint256)',
  'function minRebalanceBps() view returns (uint256)',
  'function minTimeBetweenRebalances() view returns (uint256)',
  'function pendingWithdraws(address) view returns (uint256 shares, uint256 requestedRoundId, uint64 requestedAt, bool claimed)',
] as const

const DECISION_LOG_ABI = [
  'function totalDecisions() view returns (uint256)',
  'function decisions(uint256) view returns (uint8 usdcPct, uint8 usycPct, uint8 eurcPct, uint8 confidence, bytes32 reasoningHash, uint64 timestamp)',
  'event DecisionLogged(uint256 indexed id, address indexed agent, uint8 usdcPct, uint8 usycPct, uint8 eurcPct, uint8 confidence, bytes32 reasoningHash, string reasoning, uint64 timestamp)',
] as const

const TOURNAMENT_ABI = [
  'function totalRounds() view returns (uint256)',
  'function aiWins() view returns (uint256)',
  'function humanWins() view returns (uint256)',
  'function aiWinRateBps() view returns (uint256)',
  'function rounds(uint256) view returns (uint256 id, uint64 startTime, uint64 settlementTime, uint256 startUsdcPrice, uint256 startUsycPrice, uint256 startEurcPrice, uint256 settleUsdcPrice, uint256 settleUsycPrice, uint256 settleEurcPrice, uint8 aiUsdcPct, uint8 aiUsycPct, uint8 aiEurcPct, uint8 humanUsdcPct, uint8 humanUsycPct, uint8 humanEurcPct, int256 aiReturnBps, int256 humanReturnBps, uint8 outcome, bool settled)',
] as const

export interface VaultState {
  allocation: { usdc: number; usyc: number; eurc: number }
  balances: { usdc: string; usyc: string; eurc: string }
  totalSharesStr: string
  totalAssetsUsd: string
  lastRebalanceAt: number
  minRebalanceBps: number
  minTimeBetweenRebalances: number
}

export interface OnChainStats {
  totalDecisions: number
  totalRounds: number
  aiWins: number
  humanWins: number
  aiWinRatePct: number
  vault: VaultState
}

export interface LatestDecisionData {
  id: number
  usdcPct: number
  usycPct: number
  eurcPct: number
  confidence: number
  reasoning: string
  txHash: string
  timestamp: number
}

export interface RoundData {
  id: number
  aiUsdcPct: number
  aiUsycPct: number
  aiEurcPct: number
  humanUsdcPct: number
  humanUsycPct: number
  humanEurcPct: number
  startTime: number
  settlementTime: number
  aiReturnBps: number
  humanReturnBps: number
  outcome: number
  settled: boolean
}

function getProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(ACTIVE_CHAIN.rpc)
}

export async function getLatestDecision(): Promise<LatestDecisionData | null> {
  const logAddr = (ACTIVE_CHAIN.contracts as any).decisionLog
  if (!logAddr) return null
  const provider = getProvider()
  const log = new ethers.Contract(logAddr, DECISION_LOG_ABI, provider)
  try {
    const total = Number(await log.totalDecisions())
    if (total === 0) return null
    const id = total
    // Read the structured fields from storage
    const d = await log.decisions(id)
    // Pull the matching event to recover the reasoning text. The Canteen
    // RPC accepts up to ~50,000 blocks per eth_getLogs call (vs ~10K on
    // the public Arc RPC), so we go wider here for a longer rewind window.
    const filter = log.filters.DecisionLogged(id)
    let reasoning = '(reasoning not in event window)'
    let txHash = ''
    try {
      const events = await log.queryFilter(filter, -50000, 'latest')
      if (events.length > 0) {
        const e: any = events[events.length - 1]
        reasoning = e.args?.reasoning || reasoning
        txHash = e.transactionHash
      }
    } catch {
      // Window too large or RPC blip, leave default
    }
    return {
      id,
      usdcPct: Number(d.usdcPct ?? d[0]),
      usycPct: Number(d.usycPct ?? d[1]),
      eurcPct: Number(d.eurcPct ?? d[2]),
      confidence: Number(d.confidence ?? d[3]),
      reasoning,
      txHash,
      timestamp: Number(d.timestamp ?? d[5]),
    }
  } catch (e) {
    console.error('[bow contract] getLatestDecision failed:', (e as Error).message)
    return null
  }
}

export async function getRecentRounds(limit = 8): Promise<RoundData[]> {
  const tourAddr = (ACTIVE_CHAIN.contracts as any).tournamentVault
  if (!tourAddr) return []
  const provider = getProvider()
  const tournament = new ethers.Contract(tourAddr, TOURNAMENT_ABI, provider)
  try {
    const total = Number(await tournament.totalRounds())
    if (total === 0) return []
    const ids: number[] = []
    for (let i = total; i > 0 && ids.length < limit; i--) ids.push(i)
    const rows = await Promise.all(ids.map(id => tournament.rounds(id)))
    return rows.map((r: any, idx: number) => ({
      id: ids[idx],
      startTime: Number(r.startTime ?? r[1]),
      settlementTime: Number(r.settlementTime ?? r[2]),
      aiUsdcPct: Number(r.aiUsdcPct ?? r[9]),
      aiUsycPct: Number(r.aiUsycPct ?? r[10]),
      aiEurcPct: Number(r.aiEurcPct ?? r[11]),
      humanUsdcPct: Number(r.humanUsdcPct ?? r[12]),
      humanUsycPct: Number(r.humanUsycPct ?? r[13]),
      humanEurcPct: Number(r.humanEurcPct ?? r[14]),
      aiReturnBps: Number(r.aiReturnBps ?? r[15]),
      humanReturnBps: Number(r.humanReturnBps ?? r[16]),
      outcome: Number(r.outcome ?? r[17]),
      settled: Boolean(r.settled ?? r[18]),
    }))
  } catch (e) {
    console.error('[bow contract] getRecentRounds failed:', (e as Error).message)
    return []
  }
}

function bowVaultOrEmpty(): string {
  return (ACTIVE_CHAIN.contracts as any).bowVault || ''
}

export async function getStats(): Promise<OnChainStats | null> {
  const vaultAddr = bowVaultOrEmpty()
  if (!vaultAddr) return null

  const provider = getProvider()
  const vault = new ethers.Contract(vaultAddr, VAULT_ABI, provider)
  const log = new ethers.Contract((ACTIVE_CHAIN.contracts as any).decisionLog || ethers.ZeroAddress, DECISION_LOG_ABI, provider)
  const tournament = new ethers.Contract((ACTIVE_CHAIN.contracts as any).tournamentVault || ethers.ZeroAddress, TOURNAMENT_ABI, provider)

  try {
    const [alloc, balances, totalShares, totalAssets, lastRebalanceAt, minRebalanceBps, minTime, totalDecisions, totalRounds, aiWins, humanWins] = await Promise.all([
      vault.getAllocation(),
      vault.getBalances(),
      vault.totalShares(),
      vault.totalAssetsUsd(),
      vault.lastRebalanceAt(),
      vault.minRebalanceBps(),
      vault.minTimeBetweenRebalances(),
      log.totalDecisions().catch(() => BigInt(0)),
      tournament.totalRounds().catch(() => BigInt(0)),
      tournament.aiWins().catch(() => BigInt(0)),
      tournament.humanWins().catch(() => BigInt(0)),
    ])

    const aiW = Number(aiWins)
    const hW = Number(humanWins)
    const settled = aiW + hW
    const aiWinRatePct = settled > 0 ? (aiW / settled) * 100 : 0

    return {
      totalDecisions: Number(totalDecisions),
      totalRounds: Number(totalRounds),
      aiWins: aiW,
      humanWins: hW,
      aiWinRatePct,
      vault: {
        allocation: { usdc: Number(alloc[0]), usyc: Number(alloc[1]), eurc: Number(alloc[2]) },
        balances: {
          usdc: balances[0].toString(),
          usyc: balances[1].toString(),
          eurc: balances[2].toString(),
        },
        totalSharesStr: totalShares.toString(),
        totalAssetsUsd: totalAssets.toString(),
        lastRebalanceAt: Number(lastRebalanceAt),
        minRebalanceBps: Number(minRebalanceBps),
        minTimeBetweenRebalances: Number(minTime),
      },
    }
  } catch (e) {
    console.error('[bow contract] getStats failed:', (e as Error).message)
    return null
  }
}
