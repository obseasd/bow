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

function getProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(ACTIVE_CHAIN.rpc)
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
