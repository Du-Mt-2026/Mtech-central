'use client'

// Extracted verbatim from src/app/page.tsx (P2.1-split-4).
// All logic preserved — pure mechanical extraction.
// Contains: VpsSetupTab.

import { useState, useEffect } from 'react'
import {
  AlertCircle, AlertTriangle, ArrowDownToLine, Check, Copy, Globe,
  Lock, QrCode, RefreshCw, Server, Shield, Smartphone, Zap,
} from 'lucide-react'
import { type Chip } from '@/lib/types'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

// ===== VPS / Proxy Setup Tab =====
export function VpsSetupTab() {
  const [loading, setLoading] = useState(true)
  const [setupData, setSetupData] = useState<{
    serverEndpoint: string
    serverPort: string
    subnet: string
    chipCount: number
    configuredChips: number
    wgServerConfig: string
    serverSetupScript: string
    evolutionVpsScript: string
    dockerComposeNote: string
    proxyConfigs: { chipId: string; chipName: string; wireguardIp: string; socksPort: number; proxyHost: string; proxyPort: number }[]
  } | null>(null)
  const [autoConfiguring, setAutoConfiguring] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/vps-setup').then(r => r.json()).then(data => { setSetupData(data); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  const autoConfigure = async () => {
    setAutoConfiguring(true)
    try {
      const res = await fetch('/api/vps-setup', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(data.message || `${data.updated} chips configurados!`)
      // Refresh data
      const refresh = await fetch('/api/vps-setup')
      setSetupData(await refresh.json())
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro ao auto-configurar')
    } finally {
      setAutoConfiguring(false)
    }
  }

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(id)
      toast.success('Copiado!')
      setTimeout(() => setCopied(null), 2000)
    } catch {
      toast.error('Erro ao copiar')
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div>
  }

  if (!setupData) {
    return (
      <Card className="shadow-lg border-0">
        <CardContent className="flex flex-col items-center justify-center py-16">
          <AlertCircle className="size-8 text-rose-500 mb-2" />
          <p className="text-sm text-muted-foreground">Erro ao carregar dados do VPS</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold">VPS / Proxy</h2>
          <p className="text-sm text-muted-foreground">Configure WireGuard + SOCKS5 proxy para roteamento de IP</p>
        </div>
        <Button onClick={autoConfigure} disabled={autoConfiguring} className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-lg">
          {autoConfiguring ? <RefreshCw className="size-4 animate-spin" /> : <Zap className="size-4" />}
          {autoConfiguring ? 'Configurando...' : 'Auto-Configurar Proxies'}
        </Button>
      </div>

      {/* Architecture Overview */}
      <Card className="shadow-lg border-0">
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
              <Server className="size-4 text-emerald-600" />
            </div>
            <CardTitle className="text-lg">Arquitetura</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-900">
              <div className="flex size-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30 shrink-0">
                <Smartphone className="size-4 text-amber-600" />
              </div>
              <div>
                <p className="font-medium">Celular (Chip 4G)</p>
                <p className="text-xs text-muted-foreground">WireGuard + Every Proxy (SOCKS5 :1080)</p>
              </div>
            </div>
            <div className="flex justify-center"><ArrowDownToLine className="size-4 text-muted-foreground" /></div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-900">
              <div className="flex size-8 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30 shrink-0">
                <Globe className="size-4 text-violet-600" />
              </div>
              <div>
                <p className="font-medium">VPN WireGuard ({setupData.serverEndpoint})</p>
                <p className="text-xs text-muted-foreground">Subnet {setupData.subnet}.0/24 — Porta {setupData.serverPort}</p>
              </div>
            </div>
            <div className="flex justify-center"><ArrowDownToLine className="size-4 text-muted-foreground" /></div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-900">
              <div className="flex size-8 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-900/30 shrink-0">
                <Server className="size-4 text-sky-600" />
              </div>
              <div>
                <p className="font-medium">KVM8 — Evolution API</p>
                <p className="text-xs text-muted-foreground">Instâncias usam SOCKS5 proxy → saem pelo IP do celular</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Chips', value: setupData.chipCount, icon: Smartphone, color: 'text-violet-600 bg-violet-100 dark:bg-violet-900/30' },
          { label: 'Com WireGuard', value: setupData.configuredChips, icon: Lock, color: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30' },
          { label: 'Subnet', value: setupData.subnet + '.x', icon: Globe, color: 'text-amber-600 bg-amber-100 dark:bg-amber-900/30' },
          { label: 'Porta WG', value: setupData.serverPort, icon: Shield, color: 'text-sky-600 bg-sky-100 dark:bg-sky-900/30' },
        ].map(s => (
          <Card key={s.label} className="shadow-lg">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`flex size-10 items-center justify-center rounded-xl ${s.color}`}>
                <s.icon className="size-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Step 1: WireGuard Server Config */}
      <Card className="shadow-lg border-0">
        <CardHeader>
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-full bg-emerald-600 text-white text-xs font-bold">1</span>
            <CardTitle className="text-lg">Servidor WireGuard ({setupData.serverEndpoint.split(':')[0]})</CardTitle>
          </div>
          <CardDescription>Cole esta config no arquivo /etc/wireguard/wg0.conf do servidor VPN</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <pre className="bg-zinc-900 text-zinc-100 p-4 rounded-lg text-sm overflow-x-auto whitespace-pre-wrap break-all font-mono border border-zinc-700 max-h-64 overflow-y-auto">
            {setupData.wgServerConfig}
          </pre>
          <Button onClick={() => copyToClipboard(setupData.wgServerConfig, 'server')} variant="outline" className="w-full gap-2">
            {copied === 'server' ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
            {copied === 'server' ? 'Copiado!' : 'Copiar Config do Servidor'}
          </Button>
          <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3">
            <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              Depois de colar, execute: <code className="bg-amber-100 dark:bg-amber-900/50 px-1 rounded">wg syncconf wg0 &lt;(wg-quick strip wg0)</code>
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Step 2: Chip Proxy Table */}
      <Card className="shadow-lg border-0">
        <CardHeader>
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-full bg-emerald-600 text-white text-xs font-bold">2</span>
            <CardTitle className="text-lg">Proxy SOCKS5 por Chip</CardTitle>
          </div>
          <CardDescription>Configure no celular: WireGuard (QR Code) + Every Proxy (SOCKS5)</CardDescription>
        </CardHeader>
        <CardContent>
          {setupData.proxyConfigs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Smartphone className="size-8 mb-2 opacity-50" />
              <p className="text-sm">Nenhum chip com WireGuard configurado</p>
              <p className="text-xs">Crie chips primeiro na aba "Chips"</p>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2 font-medium">Chip</th>
                    <th className="text-left p-2 font-medium">IP VPN</th>
                    <th className="text-left p-2 font-medium">Porta SOCKS5</th>
                    <th className="text-left p-2 font-medium">QR Code</th>
                  </tr>
                </thead>
                <tbody>
                  {setupData.proxyConfigs.map((proxy) => (
                    <tr key={proxy.chipId} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="p-2 font-medium">{proxy.chipName}</td>
                      <td className="p-2 font-mono text-xs">{proxy.wireguardIp}</td>
                      <td className="p-2 font-mono">{proxy.proxyPort}</td>
                      <td className="p-2">
                        <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => {
                          fetch(`/api/wireguard/${proxy.chipId}`).then(r => r.json()).then(data => {
                            if (data.config) copyToClipboard(data.config, `qr-${proxy.chipId}`)
                          })
                        }}>
                          <QrCode className="size-3.5" /> Ver QR
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 3: Instructions */}
      <Card className="shadow-lg border-0">
        <CardHeader>
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-full bg-emerald-600 text-white text-xs font-bold">3</span>
            <CardTitle className="text-lg">Passo a Passo</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {[
            { step: 1, title: 'No Servidor VPN', items: ['SSH para 187.77.48.22', 'Cole a config do Passo 1 em /etc/wireguard/wg0.conf', 'Execute: wg syncconf wg0 <(wg-quick strip wg0)', 'Verifique: wg show wg0'] },
            { step: 2, title: 'No Celular (para cada chip)', items: ['Instale o app WireGuard', 'Vá na aba Chips → ícone WireGuard → escaneie o QR Code', 'Ative o túnel VPN', 'Instale o app Every Proxy', 'Vá na aba SOCKS5 → ligue o switch (porta 1080)'] },
            { step: 3, title: 'No OctupusZap', items: ['Clique em "Auto-Configurar Proxies" acima', 'O sistema preenche Host + Porta automaticamente', 'A Evolution API passa a usar o proxy SOCKS5', 'Cada chip sai pelo IP 4G do celular!'] },
          ].map(s => (
            <div key={s.step} className="space-y-2">
              <h4 className="font-semibold flex items-center gap-2">
                <span className="flex items-center justify-center size-6 rounded-full bg-emerald-600 text-white text-xs font-bold">{s.step}</span>
                {s.title}
              </h4>
              <div className="ml-8 space-y-1 text-muted-foreground text-xs">
                {s.items.map((item, idx) => <p key={idx}>• {item}</p>)}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

