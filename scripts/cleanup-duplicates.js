/**
 * One-time cleanup script: Remove duplicate Message records before adding
 * the @@unique([campaignId, contactId, stepOrder]) constraint.
 *
 * For each group of duplicate (campaignId, contactId, stepOrder), keeps the
 * earliest record (lowest id) and deletes the rest.
 *
 * Usage: node scripts/cleanup-duplicates.js
 * This runs BEFORE prisma db push to ensure the unique constraint can be created.
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function cleanupDuplicates() {
  console.log('[Cleanup] Starting duplicate message cleanup...')

  // Find all groups of duplicate (campaignId, contactId, stepOrder) where campaignId is NOT NULL
  const duplicates = await prisma.$queryRaw`
    SELECT "campaignId", "contactId", "stepOrder", COUNT(*) as cnt
    FROM "Message"
    WHERE "campaignId" IS NOT NULL
    GROUP BY "campaignId", "contactId", "stepOrder"
    HAVING COUNT(*) > 1
  `

  console.log(`[Cleanup] Found ${duplicates.length} groups of duplicate messages`)

  if (duplicates.length === 0) {
    console.log('[Cleanup] No duplicates found — safe to add unique constraint')
    return
  }

  let totalRemoved = 0

  for (const dup of duplicates) {
    // Find all messages in this group, ordered by id (earliest first)
    const messages = await prisma.message.findMany({
      where: {
        campaignId: dup.campaignId,
        contactId: dup.contactId,
        stepOrder: dup.stepOrder,
      },
      orderBy: { id: 'asc' },
      select: { id: true, status: true },
    })

    // Keep the first one, delete the rest
    const removeIds = messages.slice(1).map(m => m.id)

    const deleted = await prisma.message.deleteMany({
      where: { id: { in: removeIds } },
    })

    totalRemoved += deleted.count
    console.log(`[Cleanup] Campaign ${dup.campaignId}, Contact ${dup.contactId}, Step ${dup.stepOrder}: kept ${messages[0].id}, removed ${deleted.count} duplicates (statuses: ${messages.slice(1).map(m => m.status).join(', ')})`)
  }

  console.log(`[Cleanup] Total duplicate messages removed: ${totalRemoved}`)
  console.log('[Cleanup] Safe to add unique constraint now')
}

cleanupDuplicates()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error('[Cleanup] Error:', e)
    prisma.$disconnect()
    process.exit(1)
  })
