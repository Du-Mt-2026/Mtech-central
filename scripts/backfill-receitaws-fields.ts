#!/usr/bin/env tsx
/**
 * Backfill de campos ReceitaWS que ficaram NULL por causa de 2 bugs antigos
 * em `receitawsToDBFields` (já corrigidos no código principal).
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
 * AUTOCONTIDO: não importa nada de ../src/* (o runner image do Docker
 * não copia src/, só scripts/ + prisma/ + node_modules). A função
 * receitawsToDBFields é duplicada aqui de propósito.
 *
 * Uso (na VPS, como root):
 *   docker exec octupuszap-app tsx scripts/backfill-receitaws-fields.ts
 *   docker exec octupuszap-app tsx scripts/backfill-receitaws-fields.ts --dry-run
 *   docker exec octupuszap-app tsx scripts/backfill-receitaws-fields.ts --limit=100
 */

import { PrismaClient, Prisma } from '@prisma/client'

const prisma = new PrismaClient()

// ============================================================================
// COPIA INTENCIONAL de src/lib/receitaws-client.ts
// (mantenha em sync se a versão original mudar)
// ============================================================================

interface ReceitaWSResponse {
  cnpj: string
  status?: string
  tipo?: string
  porte?: string
  nome?: string
  fantasia?: string
  abertura?: string
  situacao?: string
  data_situacao?: string
  motivo_situacao?: string
  natureza_juridica?: string
  ultima_atualizacao?: string
  capital_social?: string
  email?: string
  telefone?: string
  efr?: string
  situacao_especial?: string
  data_situacao_especial?: string
  // ReceitaWS retorna endereço no TOP LEVEL (não dentro de 'endereco')
  bairro?: string
  cep?: string
  municipio?: string
  uf?: string
  numero?: string
  complemento?: string
  logradouro?: string
  tipo_logradouro?: string
  endereco?: {
    bairro?: string
    cep?: string
    municipio?: string
    uf?: string
    numero?: string
    complemento?: string
    logradouro?: string
    tipo_logradouro?: string
  }
  // atividade_principal é um ARRAY de {code, text}
  atividade_principal?: { code: string; text: string }[]
  atividades_secundarias?: { code: string; text: string }[]
}

function receitawsToDBFields(r: ReceitaWSResponse): Record<string, any> {
  const end = r.endereco ?? {}
  const bairro = r.bairro ?? end.bairro ?? null
  const cep = r.cep ?? end.cep ?? null
  const municipio = r.municipio ?? end.municipio ?? null
  const uf = r.uf ?? end.uf ?? null
  const numero = r.numero ?? end.numero ?? null
  const complemento = r.complemento ?? end.complemento ?? null
  const logradouro = r.logradouro ?? end.logradouro ?? null
  const tipoLogradouro = r.tipo_logradouro ?? end.tipo_logradouro ?? null

  const atividadePrincipal = Array.isArray(r.atividade_principal)
    ? r.atividade_principal[0]
    : r.atividade_principal
  const cnaeCodigo = atividadePrincipal?.code ?? null
  const cnaeTexto = atividadePrincipal?.text ?? null

  return {
    razaoSocial: r.nome ?? null,
    nomeFantasia: r.fantasia ?? null,
    situacaoCadastral: r.situacao ?? null,
    dataSituacaoCadastral: r.data_situacao ?? null,
    motivoSituacaoCadastral: r.motivo_situacao ?? null,
    naturezaJuridica: r.natureza_juridica ?? null,
    dataAbertura: r.abertura ?? null,
    capitalSocial: r.capital_social ? parseFloat(r.capital_social.replace(',', '.')) : null,
    porte: r.porte ?? null,
    tipoEmpresa: r.tipo ?? null,
    emailReceita: r.email ?? null,
    telefoneReceita: r.telefone ?? null,
    enderecoBairro: bairro,
    enderecoCep: cep,
    enderecoMunicipio: municipio,
    enderecoUf: uf,
    enderecoNumero: numero,
    enderecoComplemento: complemento,
    enderecoLogradouro: logradouro,
    enderecoTipoLogradouro: tipoLogradouro,
    cnaePrincipalCodigo: cnaeCodigo,
    cnaePrincipalTexto: cnaeTexto,
    cnafeSecundarioJson: r.atividades_secundarias?.length ? JSON.stringify(r.atividades_secundarias) : null,
    receitawsJson: JSON.stringify(r),
    receitawsFetchedAt: new Date(),
    receitawsStatus: 'ok',
  }
}

// ============================================================================
// Main
// ============================================================================

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

  const report = { dryRun, total: leads.length, updated, skipped, errors, sample }
  console.log(`[backfill] RESULTADO FINAL`)
  console.log(JSON.stringify(report, null, 2))

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error('[backfill] FATAL:', e)
  process.exit(1)
})
