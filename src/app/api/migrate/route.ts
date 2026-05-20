import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function POST() {
  try {
    // Add delayUnit column to SequenceStep table
    await db.$executeRawUnsafe(`
      ALTER TABLE "SequenceStep" ADD COLUMN IF NOT EXISTS "delayUnit" TEXT NOT NULL DEFAULT 'minutes';
    `)
    return NextResponse.json({ success: true, message: 'Migration applied: delayUnit column added' })
  } catch (error: any) {
    console.error('Migration error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
