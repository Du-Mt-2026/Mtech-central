'use client'

import { useState, useCallback } from 'react'
import {
  Search, Phone, Globe, Star, MapPin, Loader2, Filter, X,
  CheckCircle, AlertCircle, Upload, ChevronDown, ChevronUp,
} from 'lucide-react'

interface PlaceResult {
  id: string
  name: string
  phone?: string | null
  phoneRaw?: string | null
  website?: string | null
  address?: string | null
  rating?: number
  reviewsCount?: number
  categories?: string[]
  status?: 'new' | 'duplicate' | 'imported'
  lat?: number
  lng?: number
  isOpenNow?: boolean
}

interface SearchFilters {
  keyword: string
  location: string
  radiusKm: number
  minRating: number
  minReviews: number
  hasWebsite: 'any' | 'yes' | 'no'
  hasPhoneOnly: boolean
  openNow: boolean
  maxResults: number
  sortBy: 'relevance' | 'rating' | 'reviews' | 'distance'
  excludeImported: boolean
}

const DEFAULT_FILTERS: SearchFilters = {
  keyword: '',
  location: '',
  radiusKm: 10,
  minRating: 0,
  minReviews: 0,
  hasWebsite: 'any',
  hasPhoneOnly: true,
  openNow: false,
  maxResults: 20,
  sortBy: 'relevance',
  excludeImported: true,
}

const inputCls = 'w-full px-3 py-2 rounded-md border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30'
const labelCls = 'text-xs font-medium text-muted-foreground mb-1 block'

export default function LeadsTab() {
  const [filters, setFilters] = useState<SearchFilters>(DEFAULT_FILTERS)
  const [results, setResults] = useState<PlaceResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState<string | null>(null)
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set())
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [stats, setStats] = useState<{ total: number; new: number; duplicate: number } | null>(null)

  const handleSearch = useCallback(async () => {
    if (!filters.keyword.trim() || !filters.location.trim()) {
      setError('Informe a palavra-chave e a localização')
      return
    }
    setLoading(true)
    setError(null)
    setSelected(new Set())
    setStats(null)
    try {
      const res = await fetch('/api/leads/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(filters),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Erro ${res.status}`)
      }
      const data = await res.json()
      setResults(data.leads || [])
      setStats({
        total: data.total || 0,
        new: data.newCount || 0,
        duplicate: data.duplicateCount || 0,
      })
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [filters])

  const handleImport = useCallback(async (placeIds: string[]) => {
    const batchId = placeIds.length > 1 ? 'batch' : placeIds[0]
    setImporting(batchId)
    try {
      const res = await fetch('/api/leads/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placeIds }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Erro ${res.status}`)
      }
      setImportedIds(prev => new Set([...prev, ...placeIds]))
      setSelected(prev => {
        const next = new Set(prev)
        placeIds.forEach(id => next.delete(id))
        return next
      })
    } catch (err: any) {
      setError(err.message)
    } finally {
      setImporting(null)
    }
  }, [])

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    const importable = results.filter(r => !importedIds.has(r.id))
    if (selected.size === importable.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(importable.map(r => r.id)))
    }
  }

  const updateFilter = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => {
    setFilters(f => ({ ...f, [key]: value }))
  }

  return (
    <div className="space-y-4 p-4 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Prospecção de Leads</h1>
        <p className="text-sm text-muted-foreground">
          Pesquise empresas no Google Places e importe para suas listas de contato
        </p>
      </div>

      {/* Search Form */}
      <div className="rounded-lg border bg-card p-4 space-y-4">
        {/* Linha principal */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Palavra-chave *</label>
            <input
              type="text"
              value={filters.keyword}
              onChange={e => updateFilter('keyword', e.target.value)}
              placeholder="Ex: pizzaria, dentista, academia..."
              className={inputCls}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <div>
            <label className={labelCls}>Localização *</label>
            <input
              type="text"
              value={filters.location}
              onChange={e => updateFilter('location', e.target.value)}
              placeholder="Ex: Florianópolis, SC"
              className={inputCls}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <div>
            <label className={labelCls}>Raio (km)</label>
            <input
              type="number"
              min={1}
              max={50}
              value={filters.radiusKm}
              onChange={e => updateFilter('radiusKm', Number(e.target.value) || 10)}
              className={inputCls}
            />
          </div>
        </div>

        {/* Toggle filtros avançados */}
        <button
          onClick={() => setShowAdvanced(s => !s)}
          className="flex items-center gap-2 text-sm text-primary hover:underline"
        >
          <Filter className="w-4 h-4" />
          {showAdvanced ? 'Ocultar filtros avançados' : 'Mostrar filtros avançados'}
          {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>

        {/* Filtros avançados */}
        {showAdvanced && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3 border-t">
            <div>
              <label className={labelCls}>Avaliação mínima</label>
              <select
                value={filters.minRating}
                onChange={e => updateFilter('minRating', Number(e.target.value))}
                className={inputCls}
              >
                <option value={0}>Qualquer</option>
                <option value={3}>3.0+</option>
                <option value={3.5}>3.5+</option>
                <option value={4}>4.0+</option>
                <option value={4.5}>4.5+</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Avaliações mínimas</label>
              <input
                type="number"
                min={0}
                value={filters.minReviews}
                onChange={e => updateFilter('minReviews', Number(e.target.value) || 0)}
                className={inputCls}
                placeholder="0"
              />
            </div>
            <div>
              <label className={labelCls}>Website</label>
              <select
                value={filters.hasWebsite}
                onChange={e => updateFilter('hasWebsite', e.target.value as any)}
                className={inputCls}
              >
                <option value="any">Qualquer</option>
                <option value="yes">Com site</option>
                <option value="no">Sem site</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Máx. resultados</label>
              <select
                value={filters.maxResults}
                onChange={e => updateFilter('maxResults', Number(e.target.value))}
                className={inputCls}
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={40}>40</option>
                <option value={60}>60 (máx)</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Ordenar por</label>
              <select
                value={filters.sortBy}
                onChange={e => updateFilter('sortBy', e.target.value as any)}
                className={inputCls}
              >
                <option value="relevance">Relevância</option>
                <option value="rating">Avaliação</option>
                <option value="reviews">Nº avaliações</option>
                <option value="distance">Distância</option>
              </select>
            </div>
            <div className="flex items-center gap-2 pt-5">
              <input
                type="checkbox"
                id="hasPhoneOnly"
                checked={filters.hasPhoneOnly}
                onChange={e => updateFilter('hasPhoneOnly', e.target.checked)}
                className="w-4 h-4"
              />
              <label htmlFor="hasPhoneOnly" className="text-sm cursor-pointer">
                Apenas com telefone
              </label>
            </div>
            <div className="flex items-center gap-2 pt-5">
              <input
                type="checkbox"
                id="openNow"
                checked={filters.openNow}
                onChange={e => updateFilter('openNow', e.target.checked)}
                className="w-4 h-4"
              />
              <label htmlFor="openNow" className="text-sm cursor-pointer">
                Aberto agora
              </label>
            </div>
            <div className="flex items-center gap-2 pt-5">
              <input
                type="checkbox"
                id="excludeImported"
                checked={filters.excludeImported}
                onChange={e => updateFilter('excludeImported', e.target.checked)}
                className="w-4 h-4"
              />
              <label htmlFor="excludeImported" className="text-sm cursor-pointer">
                Ocultar já importados
              </label>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 items-center">
          <button
            onClick={handleSearch}
            disabled={loading || !filters.keyword.trim() || !filters.location.trim()}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {loading ? 'Buscando...' : 'Buscar'}
          </button>
          {selected.size > 0 && (
            <button
              onClick={() => handleImport(Array.from(selected))}
              disabled={importing === 'batch'}
              className="px-4 py-2 rounded-md bg-green-600 text-white text-sm hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
            >
              {importing === 'batch' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              Importar {selected.size} selecionados
            </button>
          )}
          {(results.length > 0 || stats) && !loading && (
            <button
              onClick={() => {
                setResults([])
                setSelected(new Set())
                setStats(null)
                setError(null)
              }}
              className="px-3 py-2 rounded-md border text-sm hover:bg-muted/30"
            >
              Limpar
            </button>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Stats bar */}
      {stats && !loading && (
        <div className="flex gap-4 text-sm">
          <div className="px-3 py-2 rounded-md bg-blue-50 border border-blue-200">
            <span className="font-semibold text-blue-700">{stats.total}</span>
            <span className="text-blue-600 ml-1">resultados</span>
          </div>
          <div className="px-3 py-2 rounded-md bg-green-50 border border-green-200">
            <span className="font-semibold text-green-700">{stats.new}</span>
            <span className="text-green-600 ml-1">novos</span>
          </div>
          {stats.duplicate > 0 && (
            <div className="px-3 py-2 rounded-md bg-yellow-50 border border-yellow-200">
              <span className="font-semibold text-yellow-700">{stats.duplicate}</span>
              <span className="text-yellow-600 ml-1">duplicados</span>
            </div>
          )}
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="flex items-center justify-between p-3 border-b bg-muted/30">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={selected.size > 0 && selected.size === results.filter(r => !importedIds.has(r.id)).length}
                onChange={toggleSelectAll}
                className="w-4 h-4"
              />
              <span className="text-sm font-medium">
                {results.length} resultados
                {selected.size > 0 && ` · ${selected.size} selecionados`}
              </span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 border-b text-xs uppercase">
                <tr>
                  <th className="p-2 w-10"></th>
                  <th className="p-2 text-left">Nome</th>
                  <th className="p-2 text-left">Telefone</th>
                  <th className="p-2 text-left">Website</th>
                  <th className="p-2 text-left">Avaliação</th>
                  <th className="p-2 text-left">Endereço</th>
                  <th className="p-2 text-center">Status</th>
                  <th className="p-2 text-center">Ação</th>
                </tr>
              </thead>
              <tbody>
                {results.map(place => {
                  const isImported = importedIds.has(place.id)
                  return (
                    <tr key={place.id} className="border-b hover:bg-muted/20">
                      <td className="p-2 text-center">
                        <input
                          type="checkbox"
                          checked={selected.has(place.id)}
                          onChange={() => toggleSelect(place.id)}
                          disabled={isImported}
                          className="w-4 h-4"
                        />
                      </td>
                      <td className="p-2 font-medium">
                        {place.name}
                        {place.isOpenNow !== undefined && (
                          <span className={`ml-2 inline-block w-2 h-2 rounded-full ${place.isOpenNow ? 'bg-green-500' : 'bg-gray-300'}`} title={place.isOpenNow ? 'Aberto' : 'Fechado'} />
                        )}
                      </td>
                      <td className="p-2">
                        {place.phone ? (
                          <div className="flex items-center gap-1">
                            <Phone className="w-3 h-3 text-muted-foreground" />
                            <span className="font-mono text-xs">{place.phone}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="p-2">
                        {place.website ? (
                          <a
                            href={place.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-primary hover:underline max-w-[150px]"
                          >
                            <Globe className="w-3 h-3 flex-shrink-0" />
                            <span className="text-xs truncate">
                              {(() => { try { return new URL(place.website).hostname.replace(/^www\./, '') } catch { return place.website } })()}
                            </span>
                          </a>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="p-2">
                        {place.rating ? (
                          <div className="flex items-center gap-1">
                            <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                            <span className="font-mono text-xs">{place.rating.toFixed(1)}</span>
                            <span className="text-xs text-muted-foreground">({place.reviewsCount || 0})</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="p-2 text-xs text-muted-foreground max-w-[200px]">
                        {place.address ? (
                          <div className="flex items-center gap-1">
                            <MapPin className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate">{place.address}</span>
                          </div>
                        ) : '—'}
                      </td>
                      <td className="p-2 text-center">
                        {isImported ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">
                            <CheckCircle className="w-3 h-3" />
                            Importado
                          </span>
                        ) : place.status === 'duplicate' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-yellow-100 text-yellow-700">
                            Duplicado
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700">
                            Novo
                          </span>
                        )}
                      </td>
                      <td className="p-2 text-center">
                        <button
                          onClick={() => handleImport([place.id])}
                          disabled={isImported || importing === place.id}
                          className="px-2 py-1 rounded text-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 mx-auto"
                        >
                          {importing === place.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Upload className="w-3 h-3" />
                          )}
                          {isImported ? 'OK' : 'Importar'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && results.length === 0 && !error && (
        <div className="text-center py-16 text-muted-foreground">
          <Search className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Faça uma busca para encontrar leads</p>
          <p className="text-xs mt-1">Use palavra-chave + localização para começar</p>
        </div>
      )}
    </div>
  )
}
