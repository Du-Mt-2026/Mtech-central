'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Building2, Search, Loader2, RefreshCw, MapPin, Phone, Globe,
  ExternalLink, BadgeCheck, AlertCircle, X, Filter, Download,
  CheckSquare, Square, Trash2, CheckCheck, ChevronsUpDown,
} from 'lucide-react';
import { toast } from 'sonner';

interface Lead {
  id: string; placeId: string; name: string | null;
  formattedAddress: string | null; website: string | null;
  phone: string | null; rating: number | null;
  userRatingCount: number | null; googleMapsUri: string | null;
  businessStatus: string | null; locality: string | null;
  administrativeArea: string | null; postalCode: string | null;
  cnpj: string | null; cnpjFormatted: string | null;
  cnpjSource: string | null; cnpjConfidence: number | null;
  cnpjFetchStatus: string; cnpjFetchedAt: string | null;
  razaoSocial: string | null; nomeFantasia: string | null;
  situacaoCadastral: string | null; dataSituacaoCadastral: string | null;
  motivoSituacaoCadastral: string | null; naturezaJuridica: string | null;
  dataAbertura: string | null; capitalSocial: number | null;
  porte: string | null; tipoEmpresa: string | null;
  emailReceita: string | null; telefoneReceita: string | null;
  enderecoBairro: string | null; enderecoCep: string | null;
  enderecoMunicipio: string | null; enderecoUf: string | null;
  enderecoNumero: string | null; enderecoComplemento: string | null;
  enderecoLogradouro: string | null;
  cnaePrincipalCodigo: string | null; cnaePrincipalTexto: string | null;
  receitawsStatus: string; receitawsFetchedAt: string | null;
  createdAt: string;
  pipelineStatus?: string;
  score?: number | null;
}

interface Stats {
  total: number; withCnpj: number; withoutCnpj: number;
  receitawsOk: number; receitawsPending: number;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

const PIPELINE_STATUS_OPTIONS = [
  { value: '', label: 'Todos status' },
  { value: 'novo', label: 'Novo' },
  { value: 'contatado', label: 'Contatado' },
  { value: 'qualificado', label: 'Qualificado' },
  { value: 'cliente', label: 'Cliente' },
  { value: 'descartado', label: 'Descartado' },
];

const STAT_VARIANTS: Record<string, string> = {
  muted: 'bg-zinc-800/60 text-zinc-300 border border-zinc-700/50',
  success: 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/50',
  warning: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  info: 'bg-blue-900/40 text-blue-300 border border-blue-700/50',
  purple: 'bg-purple-900/40 text-purple-300 border border-purple-700/50',
};

export default function LeadsTab() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [savedSearchInput, setSavedSearchInput] = useState('');

  // Filtros para a busca no Google Places (categoria 4)
  const [placesCity, setPlacesCity] = useState('');
  const [placesState, setPlacesState] = useState('');

  // Filtros para os leads salvos (categoria 2)
  const [filterCity, setFilterCity] = useState('');
  const [filterState, setFilterState] = useState('');
  const [filterCnpjStatus, setFilterCnpjStatus] = useState('all');
  const [filterReceitaws, setFilterReceitaws] = useState('all');
  const [filterPipelineStatus, setFilterPipelineStatus] = useState('');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [fetchingCnpjFor, setFetchingCnpjFor] = useState<string | null>(null);

  // ===== MULTI-SELEÇÃO (persiste entre páginas) =====
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);

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
      // Se todos da página já estão selecionados → desseleciona SÓ os da página
      const allSelected = leads.length > 0 && leads.every((l) => next.has(l.id));
      if (allSelected) {
        leads.forEach((l) => next.delete(l.id));
      } else {
        leads.forEach((l) => next.add(l.id));
      }
      return next;
    });
  }, [leads]);

  const selectAllMatching = useCallback(async () => {
    setSelectingAll(true);
    const toastId = toast.loading('Selecionando todos os leads que casam com o filtro...');
    try {
      // Busca TODOS os IDs que casam com o filtro atual (sem paginação)
      const params = new URLSearchParams({
        page: '1',
        pageSize: String(Math.min(total || 1000, 1000)),
        cnpjStatus: filterCnpjStatus,
        receitawsStatus: filterReceitaws,
      });
      if (savedSearchInput.trim()) params.set('query', savedSearchInput.trim());
      if (filterCity) params.set('city', filterCity);
      if (filterState) params.set('state', filterState);
      if (filterPipelineStatus) params.set('pipelineStatus', filterPipelineStatus);

      const res = await fetch(`/api/leads?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const allLeadIds: string[] = (data.leads || []).map((l: Lead) => l.id);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        allLeadIds.forEach((id) => next.add(id));
        return next;
      });
      setAllMatchingSelected(true);
      toast.success(`${allLeadIds.length} leads selecionados`, {
        id: toastId,
        description: 'Seleção persiste entre páginas',
        duration: 4000,
      });
    } catch (e: any) {
      toast.error('Erro ao selecionar todos', {
        id: toastId,
        description: e.message || 'Erro desconhecido',
        duration: 6000,
      });
    } finally { setSelectingAll(false); }
  }, [total, savedSearchInput, filterCity, filterState, filterCnpjStatus, filterReceitaws, filterPipelineStatus]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const selectedCount = selectedIds.size;
  const pageSelectedCount = leads.filter((l) => selectedIds.has(l.id)).length;
  const allOnPageSelected = leads.length > 0 && leads.every((l) => selectedIds.has(l.id));
  const someOnPageSelected = !allOnPageSelected && leads.some((l) => selectedIds.has(l.id));

  // Estado 2: tudo selecionado — quando TODOS os leads que casam com o filtro estão selecionados
  // (só verificamos isso se a seleção for > 0 e o usuário já tiver clicado em "Selecionar tudo")
  const [allMatchingSelected, setAllMatchingSelected] = useState(false);

  // Reset allMatchingSelected quando filtros mudam (porque a lista filtrada mudou)
  useEffect(() => {
    setAllMatchingSelected(false);
  }, [savedSearchInput, filterCity, filterState, filterCnpjStatus, filterReceitaws, filterPipelineStatus, pageSize]);

  // Detecta quando o usuário desseleciona manualmente algum lead — sai do estado "tudo selecionado"
  useEffect(() => {
    if (allMatchingSelected && selectedCount === 0) {
      setAllMatchingSelected(false);
    }
  }, [selectedCount, allMatchingSelected]);

  // ===== FETCH COM PAGE OVERRIDE (corrige bug #3) =====
  const fetchLeads = useCallback(async (pageOverride?: number) => {
    const actualPage = pageOverride ?? page;
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({
        page: String(actualPage), pageSize: String(pageSize),
        cnpjStatus: filterCnpjStatus, receitawsStatus: filterReceitaws,
      });
      if (savedSearchInput.trim()) params.set('query', savedSearchInput.trim());
      if (filterCity) params.set('city', filterCity);
      if (filterState) params.set('state', filterState);
      if (filterPipelineStatus) params.set('pipelineStatus', filterPipelineStatus);
      const res = await fetch(`/api/leads?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setLeads(data.leads || []);
      setTotal(data.total || 0);
      setStats(data.stats || null);
      // Se a página atual não tem leads mas há leads no total, volta para página 1
      if ((data.leads || []).length === 0 && (data.total || 0) > 0 && actualPage > 1) {
        setPage(1);
      }
    } catch (e: any) {
      setError(e.message || 'Erro ao carregar leads');
    } finally { setLoading(false); }
  }, [page, pageSize, savedSearchInput, filterCity, filterState, filterCnpjStatus, filterReceitaws, filterPipelineStatus]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  // ===== EXPORT CSV =====
  const handleExportCSV = async () => {
    if (selectedCount === 0) {
      toast.warning('Selecione ao menos um lead para exportar.');
      return;
    }
    setExporting(true);
    const toastId = toast.loading(`Exportando ${selectedCount} lead(s) para CSV...`);
    try {
      const res = await fetch('/api/leads/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadIds: Array.from(selectedIds), format: 'csv' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const now = new Date();
      const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
      a.href = url;
      a.download = `leads_${stamp}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`CSV exportado com ${selectedCount} lead(s)`, {
        id: toastId,
        description: `Arquivo: leads_${stamp}.csv`,
        duration: 5000,
      });
    } catch (e: any) {
      toast.error('Erro ao exportar CSV', {
        id: toastId,
        description: e.message || 'Erro desconhecido',
        duration: 6000,
      });
    } finally { setExporting(false); }
  };

  const handleSearch = async () => {
    if (!searchInput.trim()) return;
    setSearching(true); setError(null);
    try {
      const res = await fetch('/api/leads/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: searchInput,
          pageSize: 20,
          city: placesCity || undefined,
          state: placesState || undefined,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      await fetchLeads(1);
      setPage(1);
      if (data.count > 0) {
        toast.success(`${data.count} leads encontrados no Google Places!`, { duration: 4000 });
      } else {
        toast.warning('Nenhum resultado encontrado no Google Places.', { duration: 5000 });
        setError('Nenhum resultado encontrado no Google Places.');
      }
    } catch (e: any) {
      setError(e.message || 'Erro ao buscar no Google Places');
    } finally { setSearching(false); }
  };

  // handleSearchSaved com page override (corrige bug #3)
  const handleSearchSaved = async () => {
    if (!savedSearchInput.trim()) return;
    setPage(1);
    await fetchLeads(1);
  };

  const handleFetchCnpj = async (lead: Lead, force = false) => {
    setFetchingCnpjFor(lead.id);
    const leadName = lead.name || lead.razaoSocial || 'Lead';
    const toastId = toast.loading(`Buscando CNPJ para "${leadName}"...`, {
      description: force ? 'Forçando reprocessamento (scraper + receitaws)' : 'Consultando scraper e ReceitaWS',
    });
    try {
      const res = await fetch(`/api/leads/${lead.id}/fetch-cnpj`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (selectedLead?.id === lead.id) setSelectedLead(data.lead);
      await fetchLeads();

      if (data.ok && data.cnpj) {
        const sourceLabel = {
          'scraper': 'encontrado no site',
          'bigquery': 'encontrado via BigQuery',
          'existing': 'CNPJ existente',
        }[data.cnpjSource] || data.cnpjSource;
        const razao = data.lead?.razaoSocial ? ` - ${data.lead.razaoSocial}` : '';
        toast.success(`CNPJ ${data.cnpj}${razao}`, {
          id: toastId,
          description: `Fonte: ${sourceLabel}${data.lead?.situacaoCadastral ? ` | Situação: ${data.lead.situacaoCadastral}` : ''}`,
          duration: 6000,
        });
      } else if (data.steps?.includes('scraper:not_found') && data.steps?.includes('all:not_found')) {
        toast.warning('CNPJ não encontrado', {
          id: toastId,
          description: 'Scraper não localizou CNPJ no site. BigQuery não configurado.',
          duration: 7000,
        });
      } else if (data.cached) {
        toast.info('CNPJ já estava enriquecido', {
          id: toastId,
          description: 'Use "Reprocessar (force)" para buscar novamente.',
          duration: 5000,
        });
      } else {
        toast.warning('CNPJ não encontrado', {
          id: toastId,
          description: `Etapas: ${(data.steps || []).join(', ')}`,
          duration: 6000,
        });
      }
    } catch (e: any) {
      toast.error('Erro ao buscar CNPJ', {
        id: toastId,
        description: e.message || 'Erro desconhecido',
        duration: 7000,
      });
      setError(e.message || 'Erro ao buscar CNPJ');
    } finally { setFetchingCnpjFor(null); }
  };

  // AUTO-FETCH: quando abrir o dialog de detalhes, se o lead tem CNPJ mas
  // receitawsStatus !== 'ok', busca automaticamente os dados do ReceitaWS
  useEffect(() => {
    if (!selectedLead) return;
    if (selectedLead.cnpj && selectedLead.receitawsStatus !== 'ok' && !fetchingCnpjFor) {
      handleFetchCnpj(selectedLead, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLead?.id]);

  // Reset page quando filtros mudam (corrige bug #3 - parte 2)
  useEffect(() => {
    setPage(1);
  }, [savedSearchInput, filterCity, filterState, filterCnpjStatus, filterReceitaws, filterPipelineStatus, pageSize]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-primary/10 p-2.5">
          <Building2 className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Leads &amp; CNPJ</h1>
          <p className="text-sm text-muted-foreground">Busca de empresas no Google Places + descoberta de CNPJ</p>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatCard label="Total" value={stats.total} variant="muted" />
          <StatCard label="Com CNPJ" value={stats.withCnpj} variant="success" />
          <StatCard label="Sem CNPJ" value={stats.withoutCnpj} variant="warning" />
        </div>
      )}

      {/* Container 1: Buscar no Places + FILTROS PRÓPRIOS (#4) */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Search className="h-4 w-4 text-primary" />
          Buscar no Google Places
          <span className="text-xs font-normal text-muted-foreground">(cria novos leads a partir do Google Maps)</span>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="ex: pizzaria, farmácia, restaurante…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            onClick={handleSearch}
            disabled={searching || !searchInput.trim()}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Buscar no Places
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
          <FilterInput label="Cidade" value={placesCity} onChange={setPlacesCity} placeholder="Cidade" />
          <FilterInput label="UF" value={placesState} onChange={(v) => setPlacesState(v.toUpperCase().slice(0, 2))} placeholder="UF" maxLength={2} />
          <p className="text-xs text-muted-foreground self-center">
            Estes filtros aplicam-se à busca no Google Places (criação de novos leads)
          </p>
        </div>
      </div>

      {/* Container 2: Buscar nos leads salvos + FILTROS DE LEADS SALVOS (#2) */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Filter className="h-4 w-4 text-primary" />
          Buscar nos leads salvos
          <span className="text-xs font-normal text-muted-foreground">(filtra por nome, CNPJ, razão social ou endereço)</span>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="ex: pizzaria, 11.222.333, Criciúma…"
            value={savedSearchInput}
            onChange={(e) => setSavedSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearchSaved()}
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            onClick={handleSearchSaved}
            disabled={loading || !savedSearchInput.trim()}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/50 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Buscar
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
          <FilterInput label="Cidade" value={filterCity} onChange={setFilterCity} placeholder="Cidade" />
          <FilterInput label="UF" value={filterState} onChange={(v) => setFilterState(v.toUpperCase().slice(0, 2))} placeholder="UF" maxLength={2} />
          <FilterSelect label="CNPJ" value={filterCnpjStatus} onChange={setFilterCnpjStatus} options={[
            { value: 'all', label: 'Todos' }, { value: 'with', label: 'Com CNPJ' },
            { value: 'without', label: 'Sem CNPJ' }, { value: 'error', label: 'Erro' },
          ]} />
          <FilterSelect label="ReceitaWS" value={filterReceitaws} onChange={setFilterReceitaws} options={[
            { value: 'all', label: 'Todos' }, { value: 'ok', label: 'OK' },
            { value: 'pending', label: 'Pendente' }, { value: 'error', label: 'Erro' },
          ]} />
          <FilterSelect label="Pipeline" value={filterPipelineStatus} onChange={setFilterPipelineStatus} options={PIPELINE_STATUS_OPTIONS} />
          <button onClick={() => fetchLeads(1)} className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground hover:bg-muted/50">
            <RefreshCw className="h-4 w-4" /> Atualizar
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />{error}
        </div>
      )}

      {/* ===== BARRA DE SELEÇÃO (3 estados) ===== */}
      {leads.length > 0 && (
        <div className="flex items-center gap-3 rounded-md border border-border bg-card px-4 py-2 text-sm flex-wrap">
          {allMatchingSelected ? (
            // ESTADO 2: tudo selecionado — só botão "Desselecionar"
            <button
              onClick={() => {
                setSelectedIds(new Set());
                setAllMatchingSelected(false);
              }}
              title="Desselecionar todos os leads"
              className="inline-flex items-center gap-1.5 text-foreground hover:text-primary"
            >
              <CheckSquare className="h-4 w-4 text-primary" />
              <span>Desselecionar</span>
            </button>
          ) : (
            // ESTADO 0 e 1: "Selecionar página"/"Desselecionar página" + "Selecionar tudo (N)"
            <>
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
                <span>{allOnPageSelected ? 'Desselecionar página' : 'Selecionar página'}</span>
              </button>
              <span className="text-muted-foreground">|</span>
              <button
                onClick={selectAllMatching}
                disabled={selectingAll || total === 0}
                title="Selecionar todos os leads que casam com o filtro (todas as páginas)"
                className="inline-flex items-center gap-1.5 text-foreground hover:text-primary disabled:opacity-50"
              >
                {selectingAll ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ChevronsUpDown className="h-4 w-4" />
                )}
                <span>Selecionar tudo ({total})</span>
              </button>
            </>
          )}
          <span className="text-muted-foreground">|</span>
          <span className="text-muted-foreground">
            Página: {pageSelectedCount}/{leads.length}
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

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : leads.length === 0 ? (
        <div className="rounded-lg border border-border bg-card py-12 text-center text-muted-foreground">
          Nenhum lead encontrado. Faça uma busca acima para começar.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {leads.map((lead) => {
            const isSelected = selectedIds.has(lead.id);
            return (
              <LeadCard
                key={lead.id}
                lead={lead}
                isSelected={isSelected}
                onToggleSelect={() => toggleSelection(lead.id)}
                onSelect={() => setSelectedLead(lead)}
                onFetchCnpj={(force) => handleFetchCnpj(lead, force)}
                fetching={fetchingCnpjFor === lead.id}
              />
            );
          })}
        </div>
      )}

      {/* Paginação + page size (#5) */}
      {total > 0 && (
        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-sm text-muted-foreground">
            Mostrando {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, total)} de {total}
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Por página:</label>
              <select
                value={String(pageSize)}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:border-primary focus:outline-none"
              >
                {PAGE_SIZE_OPTIONS.map((s) => (
                  <option key={s} value={String(s)}>{s}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="rounded border border-border px-3 py-1 text-sm text-foreground disabled:opacity-50 hover:bg-muted/50">Anterior</button>
              <span className="rounded border border-border px-3 py-1 text-sm text-foreground bg-muted/30">Pág {page}</span>
              <button onClick={() => setPage(page + 1)} disabled={page * pageSize >= total} className="rounded border border-border px-3 py-1 text-sm text-foreground disabled:opacity-50 hover:bg-muted/50">Próximo</button>
            </div>
          </div>
        </div>
      )}

      {selectedLead && (
        <LeadDetailDialog lead={selectedLead} onClose={() => setSelectedLead(null)} onFetchCnpj={(force) => handleFetchCnpj(selectedLead, force)} fetching={fetchingCnpjFor === selectedLead.id} />
      )}

      {/* ===== BARRA DE AÇÕES FLUTUANTE (aparece quando há selecionados) ===== */}
      {selectedCount > 0 && (
        <BulkActionBar
          count={selectedCount}
          onClear={clearSelection}
          onExportCSV={handleExportCSV}
          exporting={exporting}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, variant = 'muted' }: { label: string; value: number; variant?: keyof typeof STAT_VARIANTS; }) {
  return (
    <div className={`rounded-lg p-3 ${STAT_VARIANTS[variant]}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs uppercase tracking-wide opacity-70">{label}</div>
    </div>
  );
}

function FilterInput({ label, value, onChange, placeholder, maxLength }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; maxLength?: number; }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} maxLength={maxLength} className="w-32 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none" />
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none">
        {options.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
      </select>
    </div>
  );
}

function CnpjStatusBadge({ lead }: { lead: Lead }) {
  if (!lead.cnpj) {
    if (lead.cnpjFetchStatus === 'not_found') return (<span className="inline-flex items-center gap-1 rounded bg-zinc-700/60 px-2 py-0.5 text-xs text-zinc-300"><X className="h-3 w-3" /> não encontrado</span>);
    if (lead.cnpjFetchStatus === 'error') return (<span className="inline-flex items-center gap-1 rounded bg-red-900/50 px-2 py-0.5 text-xs text-red-300"><AlertCircle className="h-3 w-3" /> erro</span>);
    return (<span className="inline-flex items-center gap-1 rounded bg-amber-900/50 px-2 py-0.5 text-xs text-amber-300">pendente</span>);
  }
  return (
    <span className="inline-flex items-center gap-1 rounded bg-emerald-900 px-2 py-0.5 text-xs font-medium text-white">
      <BadgeCheck className="h-3 w-3" />{lead.cnpjFormatted || lead.cnpj}
      {lead.cnpjConfidence != null && (<span className="opacity-80">({lead.cnpjConfidence}%)</span>)}
    </span>
  );
}

function LeadCard({ lead, isSelected, onToggleSelect, onSelect, onFetchCnpj, fetching }: {
  lead: Lead;
  isSelected: boolean;
  onToggleSelect: () => void;
  onSelect: () => void;
  onFetchCnpj: (force: boolean) => void;
  fetching: boolean;
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
            <button onClick={onSelect} className="flex-1 text-left font-semibold text-foreground hover:text-primary truncate">
              {lead.name || lead.razaoSocial || '(sem nome)'}
            </button>
            <CnpjStatusBadge lead={lead} />
          </div>
          {lead.nomeFantasia && lead.nomeFantasia !== lead.name && (<p className="mt-0.5 text-sm text-muted-foreground">{lead.nomeFantasia}</p>)}
        </div>
      </div>
      {lead.formattedAddress && (<p className="mt-2 flex items-start gap-1 text-xs text-muted-foreground"><MapPin className="mt-0.5 h-3 w-3 shrink-0" />{lead.formattedAddress}</p>)}
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        {lead.phone && (<span className="inline-flex items-center gap-1 text-muted-foreground"><Phone className="h-3 w-3" /> {lead.phone}</span>)}
        {lead.website && (<a href={lead.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"><Globe className="h-3 w-3" /> site</a>)}
        {lead.googleMapsUri && (<a href={lead.googleMapsUri} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"><ExternalLink className="h-3 w-3" /> maps</a>)}
        {lead.pipelineStatus && lead.pipelineStatus !== 'novo' && (
          <span className="inline-flex items-center gap-1 rounded bg-blue-900/40 px-1.5 py-0.5 text-blue-300 border border-blue-700/50">
            {lead.pipelineStatus}
          </span>
        )}
      </div>
      {lead.cnaePrincipalTexto && (<p className="mt-2 text-xs text-muted-foreground/80">CNAE: {lead.cnaePrincipalTexto}</p>)}
      <div className="mt-3 flex gap-2">
        <button onClick={() => onFetchCnpj(false)} disabled={fetching} className="flex-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/50 disabled:opacity-50">
          {fetching ? <Loader2 className="mx-auto h-3 w-3 animate-spin" /> : 'Buscar CNPJ'}
        </button>
        <button onClick={onSelect} className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted/50">Detalhes</button>
      </div>
    </div>
  );
}

function LeadDetailDialog({ lead, onClose, onFetchCnpj, fetching }: { lead: Lead; onClose: () => void; onFetchCnpj: (force: boolean) => void; fetching: boolean; }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-foreground">{lead.name || lead.razaoSocial || '(sem nome)'}</h2>
            {lead.nomeFantasia && lead.nomeFantasia !== lead.name && (<p className="text-sm text-muted-foreground">{lead.nomeFantasia}</p>)}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          <CnpjStatusBadge lead={lead} />
          {lead.situacaoCadastral && (<span className="rounded bg-zinc-700/60 px-2 py-0.5 text-xs text-zinc-300">Situação: {lead.situacaoCadastral}</span>)}
          {lead.porte && (<span className="rounded bg-zinc-700/60 px-2 py-0.5 text-xs text-zinc-300">Porte: {lead.porte}</span>)}
          {lead.receitawsStatus && lead.receitawsStatus !== 'ok' && (
            <span className="inline-flex items-center gap-1 rounded bg-amber-900/50 px-2 py-0.5 text-xs text-amber-300">
              <Loader2 className="h-3 w-3 animate-spin" /> ReceitaWS: {lead.receitawsStatus}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <DetailRow label="CNPJ" value={lead.cnpjFormatted || lead.cnpj} />
          <DetailRow label="Source" value={lead.cnpjSource} />
          <DetailRow label="Confiança" value={lead.cnpjConfidence != null ? `${lead.cnpjConfidence}%` : null} />
          <DetailRow label="Razão Social" value={lead.razaoSocial} />
          <DetailRow label="Nome Fantasia" value={lead.nomeFantasia} />
          <DetailRow label="Natureza Jurídica" value={lead.naturezaJuridica} />
          <DetailRow label="Data Abertura" value={lead.dataAbertura} />
          <DetailRow label="Capital Social" value={lead.capitalSocial != null ? `R$ ${lead.capitalSocial}` : null} />
          <DetailRow label="Telefone (Receita)" value={lead.telefoneReceita} />
          <DetailRow label="Email (Receita)" value={lead.emailReceita} />
          <DetailRow label="CNAE" value={`${lead.cnaePrincipalCodigo || ''} ${lead.cnaePrincipalTexto || ''}`.trim() || null} />
          <DetailRow label="Situação Cadastral" value={lead.situacaoCadastral} />
          <DetailRow label="Data Situação" value={lead.dataSituacaoCadastral} />
          <DetailRow label="Motivo" value={lead.motivoSituacaoCadastral} />
        </div>
        {(lead.enderecoLogradouro || lead.enderecoBairro) && (
          <div className="mt-4 rounded-md bg-zinc-800/60 p-3 text-sm">
            <p className="font-medium text-foreground">Endereço (Receita)</p>
            <p className="mt-1 text-muted-foreground">{[lead.enderecoLogradouro, lead.enderecoNumero, lead.enderecoComplemento, lead.enderecoBairro, lead.enderecoMunicipio, lead.enderecoUf, lead.enderecoCep].filter(Boolean).join(', ')}</p>
          </div>
        )}
        {lead.formattedAddress && (
          <div className="mt-3 rounded-md bg-primary/10 p-3 text-sm">
            <p className="font-medium text-foreground">Endereço (Google Places)</p>
            <p className="mt-1 text-muted-foreground">{lead.formattedAddress}</p>
          </div>
        )}
        <div className="mt-4 flex gap-2">
          <button onClick={() => onFetchCnpj(true)} disabled={fetching} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {lead.cnpj ? 'Reprocessar (force)' : 'Buscar CNPJ'}
          </button>
          {lead.website && (
            <a href={lead.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-muted/50"><Globe className="h-4 w-4" /> Abrir site</a>
          )}
        </div>
        <p className="mt-4 text-xs text-muted-foreground/80">placeId: {lead.placeId} | criado em {new Date(lead.createdAt).toLocaleString('pt-BR')}</p>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined; }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground/70">{label}</p>
      <p className="text-foreground">{value || '—'}</p>
    </div>
  );
}

// ===== BARRA DE AÇÕES FLUTUANTE =====
function BulkActionBar({ count, onClear, onExportCSV, exporting }: {
  count: number;
  onClear: () => void;
  onExportCSV: () => void;
  exporting: boolean;
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
          onClick={onClear}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50"
        >
          <Trash2 className="h-4 w-4" />
          Limpar
        </button>
      </div>
    </div>
  );
}
