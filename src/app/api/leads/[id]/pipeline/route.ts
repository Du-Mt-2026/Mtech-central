// /opt/octupuszap/src/app/api/leads/[id]/pipeline/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const VALID_STATUSES = ['novo', 'contatado', 'qualificado', 'convertido', 'perdido'];

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  if (!VALID_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: `status inválido. Válidos: ${VALID_STATUSES.join(', ')}` }, { status: 400 });
  }
  const lead = await prisma.lead.update({
    where: { id },
    data: { pipelineStatus: body.status },
  });
  return NextResponse.json(lead);
}
