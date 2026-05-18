import { NextResponse } from 'next/server'
import { getLendingState } from '@/lib/contract'

export const dynamic = 'force-dynamic'
export const revalidate = 15

export async function GET() {
  try {
    const state = await getLendingState()
    if (!state) {
      return NextResponse.json({ deployed: false })
    }
    return NextResponse.json({ deployed: true, ...state })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
