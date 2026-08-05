// /opt/octupuszap/src/app/api/leads/[id]/tags/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  if (!body.tagId) return NextResponse.json({ error: 'tagId obrigatório' }, { status: 400 });
  try {
    await prisma.leadTagAssignment.create({
      data: { leadId: id, tagId: body.tagId },
    });
  } catch (e: any) {
    if (e?.code !== 'P2002') throw e; // P2002 = já existe, ignorar
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const tagId = url.searchParams.get('tagId');
  if (!tagId) return NextResponse.json({ error: 'tagId obrigatório' }, { status: 400 });
  await prisma.leadTagAssignment.delete({
    where: { leadId_tagId: { leadId: id, tagId } },
  });
  return NextResponse.json({ ok: true });
}
