// /opt/octupuszap/src/app/api/lists/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export async function GET() {
  const lists = await prisma.leadList.findMany({
    orderBy: { updatedAt: 'desc' },
    include: { _count: { select: { members: true } } },
  });
  return NextResponse.json({ lists });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.name) return NextResponse.json({ error: 'name é obrigatório' }, { status: 400 });
  const list = await prisma.leadList.create({
    data: { name: body.name.trim(), description: body.description || null, color: body.color || 'zinc' },
  });
  return NextResponse.json(list);
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  if (!body.id) return NextResponse.json({ error: 'id é obrigatório' }, { status: 400 });
  const list = await prisma.leadList.update({
    where: { id: body.id },
    data: {
      ...(body.name ? { name: body.name.trim() } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.color ? { color: body.color } : {}),
    },
  });
  return NextResponse.json(list);
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id é obrigatório' }, { status: 400 });
  await prisma.leadList.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
