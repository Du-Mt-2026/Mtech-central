// /opt/octupuszap/src/app/api/filters/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export async function GET() {
  const filters = await prisma.savedFilter.findMany({
    orderBy: { updatedAt: 'desc' },
  });
  return NextResponse.json({ filters });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.name || !body.config) {
    return NextResponse.json({ error: 'name e config são obrigatórios' }, { status: 400 });
  }
  const filter = await prisma.savedFilter.create({
    data: { name: body.name, config: body.config, isShared: !!body.isShared },
  });
  return NextResponse.json(filter);
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  if (!body.id) return NextResponse.json({ error: 'id é obrigatório' }, { status: 400 });
  const filter = await prisma.savedFilter.update({
    where: { id: body.id },
    data: {
      ...(body.name ? { name: body.name } : {}),
      ...(body.config ? { config: body.config } : {}),
      ...(typeof body.isShared === 'boolean' ? { isShared: body.isShared } : {}),
    },
  });
  return NextResponse.json(filter);
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id é obrigatório' }, { status: 400 });
  await prisma.savedFilter.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
