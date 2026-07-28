'use client'

import { useState } from 'react'
import { Search, Phone, Globe, Star, MapPin, Trash2, Download, Filter, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'

interface Lead {
  id: string
  source: string
  placeId: string
  name: string
  phone: string | null
  phoneRaw: string | null
  website: string | null
  address: string | null
  city: string | null
  state: string | null
  rating: number | null
  reviewsCount: number | null
  categories: string
  status: string
  searchQueryId?: string
  searchQuery?: { id: string; keyword: string; location: string }
  createdAt: string
}

interface ContactList {
  id: string
  name: string
  _count?: { contacts: number }
}

export default function LeadsTab() {
  const [keyword, setKeyword] = useState('')
  const [location, setLocation] = useState('')
  const [radiusKm, setRadiusKm] = useState(10)
  const [hasPhone, setHasPhone] = useState(true)
  const [hasWebsite, setHasWebsite] = useState(false)
  const [minRating, setMinRating] = useState('')
  const [minReviews, setMinReviews] = useState('')
  const [onlyOperational, setOnlyOperational] = useState(true)

  const [searching, setSearching] = useState(false)
  const [leads, setLeads] = useState<Lead[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [searchMeta, setSearchMeta] = useState<{ newCount: number; duplicateCount: number; costEstimate: number; searchQueryId?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [contactLists, setContactLists] = useState<ContactList[]>([])
  const [showImportModal, setShowImportModal] = useState(false)
  const [selectedListId, setSelectedListId] = useState('')
  const [newListName, setNewListName] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<any>(null)

  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory] = useState<any[]>([])

  async function handleSearch() {
    if (!keyword || !location) {
      setError('Preencha palavra-chave e localização')
      return
    }
    setSearching(true)
    setError(null)
    setSelected(new Set())
    setLeads([])
    setSearchMeta(null)

    try {
      const res = await fetch('/api/leads/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword,
          location,
          radiusKm,
          filters: {
            hasPhone,
            hasWebsite,
            minRating: minRating ? parseFloat(minRating) : undefined,
            minReviews: minReviews ? parseInt(minReviews) : undefined,
            onlyOperational,
          },
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro na busca')
      setLeads(data.places || [])
      setSearchMeta({
        newCount: data.newCount || 0,
        duplicateCount: data.duplicateCount || 0,
        costEstimate: data.costEstimate || 0,
        searchQueryId: data.searchQueryId,
      })
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSearching(false)
    }
  }

  function toggleSelect(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  function selectAll() {
    const importable = leads.filter((l) => l.status === 'new' && l.phone)
    if (selected.size === importable.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(importable.map((l) => l.id)))
    }
  }

  async function openImportModal() {
    if (selected.size === 0) {
      setError('Selecione ao menos um lead para importar')
      return
    }
    setError(null)
    setImportResult(null)
    setShowImportModal(true)
    // Carrega listas existentes
    try {
      const res = await fetch('/api/contact-lists')
      const data = await res.json()
      setContactLists(Array.isArray(data) ? data : [])
    } catch (e) {
      console.error('Erro ao carregar listas:', e)
    }
  }

  async function handleImport() {
    setImporting(true)
    setError(null)
    setImportResult(null)

    try {
      const body: any = { leadIds: Array.from(selected) }
      if (selectedListId) {
        body.contactListId = selectedListId
      } else if (newListName) {
        body.createNewList = { name: newListName }
      } else {
        setError('Selecione uma lista existente ou informe o nome de uma nova')
        setImporting(false)
        return
      }

      const res = await fetch('/api/leads/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao importar')

      setImportResult(data)

      // Atualiza status dos leads na UI
      setLeads((prev) =>
        prev.map((l) =>
          selected.has(l.id)
            ? { ...l, status: 'imported' }
            : l
        )
      )
      setSelected(new Set())
    } catch (e: any) {
      setError(e.message)
    } finally {
      setImporting(false)
    }
  }

  async function loadHistory() {
    setShowHistory(!showHistory)
    if (!showHistory) {
      try {
        const res = await fetch('/api/leads/search-queries')
        const data = await res.json()
        setHistory(Array.isArray(data) ? data : [])
      } catch (e) {
        console.error('Erro ao carregar histórico:', e)
      }
    }
  }

  async function deleteLead(id: string) {
    if (!confirm('Excluir este lead?')) return
    try {
      await fetch(`/api/leads?id=${id}`, { method: 'DELETE' })
      setLeads((prev) => prev.filter((l) => l.id !== id))
    } catch (e) {
      console.error('Erro ao deletar:', e)
    }
  }

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; class: string }> = {
      new: { label: 'Novo', class: 'bg-green-100 text-green-700 border-green-200' },
      duplicate: { label: 'Duplicado', class: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
      imported: { label: 'Importado', class: 'bg-blue-100 text-blue-700 border-blue-200' },
      rejected: { label: 'Rejeitado', class: 'bg-red-100 text-red-700 border-red-200' },
    }
    const s = map[status] || map.new
    return (
      <span className={`text-xs px-2 py-0.5 rounded border ${s.class}`}>{s.label}</span>
    )
  }

  const parseCategories = (json: string): string[] => {
    try { return JSON.parse(json) } catch { return [] }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Prospecção de Leads</h1>
          <p className="text-sm text-muted-foreground">
            Busque empresas no Google Maps e importe para suas listas de contato
          </p>
        </div>
        <button
          onClick={loadHistory}
          className="flex items-center gap-2 px-3 py-2 text-sm border rounded hover:bg-muted"
        >
          {showHistory ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          Histórico de buscas
        </button>
      </div>

      {/* Formulário de busca */}
      <div className="border rounded-lg p-4 bg-card space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Palavra-chave</label>
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="ex: pizzaria, dentista, salão de beleza"
              className="w-full px-3 py-2 border rounded text-sm"
              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Localização</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="ex: Florianópolis, SC"
              className="w-full px-3 py-2 border rounded text-sm"
              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
        </div>

        <details className="text-sm">
          <summary className="cursor-pointer flex items-center gap-2 text-muted-foreground hover:text-foreground">
            <Filter className="size-4" /> Filtros avançados
          </summary>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 p-3 bg-muted/30 rounded">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={hasPhone} onChange={(e) => setHasPhone(e.target.checked)} />
              Com telefone
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={hasWebsite} onChange={(e) => setHasWebsite(e.target.checked)} />
              Com site
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={onlyOperational} onChange={(e) => setOnlyOperational(e.target.checked)} />
              Só abertos
            </label>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Raio (km)</label>
              <input
                type="number"
                value={radiusKm}
                onChange={(e) => setRadiusKm(parseInt(e.target.value) || 10)}
                className="w-full px-2 py-1 border rounded text-sm"
                min={1}
                max={100}
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Rating mínimo</label>
              <input
                type="number"
                value={minRating}
                onChange={(e) => setMinRating(e.target.value)}
                placeholder="ex: 4.0"
                step={0.1}
                min={0}
                max={5}
                className="w-full px-2 py-1 border rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Reviews mínimas</label>
              <input
                type="number"
                value={minReviews}
                onChange={(e) => setMinReviews(e.target.value)}
                placeholder="ex: 50"
                min={0}
                className="w-full px-2 py-1 border rounded text-sm"
              />
            </div>
          </div>
        </details>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSearch}
            disabled={searching || !keyword || !location}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {searching ? <RefreshCw className="size-4 animate-spin" /> : <Search className="size-4" />}
            {searching ? 'Buscando...' : 'Buscar empresas'}
          </button>
          <span className="text-xs text-muted-foreground">
            Custo estimado: ~$0.032 por busca
          </span>
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">
            ⚠️ {error}
          </div>
        )}

        {searchMeta && (
          <div className="text-sm bg-muted/50 rounded p-3 grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <div className="text-xs text-muted-foreground">Encontrados</div>
              <div className="font-semibold">{leads.length}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Novos</div>
              <div className="font-semibold text-green-600">{searchMeta.newCount}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Duplicados</div>
              <div className="font-semibold text-yellow-600">{searchMeta.duplicateCount}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Custo</div>
              <div className="font-semibold">${searchMeta.costEstimate.toFixed(4)}</div>
            </div>
          </div>
        )}
      </div>

      {/* Histórico */}
      {showHistory && (
        <div className="border rounded-lg p-4 bg-card">
          <h3 className="font-semibold mb-3">Buscas anteriores</h3>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma busca anterior</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {history.map((q) => (
                <div key={q.id} className="flex items-center justify-between border-b pb-2 text-sm">
                  <div>
                    <span className="font-medium">{q.keyword}</span>
                    <span className="text-muted-foreground"> em {q.location}</span>
                    <span className="ml-2 text-xs px-2 py-0.5 rounded bg-muted">
                      {q._count?.leads || 0} leads
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {q.lastRunAt ? new Date(q.lastRunAt).toLocaleString('pt-BR') : '-'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Resultados */}
      {leads.length > 0 && (
        <div className="border rounded-lg bg-card">
          <div className="flex items-center justify-between p-3 border-b">
            <div className="flex items-center gap-3">
              <button
                onClick={selectAll}
                className="text-sm px-2 py-1 border rounded hover:bg-muted"
              >
                {selected.size === leads.filter((l) => l.status === 'new' && l.phone).length
                  ? 'Desmarcar todos'
                  : 'Selecionar novos'}
              </button>
              <span className="text-sm text-muted-foreground">
                {selected.size} selecionados
              </span>
            </div>
            <button
              onClick={openImportModal}
              disabled={selected.size === 0}
              className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded text-sm hover:bg-primary/90 disabled:opacity-50"
            >
              <Download className="size-4" />
              Importar para lista
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="p-2 w-8"></th>
                  <th className="p-2">Empresa</th>
                  <th className="p-2">Telefone</th>
                  <th className="p-2">Site</th>
                  <th className="p-2">Endereço</th>
                  <th className="p-2">Rating</th>
                  <th className="p-2">Status</th>
                  <th className="p-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id} className="border-b hover:bg-muted/30">
                    <td className="p-2">
                      <input
                        type="checkbox"
                        checked={selected.has(lead.id)}
                        onChange={() => toggleSelect(lead.id)}
                        disabled={lead.status === 'imported'}
                      />
                    </td>
                    <td className="p-2">
                      <div className="font-medium">{lead.name}</div>
                      {parseCategories(lead.categories).length > 0 && (
                        <div className="text-xs text-muted-foreground">
                          {parseCategories(lead.categories).slice(0, 3).join(', ')}
                        </div>
                      )}
                    </td>
                    <td className="p-2">
                      {lead.phoneRaw ? (
                        <a href={`tel:${lead.phoneRaw}`} className="flex items-center gap-1 text-blue-600 hover:underline">
                          <Phone className="size-3" />
                          {lead.phoneRaw}
                        </a>
                      ) : (
                        <span className="text-muted-foreground text-xs">sem telefone</span>
                      )}
                    </td>
                    <td className="p-2">
                      {lead.website ? (
                        <a href={lead.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                          <Globe className="size-4" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground text-xs">-</span>
                      )}
                    </td>
                    <td className="p-2 text-xs">
                      {lead.address && (
                        <div className="flex items-start gap-1">
                          <MapPin className="size-3 mt-0.5 text-muted-foreground" />
                          <span className="text-muted-foreground">{lead.address}</span>
                        </div>
                      )}
                    </td>
                    <td className="p-2">
                      {lead.rating !== null && (
                        <div className="flex items-center gap-1 text-xs">
                          <Star className="size-3 fill-yellow-400 text-yellow-400" />
                          <span>{lead.rating.toFixed(1)}</span>
                          <span className="text-muted-foreground">({lead.reviewsCount})</span>
                        </div>
                      )}
                    </td>
                    <td className="p-2">{statusBadge(lead.status)}</td>
                    <td className="p-2">
                      <button
                        onClick={() => deleteLead(lead.id)}
                        className="text-muted-foreground hover:text-red-600"
                        title="Excluir"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal de importação */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background border rounded-lg shadow-lg w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-lg">Importar leads</h3>
              <button
                onClick={() => setShowImportModal(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            </div>

            {importResult ? (
              <div className="space-y-3">
                <div className="bg-green-50 border border-green-200 rounded p-3 text-sm">
                  ✅ {importResult.imported} leads importados com sucesso!
                </div>
                {importResult.skippedNoPhone > 0 && (
                  <div className="text-xs text-muted-foreground">
                    {importResult.skippedNoPhone} leads sem telefone foram pulados
                  </div>
                )}
                {importResult.errors > 0 && (
                  <div className="text-xs text-red-600">
                    {importResult.errors} erros durante a importação
                  </div>
                )}
                <button
                  onClick={() => {
                    setShowImportModal(false)
                    setImportResult(null)
                  }}
                  className="w-full px-4 py-2 bg-primary text-primary-foreground rounded text-sm"
                >
                  Fechar
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Lista existente</label>
                  <select
                    value={selectedListId}
                    onChange={(e) => setSelectedListId(e.target.value)}
                    className="w-full px-3 py-2 border rounded text-sm"
                  >
                    <option value="">— criar nova —</option>
                    {contactLists.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({l._count?.contacts || 0} contatos)
                      </option>
                    ))}
                  </select>
                </div>

                {!selectedListId && (
                  <div>
                    <label className="block text-sm font-medium mb-1">Nome da nova lista</label>
                    <input
                      type="text"
                      value={newListName}
                      onChange={(e) => setNewListName(e.target.value)}
                      placeholder={`ex: Leads ${keyword} ${location}`}
                      className="w-full px-3 py-2 border rounded text-sm"
                    />
                  </div>
                )}

                <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
                  Serão importados <strong>{selected.size}</strong> leads como contatos.
                  Campos personalizados (empresa, site, rating, etc) serão salvos em customFields.
                </div>

                {error && (
                  <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">
                    {error}
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => setShowImportModal(false)}
                    className="flex-1 px-4 py-2 border rounded text-sm hover:bg-muted"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleImport}
                    disabled={importing || (!selectedListId && !newListName)}
                    className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded text-sm hover:bg-primary/90 disabled:opacity-50"
                  >
                    {importing ? 'Importando...' : 'Importar'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
