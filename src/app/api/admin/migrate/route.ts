import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function POST() {
  try {
    // Add pausedAt column to Campaign table if it doesn't exist
    await db.$executeRawUnsafe(`
      ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "pausedAt" TIMESTAMP(3)
    `)
    return NextResponse.json({ success: true, message: 'Migration complete: pausedAt column added' })
  } catch (error: any) {
    console.error('Migration error:', error)
    return NextResponse.json({ 
      success: false, 
      error: error.message || 'Migration failed',
      hint: 'If column already exists, this is safe to ignore'
    }, { status: 500 })
  }
}
