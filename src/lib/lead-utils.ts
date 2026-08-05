// /opt/octupuszap/src/lib/lead-utils.ts
// Utilidades: scoring, anti-duplicidade, normalização de nome

export interface LeadForScoring {
  cnpj?: string | null;
  website?: string | null;
  phone?: string | null;
  situacaoCadastral?: string | null;
  businessStatus?: string | null;
  rating?: number | null;
  userRatingCount?: number | null;
}

/**
 * Score 0-100 baseado em completude + qualidade do lead.
 *  - Tem CNPJ: +30
 *  - CNPJ ativo: +20
 *  - Tem website: +15
 *  - Tem telefone: +15
 *  - Operational no Google: +10
 *  - Rating >= 4.0 com >= 50 reviews: +10
 */
export function computeScore(lead: LeadForScoring): number {
  let score = 0;
  if (lead.cnpj) score += 30;
  if (lead.situacaoCadastral && lead.situacaoCadastral.toUpperCase() === 'ATIVA') score += 20;
  if (lead.website) score += 15;
  if (lead.phone) score += 15;
  if (lead.businessStatus && lead.businessStatus.toUpperCase() === 'OPERATIONAL') score += 10;
  if (lead.rating && lead.rating >= 4.0 && (lead.userRatingCount || 0) >= 50) score += 10;
  return Math.min(100, score);
}

/**
 * Normaliza nome para comparação fuzzy:
 *  - lowercase
 *  - remove acentos
 *  - remove "ltda", "me", "epp", "cpf", "cnpj", etc
 *  - remove pontuação
 *  - colapsa espaços
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(ltda|eireli|me|epp|sa|s\/a|cpf|cnpj|comercio|comercio de|distribuidora|distribuidor)\b/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Distância de Levenshtein normalizada (0-1).
 * 0 = idêntico, 1 = totalmente diferente.
 */
export function levenshteinRatio(a: string, b: string): number {
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

/**
 * Verifica se dois leads são provavelmente o mesmo.
 * Critério: mesmo placeId OU (nome similar >= 85% E mesmo postalCode OU mesma localidade+UF)
 */
export function isLikelyDuplicate(
  a: { placeId: string; name?: string | null; postalCode?: string | null; locality?: string | null; administrativeArea?: string | null; },
  b: { placeId: string; name?: string | null; postalCode?: string | null; locality?: string | null; administrativeArea?: string | null; }
): boolean {
  if (a.placeId && a.placeId === b.placeId) return true;
  if (!a.name || !b.name) return false;
  const nameRatio = levenshteinRatio(normalizeName(a.name), normalizeName(b.name));
  if (nameRatio > 0.15) return false; // >15% diferente = não é dup
  if (a.postalCode && b.postalCode && a.postalCode === b.postalCode) return true;
  if (a.locality && b.locality && a.administrativeArea && b.administrativeArea &&
      a.locality.toLowerCase() === b.locality.toLowerCase() &&
      a.administrativeArea.toUpperCase() === b.administrativeArea.toUpperCase()) return true;
  return false;
}

/**
 * Converte score numérico para label de estrelas.
 */
export function scoreToStars(score: number | null | undefined): { stars: string; color: string } {
  if (score === null || score === undefined) return { stars: '—', color: 'zinc' };
  if (score >= 80) return { stars: '★★★★★', color: 'emerald' };
  if (score >= 60) return { stars: '★★★★', color: 'lime' };
  if (score >= 40) return { stars: '★★★', color: 'amber' };
  if (score >= 20) return { stars: '★★', color: 'orange' };
  return { stars: '★', color: 'red' };
}

export const TAG_COLORS = [
  'zinc', 'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald',
  'teal', 'cyan', 'blue', 'sky', 'indigo', 'violet', 'purple', 'pink',
] as const;

export const TAG_COLOR_CLASSES: Record<string, { bg: string; text: string; border: string }> = {
  zinc: { bg: 'bg-zinc-900/60', text: 'text-zinc-300', border: 'border-zinc-700/50' },
  red: { bg: 'bg-red-900/40', text: 'text-red-300', border: 'border-red-700/50' },
  orange: { bg: 'bg-orange-900/40', text: 'text-orange-300', border: 'border-orange-700/50' },
  amber: { bg: 'bg-amber-900/40', text: 'text-amber-300', border: 'border-amber-700/50' },
  yellow: { bg: 'bg-yellow-900/40', text: 'text-yellow-300', border: 'border-yellow-700/50' },
  lime: { bg: 'bg-lime-900/40', text: 'text-lime-300', border: 'border-lime-700/50' },
  green: { bg: 'bg-green-900/40', text: 'text-green-300', border: 'border-green-700/50' },
  emerald: { bg: 'bg-emerald-900/40', text: 'text-emerald-300', border: 'border-emerald-700/50' },
  teal: { bg: 'bg-teal-900/40', text: 'text-teal-300', border: 'border-teal-700/50' },
  cyan: { bg: 'bg-cyan-900/40', text: 'text-cyan-300', border: 'border-cyan-700/50' },
  blue: { bg: 'bg-blue-900/40', text: 'text-blue-300', border: 'border-blue-700/50' },
  sky: { bg: 'bg-sky-900/40', text: 'text-sky-300', border: 'border-sky-700/50' },
  indigo: { bg: 'bg-indigo-900/40', text: 'text-indigo-300', border: 'border-indigo-700/50' },
  violet: { bg: 'bg-violet-900/40', text: 'text-violet-300', border: 'border-violet-700/50' },
  purple: { bg: 'bg-purple-900/40', text: 'text-purple-300', border: 'border-purple-700/50' },
  pink: { bg: 'bg-pink-900/40', text: 'text-pink-300', border: 'border-pink-700/50' },
};

export function tagColorClasses(color: string) {
  return TAG_COLOR_CLASSES[color] || TAG_COLOR_CLASSES.zinc;
}
