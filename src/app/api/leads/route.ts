// /opt/octupuszap/src/app/api/leads/route.ts (NOVA VERSÃO)
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { computeScore } from '@/lib/lead-utils';

const prisma = new PrismaClient();

export interface LeadListFilters {
  query?: string;
  city?: string;
  state?: string;
  cnpjStatus?: 'all' | 'with' | 'without' | 'error';
  receitawsStatus?: 'all' | 'ok' | 'pending' | 'error';
  page?: number;
  pageSize?: number;
  tagIds?: string[];
  listId?: string;
  pipelineStatus?: string;
  minScore?: number;
  excludeDuplicates?: boolean;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const query = url.searchParams.get('query') || undefined;
  const city = url.searchParams.get('city') || undefined;
  const state = url.searchParams.get('state') || undefined;
  const cnpjStatus = (url.searchParams.get('cnpjStatus') || 'all') as LeadListFilters['cnpjStatus'];
  const receitawsStatus = (url.searchParams.get('receitawsStatus') || 'all') as LeadListFilters['receitawsStatus'];
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || '20', 10)));
  const tagIdsParam = url.searchParams.get('tagIds');
  const tagIds = tagIdsParam ? tagIdsParam.split(',').filter(Boolean) : undefined;
  const listId = url.searchParams.get('listId') || undefined;
  const pipelineStatus = url.searchParams.get('pipelineStatus') || undefined;
  const minScore = url.searchParams.get('minScore') ? parseInt(url.searchParams.get('minScore')!, 10) : undefined;
  const excludeDuplicates = url.searchParams.get('excludeDuplicates') === 'true';

  const where: any = {};
  if (query) {
    where.OR = [
      { name: { contains: query, mode: 'insensitive' } },
      { formattedAddress: { contains: query, mode: 'insensitive' } },
      { cnpj: { contains: query.replace(/\D/g, '') } },
      { razaoSocial: { contains: query, mode: 'insensitive' } },
      { nomeFantasia: { contains: query, mode: 'insensitive' } },
    ];
  }
  if (city) where.locality = { contains: city, mode: 'insensitive' };
  if (state) where.administrativeArea = { equals: state.toUpperCase() };
  if (cnpjStatus === 'with') where.cnpj = { not: null };
  else if (cnpjStatus === 'without') where.cnpj = null;
  else if (cnpjStatus === 'error') where.cnpjFetchStatus = 'error';
  if (receitawsStatus === 'ok') where.receitawsStatus = 'ok';
  else if (receitawsStatus === 'pending') where.receitawsStatus = 'pending';
  else if (receitawsStatus === 'error') where.receitawsStatus = 'error';
  if (tagIds && tagIds.length > 0) {
    where.tagAssignments = { some: { tagId: { in: tagIds } } };
  }
  if (listId) {
    where.listMemberships = { some: { listId } };
  }
  if (pipelineStatus) where.pipelineStatus = pipelineStatus;
  if (typeof minScore === 'number') where.score = { gte: minScore };
  if (excludeDuplicates) where.duplicateOfId = null;

  const [total, leads, statsBase] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        tagAssignments: { include: { tag: true } },
        listMemberships: { include: { list: true } },
      },
    }),
    prisma.lead.aggregate({
      _count: true,
      where: { cnpj: { not: null } },
    }),
  ]);

  const allTotal = await prisma.lead.count();
  const withCnpj = await prisma.lead.count({ where: { cnpj: { not: null } } });
  const withoutCnpj = await prisma.lead.count({ where: { cnpj: null } });

  // Recalcula score on-the-fly se null (não persiste, só pra display)
  const leadsWithScore = leads.map((lead) => ({
    ...lead,
    score: lead.score ?? computeScore(lead),
  }));

  return NextResponse.json({
    leads: leadsWithScore,
    total,
    page,
    pageSize,
    stats: { total: allTotal, withCnpj, withoutCnpj },
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.placeId) {
    return NextResponse.json({ error: 'placeId é obrigatório' }, { status: 400 });
  }
  const lead = await prisma.lead.upsert({
    where: { placeId: body.placeId },
    create: {
      placeId: body.placeId,
      name: body.name ?? null,
      formattedAddress: body.formattedAddress ?? null,
      website: body.website ?? null,
      phone: body.phone ?? null,
      rating: body.rating ?? null,
      userRatingCount: body.userRatingCount ?? null,
      googleMapsUri: body.googleMapsUri ?? null,
      businessStatus: body.businessStatus ?? null,
      streetNumber: body.streetNumber ?? null,
      route: body.route ?? null,
      sublocality: body.sublocality ?? null,
      locality: body.locality ?? null,
      administrativeArea: body.administrativeArea ?? null,
      postalCode: body.postalCode ?? null,
      country: body.country ?? null,
      cnpjFetchStatus: 'pending',
      receitawsStatus: 'pending',
    },
    update: {
      name: body.name ?? undefined,
      formattedAddress: body.formattedAddress ?? undefined,
      website: body.website ?? undefined,
      phone: body.phone ?? undefined,
      rating: body.rating ?? undefined,
      userRatingCount: body.userRatingCount ?? undefined,
      googleMapsUri: body.googleMapsUri ?? undefined,
      businessStatus: body.businessStatus ?? undefined,
      streetNumber: body.streetNumber ?? undefined,
      route: body.route ?? undefined,
      sublocality: body.sublocality ?? undefined,
      locality: body.locality ?? undefined,
      administrativeArea: body.administrativeArea ?? undefined,
      postalCode: body.postalCode ?? undefined,
      country: body.country ?? undefined,
    },
  });
  return NextResponse.json(lead);
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id é obrigatório' }, { status: 400 });
  }
  await prisma.lead.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
