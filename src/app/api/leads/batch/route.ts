// /opt/octupuszap/src/app/api/leads/batch/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

interface BatchPayload {
  action: 'addTag' | 'removeTag' | 'addToList' | 'removeFromList' | 'delete' | 'setPipelineStatus' | 'recalcScore' | 'refetchCnpj';
  leadIds: string[];
  tagId?: string;
  listId?: string;
  pipelineStatus?: string;
}

export async function POST(req: NextRequest) {
  const body: BatchPayload = await req.json();
  const { action, leadIds } = body;
  if (!action || !Array.isArray(leadIds) || leadIds.length === 0) {
    return NextResponse.json({ error: 'action e leadIds[] são obrigatórios' }, { status: 400 });
  }

  let result: any = { action, count: leadIds.length };

  switch (action) {
    case 'addTag': {
      if (!body.tagId) return NextResponse.json({ error: 'tagId obrigatório' }, { status: 400 });
      await prisma.leadTagAssignment.createMany({
        data: leadIds.map((leadId) => ({ leadId, tagId: body.tagId! })),
        skipDuplicates: true,
      });
      break;
    }
    case 'removeTag': {
      if (!body.tagId) return NextResponse.json({ error: 'tagId obrigatório' }, { status: 400 });
      await prisma.leadTagAssignment.deleteMany({
        where: { leadId: { in: leadIds }, tagId: body.tagId },
      });
      break;
    }
    case 'addToList': {
      if (!body.listId) return NextResponse.json({ error: 'listId obrigatório' }, { status: 400 });
      await prisma.leadListMember.createMany({
        data: leadIds.map((leadId) => ({ leadId, listId: body.listId! })),
        skipDuplicates: true,
      });
      // bump updatedAt da lista
      await prisma.leadList.update({ where: { id: body.listId }, data: { updatedAt: new Date() } });
      break;
    }
    case 'removeFromList': {
      if (!body.listId) return NextResponse.json({ error: 'listId obrigatório' }, { status: 400 });
      await prisma.leadListMember.deleteMany({
        where: { leadId: { in: leadIds }, listId: body.listId },
      });
      break;
    }
    case 'delete': {
      await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
      break;
    }
    case 'setPipelineStatus': {
      if (!body.pipelineStatus) return NextResponse.json({ error: 'pipelineStatus obrigatório' }, { status: 400 });
      await prisma.lead.updateMany({
        where: { id: { in: leadIds } },
        data: { pipelineStatus: body.pipelineStatus },
      });
      break;
    }
    case 'recalcScore': {
      const leads = await prisma.lead.findMany({
        where: { id: { in: leadIds } },
        select: { id: true, cnpj: true, website: true, phone: true, situacaoCadastral: true, businessStatus: true, rating: true, userRatingCount: true },
      });
      for (const lead of leads) {
        const score = computeScoreLocal(lead);
        await prisma.lead.update({ where: { id: lead.id }, data: { score } });
      }
      result.recalcCount = leads.length;
      break;
    }
    case 'refetchCnpj': {
      // Dispara refetch assíncrono (não espera)
      for (const id of leadIds) {
        fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/leads/${id}/fetch-cnpj`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force: true }),
        }).catch(() => {});
      }
      result.queued = leadIds.length;
      break;
    }
    default:
      return NextResponse.json({ error: `Ação desconhecida: ${action}` }, { status: 400 });
  }

  return NextResponse.json(result);
}

function computeScoreLocal(lead: any): number {
  let score = 0;
  if (lead.cnpj) score += 30;
  if (lead.situacaoCadastral && lead.situacaoCadastral.toUpperCase() === 'ATIVA') score += 20;
  if (lead.website) score += 15;
  if (lead.phone) score += 15;
  if (lead.businessStatus && lead.businessStatus.toUpperCase() === 'OPERATIONAL') score += 10;
  if (lead.rating && lead.rating >= 4.0 && (lead.userRatingCount || 0) >= 50) score += 10;
  return Math.min(100, score);
}
