'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Building2, Search, Loader2, MapPin, Phone, Globe,
  ExternalLink, BadgeCheck, AlertCircle, X, Download,
  CheckSquare, Square, CheckCheck, Pause, Play, Square as StopIcon,
  Copy, Clock,
} from 'lucide-react';
import { toast } from 'sonner';

interface AddressParts {
  streetNumber?: string;
  route?: string;
  sublocality?: string;
  locality?: string;
  administrativeArea?: string;
  postalCode?: string;
  country?: string;
}

interface ProspectLead {
  placeId: string;
  name?: string;
  formattedAddress?: string;
  website?: string;
  phone?: string;
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  businessStatus?: string;
  addressParts?: AddressParts;
  // CNPJ enrichment (filled in by /api/prospeccao/enrich)
  cnpj?: string | null;
  cnpjFormatted?: string | null;
  cnpjSource?: string | null;
  cnpjConfidence?: number | null;
  cnpjFetchStatus?: 'pending' | 'ok' | 'not_found' | 'error';
  receitawsStatus?: 'pending' | 'ok' | 'error';
  razaoSocial?: string | null;
  nomeFantasia?: string | null;
  situacaoCadastral?: string | null;
  dataSituacaoCadastral?: string | null;
  naturezaJuridica?: string | null;
  dataAbertura?: string | null;
  capitalSocial?: number | null;
  porte?: string | null;
  tipoEmpresa?: string | null;
  emailReceita?: string | null;
  telefoneReceita?: string | null;
  enderecoBairro?: string | null;
  enderecoCep?: string | null;
  enderecoMunicipio?: string | null;
  enderecoUf?: string | null;
  enderecoNumero?: string | null;
  enderecoComplemento?: string | null;
  enderecoLogradouro?: string | null;
  enderecoTipoLogradouro?: string | null;
  cnaePrincipalCodigo?: string | null;
  cnaePrincipalTexto?: string | null;
  // Pipeline state
  enriching?: boolean;
  steps?: string[];
}

const STAT_VARIANTS: Record<string, string> = {
  muted: 'bg-zinc-800/60 text-zinc-300 border border-zinc-700/50',
  success: 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/50',
  warning: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  info: 'bg-blue-900/40 text-blue-300 border border-blue-700/50',
  purple: 'bg-purple-900/40 text-purple-300 border border-purple-700/50',
};

const ENRICH_BATCH_SIZE = 5;
const ENRICH_DELAY_MS = 2000; // 2s between batches (ReceitaWS free tier = 3/min)

export default function LeadsTab() {
  // ===== INPUT (single field) =====
  const [searchInput, setSearchInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ===== SESSION RESULTS (in-memory only) =====
  const [leads, setLeads] = useState<ProspectLead[]>([]);
  const [filter, setFilter] = useState<'all' | 'withCnpj' | 'withoutCnpj'>('all');

  // ===== ENRICHMENT LOOP =====
  const [isEnriching, setIsEnriching] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [estimatedTimeLeft, setEstimatedTimeLeft] = useState<string>('');
  const abortRef = useRef<AbortController | null>(null);
  const pauseRef = useRef(false);

  // ===== MULTI-SELECTION (kept from old design) =====
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);

  // ===== STATS =====
  const total = leads.length;
  const withCnpj = leads.filter((l) => l.cnpj).length;
  const withoutCnpj = total - withCnpj;
  const cnpjRate = total > 0 ? Math.round((withCnpj / total) * 100) : 0;

  // Filtered leads based on filter tab
  const filteredLeads = leads.filter((l) => {
    if (filter === 'withCnpj') return !!l.cnpj;
    if (filter === 'withoutCnpj') return !l.cnpj;
    return true;
  });

  // ===== SELECTION HELPERS =====
  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllOnPage = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = filteredLeads.length > 0 && filteredLeads.every((l) => next.has(l.placeId));
      if (allSelected) {
        filteredLeads.forEach((l) => next.delete(l.placeId));
      } else {
        filteredLeads.forEach((l) => next.add(l.placeId));
      }
      return next;
    });
  }, [filteredLeads]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const selectedCount = selectedIds.size;
  const pageSelectedCount = filteredLeads.filter((l) => selectedIds.has(l.placeId)).length;
  const allOnPageSelected = filteredLeads.length > 0 && filteredLeads.every((l) => selectedIds.has(l.placeId));
  const someOnPageSelected = !allOnPageSelected && filteredLeads.some((l) => selectedIds.has(l.placeId));

  // ===== SEARCH (calls /api/prospeccao/search) =====
  const handleSearch = async () => {
    if (!searchInput.trim()) return;
    setSearching(true);
    setError(null);
    // Clear previous session
    setLeads([]);
    setSelectedIds(new Set());
    setProgress({ current: 0, total: 0 });
    setEstimatedTimeLeft('');
    setIsEnriching(false);
    setIsPaused(false);
    pauseRef.current = false;
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    const toastId = toast.loading(`Buscando "${searchInput}" no Google Maps...`, {
      description: 'O scraper abre o Chromium headless e coleta os cards. Pode levar de 30s a 1min.',
    });
    try {
      const res = await fetch('/api/prospeccao/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchInput, pageSize: 40 }),
      });
      if (!res.ok) {
        // HTTP 524 = Cloudflare timeout (origem demorou >100s). Caso típico:
        // o scraper ficou preso em captcha/anti-bot. O Cloudflare cortou a
        // conexão antes do nosso AbortController (80s) — provavelmente o
        // container scraper travou em wait_for_selector. Mensagem clara
        // orienta o usuário a checar logs do scraper.
        if (res.status === 524) {
          throw new Error(
            'Timeout do Cloudflare (HTTP 524) — o scraper demorou mais de 100s. ' +
            'Provável causa: Google Maps está bloqueando o headless (captcha/anti-bot). ' +
            'Diagnóstico: docker compose logs scraper --tail 100. ' +
            'Tente uma busca mais específica (ex: "informatica Palhoça" em vez de "informatica").'
          );
        }
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const newLeads: ProspectLead[] = (data.leads || []).map((l: ProspectLead) => ({
        ...l,
        cnpj: null,
        cnpjFormatted: null,
        cnpjSource: null,
        cnpjConfidence: null,
        cnpjFetchStatus: 'pending',
        receitawsStatus: 'pending',
        enriching: false,
        steps: [],
      }));
      setLeads(newLeads);
      toast.success(`${newLeads.length} negócios encontrados!`, {
        id: toastId,
        description: `Iniciando enriquecimento de CNPJ em ${ENRICH_BATCH_SIZE} leads por batch...`,
        duration: 4000,
      });
      // Auto-start enrichment
      startEnrichment(newLeads);
    } catch (e: any) {
      const msg = e.message || 'Erro ao buscar';
      setError(msg);
      toast.error('Erro na busca', { id: toastId, description: msg, duration: 6000 });
    } finally {
      setSearching(false);
    }
  };

  // ===== ENRICHMENT LOOP (client-side, like Verificar Números) =====
  const startEnrichment = async (leadsToEnrich: ProspectLead[]) => {
    if (leadsToEnrich.length === 0) return;
    setIsEnriching(true);
    setIsPaused(false);
    pauseRef.current = false;
    abortRef.current = new AbortController();

    const totalToEnrich = leadsToEnrich.length;
    let checkedCount = 0;
    const t0 = Date.now();

    // Mark all as enriching
    setLeads((prev) => prev.map((l) => ({ ...l, enriching: true })));
    setProgress({ current: 0, total: totalToEnrich });

    // Process in batches
    for (let i = 0; i < leadsToEnrich.length; i += ENRICH_BATCH_SIZE) {
      // Check abort
      if (abortRef.current?.signal.aborted) break;

      // Pause check
      while (pauseRef.current && !abortRef.current?.signal.aborted) {
        await new Promise((r) => setTimeout(r, 500));
      }
      if (abortRef.current?.signal.aborted) break;

      const batch = leadsToEnrich.slice(i, i + ENRICH_BATCH_SIZE);
      const batchIds = new Set(batch.map((l) => l.placeId));

      try {
        const res = await fetch('/api/prospeccao/enrich', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leads: batch }),
          signal: abortRef.current?.signal,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }

        const data = await res.json();
        const enriched: ProspectLead[] = data.results || [];

        // Update leads with enriched data
        setLeads((prev) =>
          prev.map((l) => {
            const found = enriched.find((e) => e.placeId === l.placeId);
            if (found) {
              return {
                ...l,
                ...found,
                enriching: false,
              };
            }
            return l;
          })
        );

        checkedCount += batch.length;
        setProgress({ current: checkedCount, total: totalToEnrich });

        // ETA
        const elapsedSec = (Date.now() - t0) / 1000;
        const rate = checkedCount / elapsedSec;
        const remainingSec = (totalToEnrich - checkedCount) / rate;
        if (remainingSec > 60) {
          setEstimatedTimeLeft(`~${Math.ceil(remainingSec / 60)} min restante(s)`);
        } else if (remainingSec > 0) {
          setEstimatedTimeLeft(`~${Math.ceil(remainingSec)}s restante(s)`);
        }

        // Delay between batches (skip on last batch)
        if (i + ENRICH_BATCH_SIZE < leadsToEnrich.length) {
          await new Promise((r) => setTimeout(r, ENRICH_DELAY_MS));
        }
      } catch (e: any) {
        if (e.name === 'AbortError') break;
        console.error('[enrich] batch error:', e);
        // Mark batch as errored
        setLeads((prev) =>
          prev.map((l) => {
            if (batchIds.has(l.placeId)) {
              return { ...l, enriching: false, cnpjFetchStatus: 'error' };
            }
            return l;
          })
        );
        checkedCount += batch.length;
        setProgress({ current: checkedCount, total: totalToEnrich });
        toast.error('Erro em batch de enriquecimento', {
          description: e.message,
          duration: 5000,
        });
      }
    }

    setIsEnriching(false);
    setEstimatedTimeLeft('');
    if (!abortRef.current?.signal.aborted) {
      const finalWithCnpj = leadsToEnrich.length;
      toast.success('Enriquecimento concluído!', {
        description: `${finalWithCnpj} leads processados`,
        duration: 4000,
      });
    }
    abortRef.current = null;
  };

  const togglePause = () => {
    const newPaused = !isPaused;
    setIsPaused(newPaused);
    pauseRef.current = newPaused;
    toast.info(newPaused ? 'Enriquecimento pausado' : 'Enriquecimento retomado', { duration: 2000 });
  };

  const cancelEnrichment = () => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    setIsEnriching(false);
    setIsPaused(false);
    pauseRef.current = false;
    setEstimatedTimeLeft('');
    setLeads((prev) => prev.map((l) => ({ ...l, enriching: false })));
    toast.info('Enriquecimento cancelado', { duration: 2000 });
  };

  // ===== EXPORT CSV =====
  const handleExportCSV = () => {
    const selected = leads.filter((l) => selectedIds.has(l.placeId));
    if (selected.length === 0) {
      toast.warning('Selecione ao menos um lead para exportar.');
      return;
    }
    setExporting(true);
    try {
      const headers = [
        'Nome', 'CNPJ', 'CNPJ Formatado', 'Razão Social', 'Nome Fantasia',
        'Situação Cadastral', 'CNAE', 'Telefone', 'Website', 'Endereço',
        'Bairro', 'Cidade', 'UF', 'CEP', 'Email Receita', 'Telefone Receita',
        'Rating', 'Avaliações', 'CNPJ Source', 'CNPJ Confiança',
      ];
      const rows = selected.map((l) => [
        l.name || '',
        l.cnpj || '',
        l.cnpjFormatted || '',
        l.razaoSocial || '',
        l.nomeFantasia || '',
        l.situacaoCadastral || '',
        `${l.cnaePrincipalCodigo || ''} ${l.cnaePrincipalTexto || ''}`.trim(),
        l.phone || '',
        l.website || '',
        l.formattedAddress || '',
        l.enderecoBairro || '',
        l.enderecoMunicipio || l.addressParts?.locality || '',
        l.enderecoUf || l.addressParts?.administrativeArea || '',
        l.enderecoCep || l.addressParts?.postalCode || '',
        l.emailReceita || '',
        l.telefoneReceita || '',
        l.rating?.toString() || '',
        l.userRatingCount?.toString() || '',
        l.cnpjSource || '',
        l.cnpjConfidence?.toString() || '',
      ]);
      const csv = [headers, ...rows]
        .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n');
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const now = new Date();
      const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
      a.href = url;
      a.download = `prospeccao_${stamp}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`CSV exportado com ${selected.length} lead(s)`, { duration: 3000 });
    } catch (e: any) {
      toast.error('Erro ao exportar CSV', { description: e.message, duration: 5000 });
    } finally {
      setExporting(false);
    }
  };

  // ===== COPY VALID (with CNPJ) =====
  const handleCopyValid = async () => {
    const selected = leads.filter((l) => selectedIds.has(l.placeId) && l.cnpj);
    if (selected.length === 0) {
      toast.warning('Selecione ao menos um lead com CNPJ para copiar.');
      return;
    }
    try {
      const text = selected
        .map((l) => `${l.cnpjFormatted}\t${l.razaoSocial || l.name || ''}\t${l.phone || ''}`)
        .join('\n');
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success(`${selected.length} leads com CNPJ copiados`, { duration: 3000 });
    } catch (e: any) {
      toast.error('Erro ao copiar', { description: e.message });
    }
  };

  // ===== CLEANUP ON UNMOUNT =====
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-primary/10 p-2.5">
          <Building2 className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Prospecção</h1>
          <p className="text-sm text-muted-foreground">
            Busca de empresas no Google Maps + descoberta automática de CNPJ
          </p>
        </div>
      </div>

      {/* Stats cards */}
      {total > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Total" value={total} variant="muted" />
          <StatCard label="Com CNPJ" value={withCnpj} variant="success" />
          <StatCard label="Sem CNPJ" value={withoutCnpj} variant="warning" />
          <StatCard label="Taxa CNPJ" value={`${cnpjRate}%`} variant="info" />
        </div>
      )}

      {/* Search bar (single input) */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Search className="h-4 w-4 text-primary" />
          Buscar no Google Maps
          <span className="text-xs font-normal text-muted-foreground">
            (digite o tipo de negócio + cidade, ex: &quot;informatica Palhoça&quot;)
          </span>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="ex: informatica Palhoça, pizzaria Florianópolis, restaurante São José..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            disabled={searching}
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
          />
          <button
            onClick={handleSearch}
            disabled={searching || !searchInput.trim()}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {searching ? 'Buscando...' : 'Buscar'}
          </button>
        </div>
        {searching && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" /> O scraper abre o Google Maps no Chromium headless e coleta
            os cards de negócios. Pode levar de 30s a 1min.
          </p>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />{error}
        </div>
      )}

      {/* Progress + Enrichment controls */}
      {isEnriching && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  Enriquecendo CNPJ: {progress.current}/{progress.total}
                </p>
                {estimatedTimeLeft && (
                  <p className="text-xs text-muted-foreground">{estimatedTimeLeft}</p>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={togglePause}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground hover:bg-muted/50"
              >
                {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                {isPaused ? 'Retomar' : 'Pausar'}
              </button>
              <button
                onClick={cancelEnrichment}
                className="inline-flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/20"
              >
                <StopIcon className="h-4 w-4" />
                Cancelar
              </button>
            </div>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{
                width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Filter tabs */}
      {total > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 rounded-md border border-border bg-card p-1">
            <FilterTabButton active={filter === 'all'} onClick={() => setFilter('all')}>
              Todos ({total})
            </FilterTabButton>
            <FilterTabButton active={filter === 'withCnpj'} onClick={() => setFilter('withCnpj')}>
              Com CNPJ ({withCnpj})
            </FilterTabButton>
            <FilterTabButton active={filter === 'withoutCnpj'} onClick={() => setFilter('withoutCnpj')}>
              Sem CNPJ ({withoutCnpj})
            </FilterTabButton>
          </div>
        </div>
      )}

      {/* Selection bar */}
      {filteredLeads.length > 0 && (
        <div className="flex items-center gap-3 rounded-md border border-border bg-card px-4 py-2 text-sm flex-wrap">
          <button
            onClick={selectAllOnPage}
            title={allOnPageSelected ? 'Desselecionar página' : 'Selecionar página'}
            className="inline-flex items-center gap-1.5 text-foreground hover:text-primary"
          >
            {allOnPageSelected ? (
              <CheckSquare className="h-4 w-4 text-primary" />
            ) : someOnPageSelected ? (
              <CheckCheck className="h-4 w-4 text-amber-500" />
            ) : (
              <Square className="h-4 w-4" />
            )}
            <span>{allOnPageSelected ? 'Desselecionar' : 'Selecionar página'}</span>
          </button>
          <span className="text-muted-foreground">|</span>
          <span className="text-muted-foreground">
            Página: {pageSelectedCount}/{filteredLeads.length}
          </span>
          {selectedCount > 0 && (
            <>
              <span className="text-muted-foreground">|</span>
              <span className="font-medium text-primary">
                {selectedCount} selecionado{selectedCount === 1 ? '' : 's'} no total
              </span>
            </>
          )}
        </div>
      )}

      {/* Leads grid */}
      {searching ? (
        <div className="rounded-lg border border-border bg-card py-16 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">Buscando negócios no Google Maps...</p>
        </div>
      ) : filteredLeads.length === 0 ? (
        total === 0 ? (
          <div className="rounded-lg border border-border bg-card py-16 text-center text-muted-foreground">
            <Building2 className="mx-auto h-10 w-10 opacity-40" />
            <p className="mt-3 text-sm">Digite acima para começar uma prospecção.</p>
            <p className="mt-1 text-xs opacity-70">
              Os resultados aparecem aqui e o CNPJ é enriquecido automaticamente.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card py-12 text-center text-muted-foreground">
            Nenhum lead nesta categoria.
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filteredLeads.map((lead) => (
            <LeadCard
              key={lead.placeId}
              lead={lead}
              isSelected={selectedIds.has(lead.placeId)}
              onToggleSelect={() => toggleSelection(lead.placeId)}
            />
          ))}
        </div>
      )}

      {/* Floating bulk action bar */}
      {selectedCount > 0 && (
        <BulkActionBar
          count={selectedCount}
          onClear={clearSelection}
          onExportCSV={handleExportCSV}
          exporting={exporting}
          onCopyValid={handleCopyValid}
          copied={copied}
        />
      )}
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================

function StatCard({ label, value, variant = 'muted' }: { label: string; value: number | string; variant?: keyof typeof STAT_VARIANTS; }) {
  return (
    <div className={`rounded-lg p-3 ${STAT_VARIANTS[variant]}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs uppercase tracking-wide opacity-70">{label}</div>
    </div>
  );
}

function FilterTabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode; }) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-3 py-1 text-xs font-medium transition ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function CnpjStatusBadge({ lead }: { lead: ProspectLead }) {
  if (lead.enriching) {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-blue-900/50 px-2 py-0.5 text-xs text-blue-300">
        <Loader2 className="h-3 w-3 animate-spin" /> buscando CNPJ...
      </span>
    );
  }
  if (!lead.cnpj) {
    if (lead.cnpjFetchStatus === 'not_found')
      return (
        <span className="inline-flex items-center gap-1 rounded bg-zinc-700/60 px-2 py-0.5 text-xs text-zinc-300">
          <X className="h-3 w-3" /> não encontrado
        </span>
      );
    if (lead.cnpjFetchStatus === 'error')
      return (
        <span className="inline-flex items-center gap-1 rounded bg-red-900/50 px-2 py-0.5 text-xs text-red-300">
          <AlertCircle className="h-3 w-3" /> erro
        </span>
      );
    return (
      <span className="inline-flex items-center gap-1 rounded bg-amber-900/50 px-2 py-0.5 text-xs text-amber-300">
        pendente
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded bg-emerald-900 px-2 py-0.5 text-xs font-medium text-white">
      <BadgeCheck className="h-3 w-3" />
      {lead.cnpjFormatted || lead.cnpj}
      {lead.cnpjConfidence != null && <span className="opacity-80">({lead.cnpjConfidence}%)</span>}
    </span>
  );
}

function LeadCard({ lead, isSelected, onToggleSelect }: {
  lead: ProspectLead;
  isSelected: boolean;
  onToggleSelect: () => void;
}) {
  return (
    <div
      className={`rounded-lg border bg-card p-4 shadow-sm transition hover:shadow-md ${
        isSelected ? 'border-primary ring-2 ring-primary/30' : 'border-border'
      }`}
    >
      <div className="flex items-start gap-2">
        <button
          onClick={onToggleSelect}
          title={isSelected ? 'Remover da seleção' : 'Selecionar'}
          className="mt-0.5 shrink-0"
          aria-label={isSelected ? 'Remover da seleção' : 'Selecionar'}
        >
          {isSelected ? (
            <CheckSquare className="h-5 w-5 text-primary" />
          ) : (
            <Square className="h-5 w-5 text-muted-foreground hover:text-foreground" />
          )}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="flex-1 text-left font-semibold text-foreground truncate">
              {lead.name || lead.razaoSocial || '(sem nome)'}
            </h3>
            <CnpjStatusBadge lead={lead} />
          </div>
          {lead.nomeFantasia && lead.nomeFantasia !== lead.name && (
            <p className="mt-0.5 text-sm text-muted-foreground">{lead.nomeFantasia}</p>
          )}
        </div>
      </div>
      {lead.formattedAddress && (
        <p className="mt-2 flex items-start gap-1 text-xs text-muted-foreground">
          <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
          {lead.formattedAddress}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        {lead.phone && (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Phone className="h-3 w-3" /> {lead.phone}
          </span>
        )}
        {lead.website && (
          <a
            href={lead.website}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
          >
            <Globe className="h-3 w-3" /> site
          </a>
        )}
        {lead.googleMapsUri && (
          <a
            href={lead.googleMapsUri}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
          >
            <ExternalLink className="h-3 w-3" /> maps
          </a>
        )}
        {lead.situacaoCadastral && (
          <span className="inline-flex items-center gap-1 rounded bg-zinc-700/40 px-1.5 py-0.5 text-zinc-300">
            {lead.situacaoCadastral}
          </span>
        )}
      </div>
      {lead.cnaePrincipalTexto && (
        <p className="mt-2 text-xs text-muted-foreground/80">CNAE: {lead.cnaePrincipalTexto}</p>
      )}
      {lead.cnpjSource && (
        <p className="mt-1 text-[10px] text-muted-foreground/60">fonte: {lead.cnpjSource}</p>
      )}
    </div>
  );
}

function BulkActionBar({ count, onClear, onExportCSV, exporting, onCopyValid, copied }: {
  count: number;
  onClear: () => void;
  onExportCSV: () => void;
  exporting: boolean;
  onCopyValid: () => void;
  copied: boolean;
}) {
  return (
    <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-2xl">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
            {count}
          </span>
          <span className="text-sm font-medium text-foreground">
            {count === 1 ? 'lead selecionado' : 'leads selecionados'}
          </span>
        </div>
        <span className="text-muted-foreground">|</span>
        <button
          onClick={onExportCSV}
          disabled={exporting}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Exportar CSV
        </button>
        <button
          onClick={onCopyValid}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted/50"
        >
          {copied ? <CheckCheck className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
          Copiar com CNPJ
        </button>
        <button
          onClick={onClear}
          title="Desmarcar seleção"
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50"
        >
          <X className="h-4 w-4" />
          Desmarcar
        </button>
      </div>
    </div>
  );
}
