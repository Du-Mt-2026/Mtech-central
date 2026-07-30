// /opt/octupuszap/src/app/api/tags/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export async function GET() {
  const tags = await prisma.leadTag.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { assignments: true } } },
  });
  return NextResponse.json({ tags });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.name) return NextResponse.json({ error: 'name é obrigatório' }, { status: 400 });
  try {
    const tag = await prisma.leadTag.create({
      data: { name: body.name.trim(), color: body.color || 'zinc' },
    });
    return NextResponse.json(tag);
  } catch (e: any) {
    if (e?.code === 'P2002') {
      return NextResponse.json({ error: 'Tag já existe' }, { status: 409 });
    }
    throw e;
  }
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  if (!body.id) return NextResponse.json({ error: 'id é obrigatório' }, { status: 400 });
  const tag = await prisma.leadTag.update({
    where: { id: body.id },
    data: {
      ...(body.name ? { name: body.name.trim() } : {}),
      ...(body.color ? { color: body.color } : {}),
    },
  });
  return NextResponse.json(tag);
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id é obrigatório' }, { status: 400 });
  await prisma.leadTag.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
