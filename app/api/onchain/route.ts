import { NextResponse } from 'next/server'
import { getStats } from '@/lib/contract'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  try {
    const s = await getStats()
    if (!s) {
      // Vault not deployed yet, return a friendly empty shape so the UI
      // doesn't 500 during the bootstrap phase.
      return NextResponse.json({
        totalRounds: 0,
        aiWins: 0,
        humanWins: 0,
        aiWinRatePct: 0,
        totalDecisions: 0,
        allocation: { usdc: 50, usyc: 30, eurc: 20 },
        balances: { usdc: '0', usyc: '0', eurc: '0' },
        totalAssetsUsd: '0',
        deployed: false,
      })
    }
    return NextResponse.json({
      totalRounds: s.totalRounds,
      aiWins: s.aiWins,
      humanWins: s.humanWins,
      aiWinRatePct: s.aiWinRatePct,
      totalDecisions: s.totalDecisions,
      allocation: s.vault.allocation,
      balances: s.vault.balances,
      totalAssetsUsd: s.vault.totalAssetsUsd,
      deployed: true,
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
