import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { consultarReceitaWS, receitawsToDBFields } from '@/lib/receitaws-client';
import { formatCnpj } from '@/lib/places-client';

const prisma = new PrismaClient();

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/leads/[id]/enrich-receitaws
 * Body: { force?: boolean }
 * Enriquece um lead que ja tem CNPJ com dados da ReceitaWS.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const force = body?.force === true;

  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) {
    return NextResponse.json({ error: 'Lead nao encontrado' }, { status: 404 });
  }

  if (!lead.cnpj) {
    return NextResponse.json(
      { error: 'Lead nao tem CNPJ. Execute fetch-cnpj primeiro.' },
      { status: 400 }
    );
  }

  const receitaws = await consultarReceitaWS(lead.cnpj, { force });
  if (!receitaws) {
    await prisma.lead.update({
      where: { id },
      data: { receitawsStatus: 'error' },
    });
    return NextResponse.json(
      { ok: false, error: 'ReceitaWS nao retornou dados' },
      { status: 502 }
    );
  }

  const fields = receitawsToDBFields(receitaws);
  await prisma.lead.update({
    where: { id },
    data: {
      ...fields,
      cnpj: lead.cnpj,
      cnpjFormatted: formatCnpj(lead.cnpj),
    },
  });

  const updated = await prisma.lead.findUnique({ where: { id } });
  return NextResponse.json({ ok: true, lead: updated });
}
