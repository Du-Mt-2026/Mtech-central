#!/usr/bin/env tsx
/**
 * Backfill de campos ReceitaWS que ficaram NULL por causa de 2 bugs antigos
 * em `receitawsToDBFields` (já corrigidos).
 *
 *   BUG 1: ReceitaWS retorna endereço no TOP LEVEL (r.bairro, r.cep, ...),
 *          não dentro de `r.endereco`. Código antigo sempre lia undefined.
 *
 *   BUG 2: `atividade_principal` é um ARRAY [{code,text}], não objeto.
 *          Código antigo lia `.code` no array (sempre undefined).
 *
 * Este script re-processa o `receitawsJson` já salvo nos leads e preenche
 * os campos que ficaram NULL. NÃO chama a API da ReceitaWS — apenas
 * re-parseia o JSON já salvo. Idempotente.
 *
 * Uso (na VPS, como root):
 *   docker exec octupuszap-app tsx scripts/backfill-receitaws-fields.ts
 *
 * Flags (opcionais):
 *   --dry-run    Não aplica mudanças, apenas mostra o que seria feito
 *   --limit=N    Processa no máximo N leads (default 5000)
 *
 * Exemplos:
 *   docker exec octupuszap-app tsx scripts/backfill-receitaws-fields.ts --dry-run
 *   docker exec octupuszap-app tsx scripts/backfill-receitaws-fields.ts --limit=100
 */

import { PrismaClient, Prisma } from '@prisma/client'
import { receitawsToDBFields, type ReceitaWSResponse } from '../src/lib/receitaws-client'

const prisma = new PrismaClient()

function parseArgs(): { dryRun: boolean; limit: number } {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  let limit = 5000
  for (const a of args) {
    const m = /^--limit=(\d+)$/.exec(a)
    if (m) limit = Math.min(parseInt(m[1], 10), 5000)
  }
  return { dryRun, limit }
}

async function main() {
  const { dryRun, limit } = parseArgs()
  console.log(`[backfill] dryRun=${dryRun} limit=${limit}`)

  // Busca todos os leads que têm receitawsJson mas campos faltando.
  // Prisma 6: filtros em campo Json? NÃO aceitam `null` literal — usar Prisma.DbNull.
  const leads = await prisma.lead.findMany({
    where: {
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
  })

  console.log(`[backfill] ${leads.length} leads candidatos`)

  const sample: any[] = []
  let updated = 0
  let skipped = 0
  let errors = 0

  for (const lead of leads) {
    try {
      if (!lead.receitawsJson) {
        skipped++
        continue
      }

      const parsed = JSON.parse(String(lead.receitawsJson)) as ReceitaWSResponse
      const fields = receitawsToDBFields(parsed)

      // Verifica se há algo pra atualizar (evita UPDATE desnecessário)
      const willChange =
        (fields.enderecoBairro && lead.enderecoBairro !== fields.enderecoBairro) ||
        (fields.enderecoCep && lead.enderecoCep !== fields.enderecoCep) ||
        (fields.enderecoMunicipio && lead.enderecoMunicipio !== fields.enderecoMunicipio) ||
        (fields.enderecoUf && lead.enderecoUf !== fields.enderecoUf) ||
        (fields.cnaePrincipalCodigo && lead.cnaePrincipalCodigo !== fields.cnaePrincipalCodigo) ||
        (fields.cnaePrincipalTexto && lead.cnaePrincipalTexto !== fields.cnaePrincipalTexto)

      if (!willChange) {
        skipped++
        continue
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
        })
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
        })
      }

      updated++
      if (updated % 50 === 0) {
        console.log(`[backfill] progresso: ${updated} atualizados, ${skipped} skipped, ${errors} erros`)
      }
    } catch (e) {
      errors++
      console.error(`[backfill] erro no lead ${lead.id}:`, e)
    }
  }

  const report = {
    dryRun,
    total: leads.length,
    updated,
    skipped,
    errors,
    sample,
  }
  console.log(`[backfill] RESULTADO FINAL`)
  console.log(JSON.stringify(report, null, 2))

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error('[backfill] FATAL:', e)
  process.exit(1)
})
