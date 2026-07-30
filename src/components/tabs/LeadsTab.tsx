'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Building2, Search, Loader2, RefreshCw, MapPin, Phone, Globe,
  ExternalLink, BadgeCheck, AlertCircle, X, Filter,
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
}

interface Stats {
  total: number; withCnpj: number; withoutCnpj: number;
  receitawsOk: number; receitawsPending: number;
}

const PAGE_SIZE = 20;

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
  const [filterCity, setFilterCity] = useState('');
  const [filterState, setFilterState] = useState('');
  const [filterCnpjStatus, setFilterCnpjStatus] = useState('all');
  const [filterReceitaws, setFilterReceitaws] = useState('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [fetchingCnpjFor, setFetchingCnpjFor] = useState<string | null>(null);

  const fetchLeads = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page), pageSize: String(PAGE_SIZE),
        cnpjStatus: filterCnpjStatus, receitawsStatus: filterReceitaws,
      });
      if (searchInput.trim()) params.set('query', searchInput.trim());
      if (filterCity) params.set('city', filterCity);
      if (filterState) params.set('state', filterState);
      const res = await fetch(`/api/leads?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setLeads(data.leads || []);
      setTotal(data.total || 0);
      setStats(data.stats || null);
    } catch (e: any) {
      setError(e.message || 'Erro ao carregar leads');
    } finally { setLoading(false); }
  }, [page, searchInput, filterCity, filterState, filterCnpjStatus, filterReceitaws]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  const handleSearch = async () => {
    if (!searchInput.trim()) return;
    setSearching(true); setError(null);
    try {
      const res = await fetch('/api/leads/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchInput, pageSize: 20, city: filterCity || undefined, state: filterState || undefined }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      await fetchLeads();
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

      // Feedback contextual
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

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder='Buscar empresas... (ex: padarias, mecânicas, distribuidoras)'
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
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
          <Filter className="h-4 w-4 text-primary" />
          Busca Avançada
          <span className="text-xs font-normal text-muted-foreground">(filtra leads existentes no banco)</span>
        </div>
        <div className="flex flex-wrap items-end gap-3">
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
          <button onClick={fetchLeads} className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground hover:bg-muted/50">
            <RefreshCw className="h-4 w-4" /> Atualizar
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />{error}
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
          {leads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} onSelect={() => setSelectedLead(lead)} onFetchCnpj={(force) => handleFetchCnpj(lead, force)} fetching={fetchingCnpjFor === lead.id} />
          ))}
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Mostrando {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, total)} de {total}
          </p>
          <div className="flex gap-2">
            <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="rounded border border-border px-3 py-1 text-sm text-foreground disabled:opacity-50 hover:bg-muted/50">Anterior</button>
            <button onClick={() => setPage(page + 1)} disabled={page * PAGE_SIZE >= total} className="rounded border border-border px-3 py-1 text-sm text-foreground disabled:opacity-50 hover:bg-muted/50">Próximo</button>
          </div>
        </div>
      )}

      {selectedLead && (
        <LeadDetailDialog lead={selectedLead} onClose={() => setSelectedLead(null)} onFetchCnpj={(force) => handleFetchCnpj(selectedLead, force)} fetching={fetchingCnpjFor === selectedLead.id} />
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
  const isBigQuery = lead.cnpjSource?.startsWith('bigquery');
  const isScraper = lead.cnpjSource?.startsWith('scraper');
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${isScraper ? 'bg-emerald-900/50 text-emerald-300' : isBigQuery ? 'bg-blue-900/50 text-blue-300' : 'bg-zinc-700/60 text-zinc-300'}`}>
      <BadgeCheck className="h-3 w-3" />{lead.cnpjFormatted || lead.cnpj}
      {lead.cnpjConfidence != null && (<span className="opacity-70">({lead.cnpjConfidence}%)</span>)}
    </span>
  );
}

function LeadCard({ lead, onSelect, onFetchCnpj, fetching }: { lead: Lead; onSelect: () => void; onFetchCnpj: (force: boolean) => void; fetching: boolean; }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm transition hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <button onClick={onSelect} className="flex-1 text-left font-semibold text-foreground hover:text-primary">{lead.name || lead.razaoSocial || '(sem nome)'}</button>
        <CnpjStatusBadge lead={lead} />
      </div>
      {lead.nomeFantasia && lead.nomeFantasia !== lead.name && (<p className="mt-0.5 text-sm text-muted-foreground">{lead.nomeFantasia}</p>)}
      {lead.formattedAddress && (<p className="mt-2 flex items-start gap-1 text-xs text-muted-foreground"><MapPin className="mt-0.5 h-3 w-3 shrink-0" />{lead.formattedAddress}</p>)}
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        {lead.phone && (<span className="inline-flex items-center gap-1 text-muted-foreground"><Phone className="h-3 w-3" /> {lead.phone}</span>)}
        {lead.website && (<a href={lead.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><Globe className="h-3 w-3" /> site</a>)}
        {lead.googleMapsUri && (<a href={lead.googleMapsUri} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><ExternalLink className="h-3 w-3" /> maps</a>)}
      </div>
      {lead.cnaePrincipalTexto && (<p className="mt-2 text-xs text-muted-foreground/80">CNAE: {lead.cnaePrincipalTexto}</p>)}
      <div className="mt-3 flex gap-2">
        <button onClick={() => onFetchCnpj(false)} disabled={fetching} className="flex-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/50 disabled:opacity-50">
          {fetching ? <Loader2 className="mx-auto h-3 w-3 animate-spin" /> : lead.cnpj ? 'Reenriquecer' : 'Buscar CNPJ'}
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
            {lead.nomeFantasia && (<p className="text-sm text-muted-foreground">{lead.nomeFantasia}</p>)}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          <CnpjStatusBadge lead={lead} />
          {lead.situacaoCadastral && (<span className="rounded bg-zinc-700/60 px-2 py-0.5 text-xs text-zinc-300">Situação: {lead.situacaoCadastral}</span>)}
          {lead.porte && (<span className="rounded bg-zinc-700/60 px-2 py-0.5 text-xs text-zinc-300">Porte: {lead.porte}</span>)}
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
