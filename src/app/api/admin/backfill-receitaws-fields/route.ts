import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient, Prisma } from '@prisma/client';
import { receitawsToDBFields, type ReceitaWSResponse } from '@/lib/receitaws-client';

const prisma = new PrismaClient();

/**
 * POST /api/admin/backfill-receitaws-fields
 *
 * Re-processa o `receitawsJson` já salvo nos leads e preenche os campos
 * que ficaram NULL por causa de 2 bugs em `receitawsToDBFields`:
 *
 *   BUG 1: ReceitaWS retorna endereço no TOP LEVEL (r.bairro, r.cep, ...),
 *          não dentro de `r.endereco`. O código antigo sempre lia undefined.
 *
 *   BUG 2: `atividade_principal` é um ARRAY [{code,text}], não um objeto.
 *          O código antigo lia `.code` no array (sempre undefined).
 *
 * Não chama a API da ReceitaWS — apenas re-parseia o JSON já salvo.
 * Seguro rodar múltiplas vezes (idempotente: só atualiza se houver mudança).
 *
 * Body: { dryRun?: boolean, limit?: number }
 * Retorna: { total, updated, skipped, sample }
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dryRun === true;
  const limit = typeof body?.limit === 'number' ? Math.min(body.limit, 5000) : 5000;

  // Busca todos os leads que têm receitawsJson mas campos faltando
  const leads = await prisma.lead.findMany({
    where: {
      // Prisma 6: filtros em campo Json? não aceitam `null` literal.
      // Usamos Prisma.DbNull para significar "SQL NULL" (coluna sem valor).
      receitawsJson: { not: Prisma.DbNull },
      OR: [
        { enderecoBairro: null },
        { enderecoCep: null },
        { enderecoMunicipio: null },
        { enderecoUf: null },
        { cnaePrincipalCodigo: null },
        { cnaePrincipalTexto: null },
      ],
    },
    select: {
      id: true,
      cnpj: true,
      receitawsJson: true,
      enderecoBairro: true,
      enderecoCep: true,
      enderecoMunicipio: true,
      enderecoUf: true,
      cnaePrincipalCodigo: true,
      cnaePrincipalTexto: true,
    },
    take: limit,
  });

  const sample: any[] = [];
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const lead of leads) {
    try {
      if (!lead.receitawsJson) {
        skipped++;
        continue;
      }

      const parsed = JSON.parse(String(lead.receitawsJson)) as ReceitaWSResponse;
      const fields = receitawsToDBFields(parsed);

      // Verifica se há algo pra atualizar (evita UPDATE desnecessário)
      const willChange =
        (fields.enderecoBairro && lead.enderecoBairro !== fields.enderecoBairro) ||
        (fields.enderecoCep && lead.enderecoCep !== fields.enderecoCep) ||
        (fields.enderecoMunicipio && lead.enderecoMunicipio !== fields.enderecoMunicipio) ||
        (fields.enderecoUf && lead.enderecoUf !== fields.enderecoUf) ||
        (fields.cnaePrincipalCodigo && lead.cnaePrincipalCodigo !== fields.cnaePrincipalCodigo) ||
        (fields.cnaePrincipalTexto && lead.cnaePrincipalTexto !== fields.cnaePrincipalTexto);

      if (!willChange) {
        skipped++;
        continue;
      }

      // Guarda amostra dos 3 primeiros para inspeção
      if (sample.length < 3) {
        sample.push({
          id: lead.id,
          cnpj: lead.cnpj,
          before: {
            bairro: lead.enderecoBairro,
            cep: lead.enderecoCep,
            municipio: lead.enderecoMunicipio,
            uf: lead.enderecoUf,
            cnaeCodigo: lead.cnaePrincipalCodigo,
            cnaeTexto: lead.cnaePrincipalTexto,
          },
          after: {
            bairro: fields.enderecoBairro,
            cep: fields.enderecoCep,
            municipio: fields.enderecoMunicipio,
            uf: fields.enderecoUf,
            cnaeCodigo: fields.cnaePrincipalCodigo,
            cnaeTexto: fields.cnaePrincipalTexto,
          },
        });
      }

      if (!dryRun) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: {
            enderecoBairro: fields.enderecoBairro,
            enderecoCep: fields.enderecoCep,
            enderecoMunicipio: fields.enderecoMunicipio,
            enderecoUf: fields.enderecoUf,
            enderecoNumero: fields.enderecoNumero,
            enderecoComplemento: fields.enderecoComplemento,
            enderecoLogradouro: fields.enderecoLogradouro,
            enderecoTipoLogradouro: fields.enderecoTipoLogradouro,
            cnaePrincipalCodigo: fields.cnaePrincipalCodigo,
            cnaePrincipalTexto: fields.cnaePrincipalTexto,
            cnafeSecundarioJson: fields.cnafeSecundarioJson,
            // Não sobrescreve receitawsJson/receitawsFetchedAt (já estão corretos)
          },
        });
      }

      updated++;
    } catch (e) {
      errors++;
      console.error(`[backfill] erro no lead ${lead.id}:`, e);
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    total: leads.length,
    updated,
    skipped,
    errors,
    sample,
  });
}
