#!/usr/bin/env bun
/**
 * Seed users from the old system — one-time CLI script.
 *
 * SECURITY (P0.5): Moved from /api/auth/seed-users to a CLI script.
 * The old HTTP endpoint exposed 13 bcrypt hashes + TOTP seeds in source code
 * and allowed anyone with AUTH_SECRET to recreate users. This script runs
 * only from the server CLI — no HTTP exposure.
 *
 * Usage:
 *   bun run scripts/seed-users.ts
 *
 * Or via Docker:
 *   docker exec octupuszap-app bun run scripts/seed-users.ts
 *
 * Requires AUTH_SECRET in environment (must match the server's .env).
 */

import { db } from '../src/lib/db'
import { hashPassword } from '../src/lib/auth'
import { logAction } from '../src/lib/audit-log'
import * as readline from 'readline'

// ⚠️ SECURITY NOTE (P0.1): These hashes were previously committed to a public GitHub repo.
// After running this script, you MUST:
//   1. Force password reset for all seeded users (set mustChangePassword=true)
//   2. Generate new TOTP seeds for any user who will use 2FA
//   3. Consider rotating AUTH_SECRET if it was also exposed
// The hashes below are kept ONLY for one-time bootstrap of an existing deployment.
// For new deployments, do NOT use this script — create users via the UI instead.

interface SeedUser {
  name: string
  email: string
  password: string // bcrypt hash
  role: 'master' | 'admin' | 'operador'
  active: boolean
  twoFactorSecret: string | null
  twoFactorEnabled: boolean
  isSystemUser: boolean
}

const SEED_USERS: SeedUser[] = [
  { name: 'RENATO - ADM', email: 'renato@renatoalvesfilho.com.br', password: '$2b$12$VtGDLIaQnUZ/AVo5rLcwAuaMdQCrV6ub72EQZhmGsY8cxcXNeBz7a', role: 'master', active: true, twoFactorSecret: 'F5UVIXZYPRDEQYBE', twoFactorEnabled: false, isSystemUser: false },
  { name: 'ARTUR - ADM', email: 'artur.luiz.rodrigues.alves@gmail.com', password: '$2b$12$S4OMy3UzLucyTeJu.JoP4uhcsPfFu2HWKJQobqnXHBAo3qPALL8D.', role: 'master', active: true, twoFactorSecret: null, twoFactorEnabled: false, isSystemUser: false },
  { name: 'PRISCILA NEUSA FERREIRA', email: 'comercial@mtechdistribuidora.com.br', password: '$2b$12$WjBS0gLfamlQJiMikLMRPOnYCkXaCd6Sfuy9ZByXHPgZKro/mB3TO', role: 'admin', active: true, twoFactorSecret: null, twoFactorEnabled: false, isSystemUser: false },
  { name: 'MICHELLY HENRIQUE', email: 'michelly.herique@hotmail.com', password: '$2b$12$gAXLGxxiAIoIViTMD1Xec.xgosjAd.5ugVLSdIJnwXnRWuWGwINL6', role: 'admin', active: true, twoFactorSecret: null, twoFactorEnabled: false, isSystemUser: false },
  { name: 'DEBORA PHILIPI MATOS', email: 'debora@mtechdistribuidora.com.br', password: '$2b$12$GrMOBgUKlDmmyEan0jgC9uqwBCKE.ub510qIk0nmmE0gLUs3ubkSe', role: 'operador', active: true, twoFactorSecret: null, twoFactorEnabled: false, isSystemUser: false },
  { name: 'ALICE - Supervisora', email: 'alice@mtechdistribuidora.com.br', password: '$2b$12$yPJD/Qs6/dIpk3TWkivi3OCyNFMJxPUr/bLOkd0ebw02dqGAy.XPm', role: 'admin', active: true, twoFactorSecret: null, twoFactorEnabled: false, isSystemUser: false },
  { name: 'MALU FERREIRA JARDIM', email: 'malu@mtechdistribuidora.com.br', password: '$2b$12$ejZSd5VmLv3tUOXOKLHIuuq3OA04WFO4PLumahLQ8wJCHk4xrMt3G', role: 'operador', active: false, twoFactorSecret: null, twoFactorEnabled: false, isSystemUser: false },
  { name: 'MARIA EDUARDA', email: 'mariaeduarda@mtechdistribuidora.com.br', password: '$2b$12$uhXUZPacQzbfRhxu6LZvruDdLvviRsYJOB1o2QfwbgPs0Kb2Wcb..', role: 'operador', active: false, twoFactorSecret: null, twoFactorEnabled: false, isSystemUser: false },
  { name: 'MARIANE GARCIA DA LUZ', email: 'vendas05@mtechdistribuidora.com.br', password: '$2b$12$8NeInmINZI2l3rhFjGG9/OEJlYrD7x8BXDlycSi6M8h9DXTr3ZsmW', role: 'operador', active: true, twoFactorSecret: null, twoFactorEnabled: false, isSystemUser: false },
  { name: 'Bolsão', email: 'bolsao@sistema.mtech', password: '$2b$12$AFMlCU0QRiVhd2px9b6JjOfDXkdamNzrvpwU2fStjS3MjbSbTbEqK', role: 'operador', active: true, twoFactorSecret: null, twoFactorEnabled: false, isSystemUser: true },
  { name: 'KAROLINE MARTTA MEIRELES', email: 'vendas06@mtechdistribuidora.com.br', password: '$2b$12$lWpZPKJg7jRkng9xl3aISuft5n7D0Z1.qrMCmm3k4t5VTEfPYohy6', role: 'operador', active: true, twoFactorSecret: null, twoFactorEnabled: false, isSystemUser: false },
  { name: 'Fornecedor', email: 'fornecedor@sistema.mtech', password: '$2b$12$.Sk3oQEQ9LxnOYkQQQYCUOmFlxrHuszoRMgbKUStG94FENLdSUAA.', role: 'operador', active: true, twoFactorSecret: null, twoFactorEnabled: false, isSystemUser: true },
  { name: 'LISTA FRIA', email: 'lista-fria@sistema.mtech', password: '$2b$12$d9fs4eSeQWlyrAmNiU3v6e5wEwku7jkPA61filitByYOMXRp0y1o2', role: 'operador', active: true, twoFactorSecret: null, twoFactorEnabled: false, isSystemUser: true },
]

async function main() {
  console.log('=== OctupusZap — Seed Users CLI ===\n')
  console.log('⚠️  SECURITY WARNING:')
  console.log('    These bcrypt hashes were previously committed to a public GitHub repo.')
  console.log('    After seeding, you MUST force password reset for all users.')
  console.log('    See SECURITY NOTE at the top of this file.\n')

  // Require explicit confirmation
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise<string>(resolve => {
    rl.question('Proceed with seeding? (yes/no): ', resolve)
  })
  rl.close()

  if (answer.toLowerCase() !== 'yes') {
    console.log('Aborted.')
    process.exit(0)
  }

  // Get existing users by email
  const existingUsers = await db.adminUser.findMany({ select: { email: true } })
  const existingEmails = new Set(existingUsers.map(u => u.email))

  // Filter out users that already exist
  const newUsers = SEED_USERS.filter(u => !existingEmails.has(u.email))

  if (newUsers.length === 0) {
    console.log(`All ${SEED_USERS.length} users already exist. Nothing to do.`)
    console.log(`Total users in DB: ${existingUsers.length}`)
    process.exit(0)
  }

  // Mark seeded users as mustChangePassword = true (security measure)
  const usersToCreate = newUsers.map(u => ({
    ...u,
    mustChangePassword: true, // P0.2 mitigation: force reset on first login
  }))

  const created = await db.adminUser.createMany({ data: usersToCreate })

  // Audit log: seed operation was executed (system-level, no user context)
  await logAction({
    action: 'USERS_SEEDED',
    category: 'admin',
    targetType: 'user',
    details: {
      created: created.count,
      skipped: existingEmails.size,
      total: existingUsers.length + created.count,
    },
  })

  console.log(`\n✓ Created ${created.count} users.`)
  console.log(`✓ ${existingEmails.size} already existed and were kept.`)
  console.log(`✓ Total users in DB: ${existingUsers.length + created.count}`)
  console.log(`\n⚠️  All newly created users have mustChangePassword=true.`)
  console.log(`    They will be forced to reset their password on first login.`)
  console.log(`\nDone.`)
  process.exit(0)
}

main().catch(err => {
  console.error('Seed users failed:', err)
  process.exit(1)
})
