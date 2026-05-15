import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSession, hashPassword } from '@/lib/auth'

// GET /api/users — List all users (master only)
export async function GET() {
  try {
    const session = await getSession()
    if (!session || session.role !== 'master') {
      return NextResponse.json({ error: 'Acesso negado. Apenas Masters podem gerenciar usuários.' }, { status: 403 })
    }

    const users = await db.adminUser.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        twoFactorEnabled: true,
        imagem: true,
        isSystemUser: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json(users)
  } catch (error: any) {
    console.error('[Users] List error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST /api/users — Create a new user (master only)
export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session || session.role !== 'master') {
      return NextResponse.json({ error: 'Acesso negado. Apenas Masters podem criar usuários.' }, { status: 403 })
    }

    const body = await req.json()
    const { name, email, password, role, active, isSystemUser } = body

    if (!name || !email || !password) {
      return NextResponse.json({ error: 'Nome, email e senha são obrigatórios' }, { status: 400 })
    }

    if (!['master', 'admin', 'operador'].includes(role)) {
      return NextResponse.json({ error: 'Papel inválido. Use: master, admin ou operador' }, { status: 400 })
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'A senha deve ter pelo menos 6 caracteres' }, { status: 400 })
    }

    // Check if email already exists
    const existing = await db.adminUser.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json({ error: 'Já existe um usuário com este email' }, { status: 409 })
    }

    const hashedPassword = await hashPassword(password)

    const user = await db.adminUser.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: role || 'operador',
        active: active !== undefined ? active : true,
        isSystemUser: isSystemUser || false,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        twoFactorEnabled: true,
        imagem: true,
        isSystemUser: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    return NextResponse.json(user, { status: 201 })
  } catch (error: any) {
    console.error('[Users] Create error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
