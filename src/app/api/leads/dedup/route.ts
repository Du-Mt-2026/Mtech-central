// /opt/octupuszap/src/app/api/leads/dedup/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Implementação simples de Levenshtein para Node
function levenshteinRatio(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length || !b.length) return 1;
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n] / Math.max(m, n);
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(ltda|eireli|me|epp|sa|s\/a|cpf|cnpj|comercio|comercio de|distribuidora|distribuidor)\b/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const dryRun = body.dryRun !== false; // default true
  const limit = Math.min(5000, body.limit || 1000);

  // Carrega leads sem duplicateOfId (ordenados por createdAt asc — o mais antigo é o "original")
  const leads = await prisma.lead.findMany({
    where: { duplicateOfId: null, name: { not: null } },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true, name: true, postalCode: true, locality: true, administrativeArea: true, createdAt: true },
  });

  const duplicates: { leadId: string; leadName: string; duplicateOfId: string; duplicateOfName: string; reason: string }[] = [];

  // Comparação O(n²) — aceitável para n=1000, otimizar depois com buckets por CEP/localidade
  for (let i = 0; i < leads.length; i++) {
    for (let j = i + 1; j < leads.length; j++) {
      const a = leads[i], b = leads[j];
      if (!a.name || !b.name) continue;

      const na = normalizeName(a.name);
      const nb = normalizeName(b.name);
      if (na.length < 3 || nb.length < 3) continue;

      const ratio = levenshteinRatio(na, nb);
      if (ratio > 0.15) continue; // >15% diferente

      let reason = '';
      if (a.postalCode && b.postalCode && a.postalCode === b.postalCode) {
        reason = `nome similar (${(100 - ratio * 100).toFixed(0)}%) + mesmo CEP ${a.postalCode}`;
      } else if (
        a.locality && b.locality &&
        a.administrativeArea && b.administrativeArea &&
        a.locality.toLowerCase() === b.locality.toLowerCase() &&
        a.administrativeArea.toUpperCase() === b.administrativeArea.toUpperCase()
      ) {
        reason = `nome similar (${(100 - ratio * 100).toFixed(0)}%) + mesma localidade`;
      } else {
        continue;
      }

      duplicates.push({
        leadId: b.id,
        leadName: b.name,
        duplicateOfId: a.id,
        duplicateOfName: a.name!,
        reason,
      });
      break; // b já tem um "original", não precisa comparar com mais ninguém
    }
  }

  let marked = 0;
  if (!dryRun && duplicates.length > 0) {
    await prisma.lead.updateMany({
      where: { id: { in: duplicates.map((d) => d.leadId) } },
      data: { duplicateOfId: duplicates[0].duplicateOfId }, // será sobrescrito abaixo
    });
    // Atualizar um por um para preservar duplicateOfId correto por lead
    for (const d of duplicates) {
      await prisma.lead.update({ where: { id: d.leadId }, data: { duplicateOfId: d.duplicateOfId } });
      marked++;
    }
  }

  return NextResponse.json({
    scanned: leads.length,
    duplicatesFound: duplicates.length,
    marked,
    dryRun,
    sample: duplicates.slice(0, 20),
  });
}
