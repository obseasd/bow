import { NextResponse } from 'next/server'
import { getRecentRounds } from '@/lib/contract'

export const dynamic = 'force-dynamic'
export const revalidate = 30

export async function GET() {
  try {
    const rounds = await getRecentRounds(10)
    return NextResponse.json({ rounds })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
