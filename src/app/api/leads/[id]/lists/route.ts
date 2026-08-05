// /opt/octupuszap/src/app/api/leads/[id]/lists/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  if (!body.listId) return NextResponse.json({ error: 'listId obrigatório' }, { status: 400 });
  try {
    await prisma.leadListMember.create({
      data: { leadId: id, listId: body.listId },
    });
    await prisma.leadList.update({ where: { id: body.listId }, data: { updatedAt: new Date() } });
  } catch (e: any) {
    if (e?.code !== 'P2002') throw e;
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const listId = url.searchParams.get('listId');
  if (!listId) return NextResponse.json({ error: 'listId obrigatório' }, { status: 400 });
  await prisma.leadListMember.delete({
    where: { leadId_listId: { leadId: id, listId } },
  });
  return NextResponse.json({ ok: true });
}
