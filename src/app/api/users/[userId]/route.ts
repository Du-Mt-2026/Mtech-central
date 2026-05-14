import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSession, hashPassword } from '@/lib/auth'

// GET /api/users/[userId] — Get a single user (master only)
export async function GET(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const session = await getSession()
    if (!session || session.role !== 'master') {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    const { userId } = await params
    const user = await db.adminUser.findUnique({
      where: { id: userId },
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

    if (!user) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })
    }

    return NextResponse.json(user)
  } catch (error: any) {
    console.error('[Users] Get error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// PATCH /api/users/[userId] — Update a user (master only)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const session = await getSession()
    if (!session || session.role !== 'master') {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    const { userId } = await params
    const body = await req.json()
    const { name, email, role, active, password, isSystemUser } = body

    // Check user exists
    const existing = await db.adminUser.findUnique({ where: { id: userId } })
    if (!existing) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })
    }

    // Prevent master from deactivating themselves
    if (existing.id === session.userId && active === false) {
      return NextResponse.json({ error: 'Você não pode desativar sua própria conta' }, { status: 400 })
    }

    // Prevent master from demoting themselves
    if (existing.id === session.userId && role && role !== 'master') {
      return NextResponse.json({ error: 'Você não pode rebaixar seu próprio papel' }, { status: 400 })
    }

    // Validate role if provided
    if (role && !['master', 'admin', 'operador'].includes(role)) {
      return NextResponse.json({ error: 'Papel inválido. Use: master, admin ou operador' }, { status: 400 })
    }

    // Check email uniqueness if changing
    if (email && email !== existing.email) {
      const emailTaken = await db.adminUser.findUnique({ where: { email } })
      if (emailTaken) {
        return NextResponse.json({ error: 'Já existe um usuário com este email' }, { status: 409 })
      }
    }

    // Build update data
    const updateData: Record<string, any> = {}
    if (name !== undefined) updateData.name = name
    if (email !== undefined) updateData.email = email
    if (role !== undefined) updateData.role = role
    if (active !== undefined) updateData.active = active
    if (isSystemUser !== undefined) updateData.isSystemUser = isSystemUser

    // Hash new password if provided
    if (password) {
      if (password.length < 6) {
        return NextResponse.json({ error: 'A senha deve ter pelo menos 6 caracteres' }, { status: 400 })
      }
      updateData.password = await hashPassword(password)
    }

    const user = await db.adminUser.update({
      where: { id: userId },
      data: updateData,
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

    return NextResponse.json(user)
  } catch (error: any) {
    console.error('[Users] Update error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE /api/users/[userId] — Delete a user (master only)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const session = await getSession()
    if (!session || session.role !== 'master') {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    const { userId } = await params

    // Prevent self-deletion
    if (userId === session.userId) {
      return NextResponse.json({ error: 'Você não pode excluir sua própria conta' }, { status: 400 })
    }

    const existing = await db.adminUser.findUnique({ where: { id: userId } })
    if (!existing) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })
    }

    await db.adminUser.delete({ where: { id: userId } })

    return NextResponse.json({ success: true, message: 'Usuário excluído com sucesso' })
  } catch (error: any) {
    console.error('[Users] Delete error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
