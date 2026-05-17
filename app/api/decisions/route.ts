import { NextResponse } from 'next/server'
import { getLatestDecision } from '@/lib/contract'

export const dynamic = 'force-dynamic'
export const revalidate = 60

export async function GET() {
  try {
    const d = await getLatestDecision()
    return NextResponse.json({ latest: d })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
