'use client'

// Extracted verbatim from src/app/page.tsx (P2.1-split-4).
// All logic preserved — pure mechanical extraction.
// Contains: ConfiguracoesTab.

import { useState, useEffect } from 'react'
import {
  Activity, AlertCircle, Check, Clock, Globe, Key, Lock, MessageSquare,
  RefreshCw, Shield, Smartphone, Type, Zap,
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'

// ===== Configurações Tab =====
export function ConfiguracoesTab() {
  const [config, setConfig] = useState({
    resetHour: 0, defaultProxyMode: 'none', globalDailyLimit: 1000,
    emailNotifications: true, timezone: 'America/Sao_Paulo',
    evolutionApiUrl: '', evolutionApiKey: '',
    socks5Host: '', socks5Port: '8084', socks5User: '', socks5Pass: '',
  })
  const [initialConfig, setInitialConfig] = useState<typeof config | null>(null)
  const isDirty = initialConfig ? JSON.stringify(initialConfig) !== JSON.stringify(config) : false
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionResult, setConnectionResult] = useState<{ success: boolean; message: string } | null>(null)
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [changingPassword, setChangingPassword] = useState(false)

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await fetch('/api/settings')
        const data = await res.json()
        if (data.resetHour !== undefined) setConfig(prev => ({ ...prev, resetHour: parseInt(data.resetHour) || 0 }))
        if (data.defaultProxyMode) setConfig(prev => ({ ...prev, defaultProxyMode: data.defaultProxyMode }))
        if (data.globalDailyLimit) setConfig(prev => ({ ...prev, globalDailyLimit: parseInt(data.globalDailyLimit) || 1000 }))
        if (data.emailNotifications !== undefined) setConfig(prev => ({ ...prev, emailNotifications: data.emailNotifications === 'true' }))
        if (data.timezone) setConfig(prev => ({ ...prev, timezone: data.timezone }))
        if (data.evolution_api_url) setConfig(prev => ({ ...prev, evolutionApiUrl: data.evolution_api_url }))
        if (data.evolution_api_key) setConfig(prev => ({ ...prev, evolutionApiKey: data.evolution_api_key }))
        if (data.default_socks5_host) setConfig(prev => ({ ...prev, socks5Host: data.default_socks5_host }))
        if (data.default_socks5_port) setConfig(prev => ({ ...prev, socks5Port: data.default_socks5_port }))
        if (data.default_socks5_user) setConfig(prev => ({ ...prev, socks5User: data.default_socks5_user }))
        if (data.default_socks5_pass) setConfig(prev => ({ ...prev, socks5Pass: data.default_socks5_pass }))
        // Snapshot inicial pra detectar mudancas (dirty state) — dentro do try pra ter acesso a data
        setInitialConfig({
          resetHour: parseInt(data.resetHour) || 0,
          defaultProxyMode: data.defaultProxyMode || 'none',
          globalDailyLimit: parseInt(data.globalDailyLimit) || 1000,
          emailNotifications: data.emailNotifications === 'true',
          timezone: data.timezone || 'America/Sao_Paulo',
          evolutionApiUrl: data.evolution_api_url || '',
          evolutionApiKey: data.evolution_api_key || '',
          socks5Host: data.default_socks5_host || '',
          socks5Port: data.default_socks5_port || '8084',
          socks5User: data.default_socks5_user || '',
          socks5Pass: data.default_socks5_pass || '',
        })
      } catch { /* empty */ }
      finally { setLoading(false) }
    }
    loadSettings()
  }, [])

  const saveSettings = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resetHour: String(config.resetHour),
          defaultProxyMode: config.defaultProxyMode,
          globalDailyLimit: String(config.globalDailyLimit),
          emailNotifications: String(config.emailNotifications),
          timezone: config.timezone,
          evolution_api_url: config.evolutionApiUrl,
          evolution_api_key: config.evolutionApiKey,
          default_socks5_host: config.socks5Host,
          default_socks5_port: config.socks5Port,
          default_socks5_user: config.socks5User,
          default_socks5_pass: config.socks5Pass,
        }),
      })
      if (!res.ok) throw new Error()
      toast.success('Configurações salvas!')
      setInitialConfig({ ...config })
      setConnectionResult(null)
    } catch { toast.error('Erro ao salvar configurações') }
    finally { setSaving(false) }
  }

  const testEvolutionConnection = async () => {
    setTestingConnection(true)
    setConnectionResult(null)
    try {
      // First save the settings so the test uses the latest values
      const saveRes = await fetch('/api/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          evolution_api_url: config.evolutionApiUrl,
          evolution_api_key: config.evolutionApiKey,
        }),
      })
      if (!saveRes.ok) throw new Error('Erro ao salvar antes de testar')

      const res = await fetch('/api/whatsapp/test-connection', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setConnectionResult({ success: true, message: `Conexão OK! ${data.instanceCount} instância(s) encontrada(s)` })
        toast.success('Conexão com Evolution API bem sucedida!')
      } else {
        setConnectionResult({ success: false, message: data.error || 'Erro ao conectar' })
        toast.error('Falha na conexão com Evolution API')
      }
    } catch (err: unknown) {
      const msg = (err as Error).message || 'Erro ao testar conexão'
      setConnectionResult({ success: false, message: msg })
      toast.error(msg)
    } finally {
      setTestingConnection(false)
    }
  }

  const changePassword = async () => {
    if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      toast.error('Preencha todos os campos de senha')
      return
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error('A nova senha e a confirmação não coincidem')
      return
    }
    if (passwordForm.newPassword.length < 6) {
      toast.error('A nova senha deve ter pelo menos 6 caracteres')
      return
    }
    setChangingPassword(true)
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao alterar senha')
      toast.success('Senha alterada com sucesso!')
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro ao alterar senha')
    } finally {
      setChangingPassword(false)
    }
  }

  if (loading) return <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div>

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Configurações</h2>
        <p className="text-sm text-muted-foreground">Configurações gerais do sistema</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Evolution API Card - FULL WIDTH */}
        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200 lg:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                <Globe className="size-4 text-emerald-600" />
              </div>
              <CardTitle className="text-lg">Evolution API</CardTitle>
              <Badge variant="outline" className="gap-1 text-xs ml-auto">
                <Zap className="size-3" /> WhatsApp Engine
              </Badge>
            </div>
            <CardDescription>Configure a conexão com a Evolution API que gerencia as instâncias WhatsApp</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>URL da API</Label>
                <Input placeholder="https://evolution.seudominio.com" value={config.evolutionApiUrl}
                  onChange={e => setConfig(p => ({ ...p, evolutionApiUrl: e.target.value }))} />
                <p className="text-xs text-muted-foreground">Endereço do servidor Evolution API</p>
              </div>
              <div className="space-y-2">
                <Label>API Key</Label>
                <Input type="password" placeholder="Sua API Key" value={config.evolutionApiKey}
                  onChange={e => setConfig(p => ({ ...p, evolutionApiKey: e.target.value }))} />
                <p className="text-xs text-muted-foreground">Chave de autenticação da Evolution API</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" className="gap-2" onClick={testEvolutionConnection} disabled={testingConnection || !config.evolutionApiUrl || !config.evolutionApiKey}>
                {testingConnection ? <RefreshCw className="size-4 animate-spin" /> : <Activity className="size-4" />}
                {testingConnection ? 'Testando...' : 'Testar Conexão'}
              </Button>
              {connectionResult && (
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ${
                  connectionResult.success
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                    : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                }`}>
                  {connectionResult.success ? <Check className="size-4" /> : <AlertCircle className="size-4" />}
                  {connectionResult.message}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Proxy SOCKS5 Global Card - FULL WIDTH */}
        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200 lg:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30">
                <Globe className="size-4 text-violet-600" />
              </div>
              <CardTitle className="text-lg">Proxy SOCKS5 Global</CardTitle>
              <Badge variant="outline" className="gap-1 text-xs ml-auto">
                <Shield className="size-3" /> Roteamento de IP
              </Badge>
            </div>
            <CardDescription>
              Configure o proxy SOCKS5 uma vez e todos os chips usarão automaticamente.
              Ideal para usar com WireGuard + Every Proxy no celular — não precisa configurar cada chip individualmente.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Host do Proxy</Label>
                <Input placeholder="Ex: 10.0.0.100 (IP do WireGuard)" value={config.socks5Host}
                  onChange={e => setConfig(p => ({ ...p, socks5Host: e.target.value }))} />
                <p className="text-xs text-muted-foreground">IP do celular na rede WireGuard (Every Proxy)</p>
              </div>
              <div className="space-y-2">
                <Label>Porta do Proxy</Label>
                <Input placeholder="8084" value={config.socks5Port}
                  onChange={e => setConfig(p => ({ ...p, socks5Port: e.target.value }))} />
                <p className="text-xs text-muted-foreground">Porta SOCKS5 do Every Proxy (padrão: 8084)</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Usuário (opcional)</Label>
                <Input placeholder="Deixe vazio se não houver autenticação" value={config.socks5User}
                  onChange={e => setConfig(p => ({ ...p, socks5User: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Senha (opcional)</Label>
                <Input type="password" placeholder="Deixe vazio se não houver autenticação" value={config.socks5Pass}
                  onChange={e => setConfig(p => ({ ...p, socks5Pass: e.target.value }))} />
              </div>
            </div>
            {config.socks5Host && config.socks5Port && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-sm">
                <Check className="size-4" />
                Proxy SOCKS5 ativo: {config.socks5Host}:{config.socks5Port} — será aplicado automaticamente a todos os chips
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-900/30">
                <Clock className="size-4 text-sky-600" />
              </div>
              <CardTitle className="text-lg">Reset Diário</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Hora do reset diário</Label>
              <Input type="number" min={0} max={23} value={config.resetHour}
                onChange={e => setConfig(p => ({ ...p, resetHour: parseInt(e.target.value) || 0 }))} />
              <p className="text-xs text-muted-foreground">Os contadores de mensagem serão zerados neste horário</p>
            </div>
            <div className="space-y-2">
              <Label>Zona horária</Label>
              <Select value={config.timezone} onValueChange={v => setConfig(p => ({ ...p, timezone: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="America/Sao_Paulo">Brasília (GMT-3)</SelectItem>
                  <SelectItem value="America/Manaus">Manaus (GMT-4)</SelectItem>
                  <SelectItem value="America/Belem">Belém (GMT-3)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30">
                <Smartphone className="size-4 text-violet-600" />
              </div>
              <CardTitle className="text-lg">Conexão Padrão</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Modo de conexão padrão</Label>
              <Select value={config.defaultProxyMode} onValueChange={v => setConfig(p => ({ ...p, defaultProxyMode: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">QR Code (WhatsApp Web)</SelectItem>
                  <SelectItem value="socks5">Proxy SOCKS5</SelectItem>
                  <SelectItem value="wireguard">WireGuard</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
                <Zap className="size-4 text-amber-600" />
              </div>
              <CardTitle className="text-lg">Limites</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label>Limite global de mensagens por dia</Label>
                <span className="text-sm font-semibold">{config.globalDailyLimit}</span>
              </div>
              <Slider value={[config.globalDailyLimit]} onValueChange={([v]) => setConfig(p => ({ ...p, globalDailyLimit: v }))} min={100} max={5000} step={100} />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-0 hover:shadow-xl transition-all duration-200">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                <MessageSquare className="size-4 text-emerald-600" />
              </div>
              <CardTitle className="text-lg">Notificações</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-xl">
              <div>
                <p className="font-medium text-sm">Notificações por email</p>
                <p className="text-xs text-muted-foreground">Receba alertas sobre campanhas e chips</p>
              </div>
              <Switch checked={config.emailNotifications} onCheckedChange={v => setConfig(p => ({ ...p, emailNotifications: v }))} />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-end gap-3">
        {isDirty && !saving && (
          <Badge variant="secondary" className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
            Não salvo
          </Badge>
        )}
        {saving && (
          <Badge variant="secondary" className="bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">
            <RefreshCw className="size-3 animate-spin" />
            Salvando
          </Badge>
        )}
        <Button className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-lg"
          onClick={saveSettings} disabled={saving || !isDirty}>
          {saving ? <RefreshCw className="size-4 animate-spin" /> : <Check className="size-4" />} Salvar Configurações
        </Button>
      </div>

      {/* Change Password Card */}
      <Card className="shadow-lg border-0">
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-rose-100 dark:bg-rose-900/30">
              <Lock className="size-4 text-rose-600" />
            </div>
            <CardTitle className="text-lg">Alterar Senha</CardTitle>
          </div>
          <CardDescription>Altere a senha de acesso do administrador</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Senha Atual</Label>
            <Input type="password" placeholder="••••••" value={passwordForm.currentPassword}
              onChange={e => setPasswordForm(p => ({ ...p, currentPassword: e.target.value }))} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Nova Senha</Label>
              <Input type="password" placeholder="Mínimo 6 caracteres" value={passwordForm.newPassword}
                onChange={e => setPasswordForm(p => ({ ...p, newPassword: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Confirmar Nova Senha</Label>
              <Input type="password" placeholder="Repita a nova senha" value={passwordForm.confirmPassword}
                onChange={e => setPasswordForm(p => ({ ...p, confirmPassword: e.target.value }))} />
            </div>
          </div>
          <div className="flex justify-end">
            <Button className="gap-2" onClick={changePassword}
              disabled={changingPassword || !passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword}>
              {changingPassword ? <RefreshCw className="size-4 animate-spin" /> : <Lock className="size-4" />}
              {changingPassword ? 'Alterando...' : 'Alterar Senha'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

