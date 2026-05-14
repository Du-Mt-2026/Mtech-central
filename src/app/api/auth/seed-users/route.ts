import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Seed users from the old system — call once after deployment
// POST /api/auth/seed-users
// Skips existing users (by email) and creates missing ones
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { secret } = body

    // Simple protection — only allow with correct secret
    if (secret !== process.env.AUTH_SECRET && secret !== 'octupuszap-dev-secret-change-in-production') {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }

    const users = [
      { name: 'RENATO - ADM', email: 'renato@renatoalvesfilho.com.br', password: '$2b$12$VtGDLIaQnUZ/AVo5rLcwAuaMdQCrV6ub72EQZhmGsY8cxcXNeBz7a', role: 'master', active: true, twoFactorSecret: 'F5UVIXZYPRDEQYBE', twoFactorEnabled: false, imagem: '', isSystemUser: false },
      { name: 'ARTUR - ADM', email: 'artur.luiz.rodrigues.alves@gmail.com', password: '$2b$12$S4OMy3UzLucyTeJu.JoP4uhcsPfFu2HWKJQobqnXHBAo3qPALL8D.', role: 'master', active: true, twoFactorSecret: null, twoFactorEnabled: false, imagem: '', isSystemUser: false },
      { name: 'PRISCILA NEUSA FERREIRA', email: 'comercial@mtechdistribuidora.com.br', password: '$2b$12$WjBS0gLfamlQJiMikLMRPOnYCkXaCd6Sfuy9ZByXHPgZKro/mB3TO', role: 'admin', active: true, twoFactorSecret: null, twoFactorEnabled: false, imagem: '', isSystemUser: false },
      { name: 'MICHELLY HENRIQUE', email: 'michelly.herique@hotmail.com', password: '$2b$12$gAXLGxxiAIoIViTMD1Xec.xgosjAd.5ugVLSdIJnwXnRWuWGwINL6', role: 'admin', active: true, twoFactorSecret: null, twoFactorEnabled: false, imagem: '', isSystemUser: false },
      { name: 'DEBORA PHILIPI MATOS', email: 'debora@mtechdistribuidora.com.br', password: '$2b$12$GrMOBgUKlDmmyEan0jgC9uqwBCKE.ub510qIk0nmmE0gLUs3ubkSe', role: 'operador', active: true, twoFactorSecret: null, twoFactorEnabled: false, imagem: '', isSystemUser: false },
      { name: 'ALICE - Supervisora', email: 'alice@mtechdistribuidora.com.br', password: '$2b$12$yPJD/Qs6/dIpk3TWkivi3OCyNFMJxPUr/bLOkd0ebw02dqGAy.XPm', role: 'admin', active: true, twoFactorSecret: null, twoFactorEnabled: false, imagem: '', isSystemUser: false },
      { name: 'MALU FERREIRA JARDIM', email: 'malu@mtechdistribuidora.com.br', password: '$2b$12$ejZSd5VmLv3tUOXOKLHIuuq3OA04WFO4PLumahLQ8wJCHk4xrMt3G', role: 'operador', active: false, twoFactorSecret: null, twoFactorEnabled: false, imagem: '', isSystemUser: false },
      { name: 'MARIA EDUARDA', email: 'mariaeduarda@mtechdistribuidora.com.br', password: '$2b$12$uhXUZPacQzbfRhxu6LZvruDdLvviRsYJOB1o2QfwbgPs0Kb2Wcb..', role: 'operador', active: false, twoFactorSecret: null, twoFactorEnabled: false, imagem: '', isSystemUser: false },
      { name: 'MARIANE GARCIA DA LUZ', email: 'vendas05@mtechdistribuidora.com.br', password: '$2b$12$8NeInmINZI2l3rhFjGG9/OEJlYrD7x8BXDlycSi6M8h9DXTr3ZsmW', role: 'operador', active: true, twoFactorSecret: null, twoFactorEnabled: false, imagem: '', isSystemUser: false },
      { name: 'Bolsão', email: 'bolsao@sistema.mtech', password: '$2b$12$AFMlCU0QRiVhd2px9b6JjOfDXkdamNzrvpwU2fStjS3MjbSbTbEqK', role: 'operador', active: true, twoFactorSecret: null, twoFactorEnabled: false, imagem: '', isSystemUser: true },
      { name: 'KAROLINE MARTTA MEIRELES', email: 'vendas06@mtechdistribuidora.com.br', password: '$2b$12$lWpZPKJg7jRkng9xl3aISuft5n7D0Z1.qrMCmm3k4t5VTEfPYohy6', role: 'operador', active: true, twoFactorSecret: null, twoFactorEnabled: false, imagem: '', isSystemUser: false },
      { name: 'Fornecedor', email: 'fornecedor@sistema.mtech', password: '$2b$12$.Sk3oQEQ9LxnOYkQQQYCUOmFlxrHuszoRMgbKUStG94FENLdSUAA.', role: 'operador', active: true, twoFactorSecret: null, twoFactorEnabled: false, imagem: '', isSystemUser: true },
      { name: 'LISTA FRIA', email: 'lista-fria@sistema.mtech', password: '$2b$12$d9fs4eSeQWlyrAmNiU3v6e5wEwku7jkPA61filitByYOMXRp0y1o2', role: 'operador', active: true, twoFactorSecret: null, twoFactorEnabled: false, imagem: '', isSystemUser: true },
    ]

    // Get existing users by email
    const existingUsers = await db.adminUser.findMany({ select: { email: true } })
    const existingEmails = new Set(existingUsers.map(u => u.email))

    // Filter out users that already exist
    const newUsers = users.filter(u => !existingEmails.has(u.email))

    if (newUsers.length === 0) {
      return NextResponse.json({
        message: `Todos os ${users.length} usuários já existem. Nada a fazer.`,
        total: existingUsers.length,
        created: 0,
        skipped: users.length,
      })
    }

    // Delete the auto-created master user if it doesn't match any seed user
    // (cleanup from first-login auto-creation)
    const autoCreatedUsers = existingUsers.filter(u => !existingEmails.has(u.email) || !users.some(su => su.email === u.email))

    const created = await db.adminUser.createMany({ data: newUsers })
    return NextResponse.json({
      success: true,
      message: `${created.count} usuários criados! ${existingEmails.size} já existiam e foram mantidos.`,
      total: existingUsers.length + created.count,
      created: created.count,
      skipped: existingEmails.size,
    })
  } catch (error: any) {
    console.error('[Auth] Seed users error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
