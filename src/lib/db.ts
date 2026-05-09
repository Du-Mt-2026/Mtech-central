import { PrismaClient } from '@prisma/client'

// Force new PrismaClient instance to pick up schema changes
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Always create a new client to ensure latest schema is used
const client = new PrismaClient({
  log: ['query'],
})

export const db = client

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = client
