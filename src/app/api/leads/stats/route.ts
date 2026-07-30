import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET(req: NextRequest) {
  const [
    total,
    withCnpj,
    withoutCnpj,
    receitawsOk,
    receitawsPending,
    receitawsError,
  ] = await Promise.all([
    prisma.lead.count(),
    prisma.lead.count({ where: { cnpj: { not: null } } }),
    prisma.lead.count({ where: { cnpj: null } }),
    prisma.lead.count({ where: { receitawsStatus: 'ok' } }),
    prisma.lead.count({ where: { receitawsStatus: 'pending' } }),
    prisma.lead.count({ where: { receitawsStatus: 'error' } }),
  ]);

  return NextResponse.json({
    total,
    withCnpj,
    withoutCnpj,
    receitawsOk,
    receitawsPending,
    receitawsError,
  });
}
