// /opt/octupuszap/src/app/api/leads/[id]/notes/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const notes = await prisma.leadNote.findMany({
    where: { leadId: id },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ notes });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  if (!body.body || !body.body.trim()) {
    return NextResponse.json({ error: 'body é obrigatório' }, { status: 400 });
  }
  const note = await prisma.leadNote.create({
    data: { leadId: id, body: body.body.trim(), author: body.author || 'sistema' },
  });
  return NextResponse.json(note);
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const noteId = url.searchParams.get('noteId');
  if (!noteId) return NextResponse.json({ error: 'noteId é obrigatório' }, { status: 400 });
  await prisma.leadNote.delete({ where: { id: noteId } });
  return NextResponse.json({ ok: true });
}
