'use client'

// Extracted verbatim from src/app/page.tsx (P2.1-split-4).
// All logic preserved — pure mechanical extraction.
// This is the renamed OctupusZapApp component (now `AppShell`), which owns all auth
// state, the live clock, stats polling, the campaigns auto-process loop, and the
// sidebar + content + footer shell.
//
// The inline login screen JSX (originally inline in OctupusZapApp's `if (!loggedIn)`
// branch) was extracted to `src/components/LoginScreen.tsx` as a pure presentational
// component. AppShell renders `<LoginScreen {...loginProps} />` instead. All state
// and setters are passed to LoginScreen with their original names so the inline
// event handlers (setLoginForm / setLoginError / etc.) work verbatim.
//
// page.tsx is now a 1-line re-export: `export default function Page() { return <AppShell /> }`.

import dynamic from 'next/dynamic'
import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { LogOut, Menu, Moon, RefreshCw, Sun, X, Zap } from 'lucide-react'
import { useTheme } from 'next-themes'
import { type Stats } from '@/lib/types'
import { NAV_ITEMS, ROLE_LEVELS } from '@/components/shared/nav-config'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from 'sonner'

// Inline tabs (split out by P2.1-split-4)
import { DashboardTab } from '@/components/tabs/DashboardTab'
import { ChipsTab } from '@/components/tabs/ChipsTab'
import { ContatosTab } from '@/components/tabs/ContatosTab'
import { TemplatesTab } from '@/components/tabs/TemplatesTab'
import { MensagensTab } from '@/components/tabs/MensagensTab'
import { UsuariosTab } from '@/components/tabs/UsuariosTab'
import { VpsSetupTab } from '@/components/tabs/VpsSetupTab'
import { ConfiguracoesTab } from '@/components/tabs/ConfiguracoesTab'

// Login screen (extracted from OctupusZapApp's `if (!loggedIn)` branch)
import { LoginScreen } from '@/components/LoginScreen'

// Lazy loaded components (code splitting) — verbatim from original page.tsx.
const VerificarSection = dynamic(() => import('@/components/verificar-section').then(m => ({ default: m.VerificarSection })), { loading: () => <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div> })
const KeysSection = dynamic(() => import('@/components/keys-section').then(m => ({ default: m.KeysSection })), { loading: () => <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div> })
const VendedoresSection = dynamic(() => import('@/components/vendedores-section').then(m => ({ default: m.VendedoresSection })), { loading: () => <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div> })
const AntiBanTab = dynamic(() => import('@/components/antiban').then(m => ({ default: m.AntiBanTab })), { loading: () => <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div> })
const LeadsTab = dynamic(() => import('./tabs/LeadsTab'), { ssr: false })
const WarmingTab = dynamic(() => import('@/components/warming-tab').then(m => ({ default: m.WarmingTab })), { loading: () => <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div> })
const CampanhasTab = dynamic(() => import('@/components/campanhas').then(m => ({ default: m.CampanhasTab })), { loading: () => <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div> })
const InboxTab = dynamic(() => import('@/components/inbox-tab').then(m => ({ default: m.InboxTab })), { loading: () => <div className="flex items-center justify-center py-20"><RefreshCw className="size-6 animate-spin text-muted-foreground" /></div> })


// ===== Theme Toggle Component =====
function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => setMounted(true), [])

  if (!mounted) {
    return <div className="h-8 w-8" />
  }

  const isDark = theme === 'dark'

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="text-zinc-400 hover:text-amber-400 h-8 w-8 p-0"
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
          >
            {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{isDark ? 'Modo claro' : 'Modo escuro'}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

// ===== Main App =====
export function AppShell() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [stats, setStats] = useState<Stats | null>(null)
  const [loggedIn, setLoggedIn] = useState(false)
  const [username, setUsername] = useState('')
  const [userRole, setUserRole] = useState('operador')
  const [authLoading, setAuthLoading] = useState(true)
  const [loginForm, setLoginForm] = useState({ email: '', password: '' })
  const [loginLoading, setLoginLoading] = useState(false)
  const [loginError, setLoginError] = useState('')
  const [loginErrorType, setLoginErrorType] = useState<'credentials' | 'locked' | 'database' | 'internal' | ''>('')
  const [forgotDialogOpen, setForgotDialogOpen] = useState(false)
  const [forgotForm, setForgotForm] = useState({ newPassword: '', confirmPassword: '', verificationKey: '' })
  const [forgotLoading, setForgotLoading] = useState(false)

  // Live clock — Brasília time (UTC-3)
  // PERF FIX: Only update seconds every 1s. Date and time (HH:MM) only change
  // once per day / once per minute respectively, so we skip redundant setState
  // calls that would cause unnecessary re-renders of the entire OctupusZapApp.
  const [brasiliaTime, setBrasiliaTime] = useState('')
  const [brasiliaDate, setBrasiliaDate] = useState('')
  const [brasiliaSeconds, setBrasiliaSeconds] = useState('')
  const lastTimeRef = useRef('')
  const lastDateRef = useRef('')
  useEffect(() => {
    const update = () => {
      const now = new Date()
      const fmt = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
      })
      const parts = fmt.formatToParts(now)
      const get = (type: string) => parts.find(p => p.type === type)?.value || ''
      const newDate = `${get('day')}/${get('month')}/${get('year')}`
      const newTime = `${get('hour')}:${get('minute')}`

      // Only update date if it changed (once per day)
      if (newDate !== lastDateRef.current) {
        lastDateRef.current = newDate
        setBrasiliaDate(newDate)
      }
      // Only update time if it changed (once per minute)
      if (newTime !== lastTimeRef.current) {
        lastTimeRef.current = newTime
        setBrasiliaTime(newTime)
      }
      // Always update seconds (once per second)
      setBrasiliaSeconds(get('second'))
    }
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    fetch('/api/auth/session').then(r => r.json()).then(data => {
      if (data.authenticated) {
        setLoggedIn(true)
        setUsername(data.user?.username || '')
        setUserRole(data.user?.role || 'operador')
        // Request browser notification permission for chip disconnect alerts
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
          Notification.requestPermission().catch(() => {})
        }
        // If active tab is not accessible with user's role, reset to dashboard
        const userLevel = ROLE_LEVELS[data.user?.role || 'operador'] || 1
        const currentItem = NAV_ITEMS.find(n => n.id === activeTab)
        if (currentItem) {
          const requiredLevel = ROLE_LEVELS[currentItem.minRole] || 1
          if (userLevel < requiredLevel) setActiveTab('dashboard')
        }
      }
    }).catch(() => {}).finally(() => setAuthLoading(false))
  }, [])

  // Auto-refresh stats every 15 seconds when logged in
  // PERF FIX: was 5s, now 15s. Stats don't change fast enough to justify 5s polling.
  useEffect(() => {
    if (!loggedIn) return
    fetch('/api/stats').then(r => r.json()).then(setStats).catch(() => {})
    const interval = setInterval(() => {
      fetch('/api/stats').then(r => r.json()).then(setStats).catch(() => {})
    }, 15000)
    return () => clearInterval(interval)
  }, [loggedIn])

  // Auto-process campaigns every 120 seconds when logged in
  // This is a BACKUP — the continuous processing loop is the primary driver.
  // We use a longer interval (120s instead of 60s) to reduce the chance of
  // concurrent invocations that could cause race conditions with the sending engine.
  // The atomic campaign slot claim in the sending engine handles concurrent access,
  // but reducing unnecessary concurrent calls is still good practice.
  useEffect(() => {
    if (!loggedIn) return
    const processCampaigns = () => {
      fetch('/api/campaigns/process', { method: 'POST' }).catch(() => {})
    }
    // First process after 15 seconds (give time for page to load)
    const timeout = setTimeout(processCampaigns, 15000)
    // Then every 120 seconds
    const interval = setInterval(processCampaigns, 120000)
    return () => { clearTimeout(timeout); clearInterval(interval) }
  }, [loggedIn])

  const refreshStats = () => {
    fetch('/api/stats').then(r => r.json()).then(setStats).catch(() => {})
  }

  const handleLogin = async () => {
    setLoginLoading(true)
    setLoginError('')
    setLoginErrorType('')
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm),
      })
      const data = await res.json()
      if (!res.ok) {
        // Detect error type from HTTP status code
        if (res.status === 429) {
          setLoginErrorType('locked')
          setLoginError(data.error || 'Muitas tentativas de login falharam. Tente novamente em 5 minutos.')
        } else if (res.status === 401) {
          setLoginErrorType('credentials')
          setLoginError(data.error || 'Email ou senha incorretos.')
        } else if (res.status === 503) {
          setLoginErrorType('database')
          setLoginError(data.error || 'Erro de conexão com o banco de dados.')
        } else {
          setLoginErrorType('internal')
          setLoginError(data.error || 'Erro interno do servidor.')
        }
        throw new Error(data.error || 'Erro ao fazer login')
      }
      setLoggedIn(true)
      setUsername(data.user?.name || loginForm.email)
      setUserRole(data.user?.role || 'operador')
      toast.success('Login realizado com sucesso!')
    } catch (err: unknown) { toast.error((err as Error).message || 'Erro ao fazer login') }
    finally { setLoginLoading(false) }
  }

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
      setLoggedIn(false)
      setUsername('')
      toast.success('Logout realizado!')
    } catch { toast.error('Erro ao fazer logout') }
  }

  const handleForgotPassword = async () => {
    if (!forgotForm.newPassword || forgotForm.newPassword.length < 6) {
      toast.error('A nova senha deve ter pelo menos 6 caracteres')
      return
    }
    if (forgotForm.newPassword !== forgotForm.confirmPassword) {
      toast.error('As senhas não conferem')
      return
    }
    setForgotLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: forgotForm.newPassword, verificationKey: forgotForm.verificationKey }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao redefinir senha')
      toast.success('Senha redefinida com sucesso! Faça login com a nova senha.')
      setForgotDialogOpen(false)
      setForgotForm({ newPassword: '', confirmPassword: '', verificationKey: '' })
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro ao redefinir senha')
    } finally {
      setForgotLoading(false)
    }
  }

  const renderContent = () => {
    const tabFallback = (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
    
    switch (activeTab) {
      case 'dashboard': return <DashboardTab stats={stats} onRefresh={refreshStats} setActiveTab={setActiveTab} />
      case 'chips': return <ChipsTab />
      case 'inbox': return <InboxTab />
      case 'contatos': return <ContatosTab />
    case 'leads': return <LeadsTab />
      case 'verificar': return <VerificarSection />
      case 'campanhas': return <CampanhasTab />
      case 'templates': return <TemplatesTab />
      case 'chaves': return <KeysSection />
      case 'vendedores': return <VendedoresSection />
      case 'antiban': return <AntiBanTab />
      case 'aquecimento': return <WarmingTab />
      case 'mensagens': return <MensagensTab />
      case 'usuarios': return <UsuariosTab />
      case 'vps': return <VpsSetupTab />
      case 'config': return <ConfiguracoesTab />
      default: return <DashboardTab stats={stats} onRefresh={refreshStats} setActiveTab={setActiveTab} />
    }
  }


  // Auth loading state
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <RefreshCw className="size-8 animate-spin text-emerald-500" />
      </div>
    )
  }

  // Login screen — extracted to src/components/LoginScreen.tsx (P2.1-split-4).
  // All state and setters are passed through with their original names so the
  // inline event handlers in LoginScreen work verbatim.
  if (!loggedIn) {
    return (
      <LoginScreen
        loginForm={loginForm}
        setLoginForm={setLoginForm}
        loginLoading={loginLoading}
        loginError={loginError}
        loginErrorType={loginErrorType}
        setLoginError={setLoginError}
        setLoginErrorType={setLoginErrorType}
        forgotDialogOpen={forgotDialogOpen}
        setForgotDialogOpen={setForgotDialogOpen}
        forgotForm={forgotForm}
        setForgotForm={setForgotForm}
        forgotLoading={forgotLoading}
        handleLogin={handleLogin}
        handleForgotPassword={handleForgotPassword}
      />
    )
  }

  return (
    <div className="h-screen flex overflow-hidden bg-zinc-50 dark:bg-zinc-950">
      {/* Sidebar - Desktop */}
      <aside className="hidden lg:flex w-64 flex-col bg-zinc-900 dark:bg-zinc-950 border-r border-zinc-800 shrink-0 overflow-hidden">
        <div className="p-6">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 shadow-lg">
              <Zap className="size-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">OctupusZap</h1>
              <p className="text-xs text-zinc-400">Mass Messaging SaaS</p>
            </div>
          </div>
        </div>

        <ScrollArea className="flex-1 min-h-0 px-3">
          <div className="space-y-1 py-1">
          {NAV_ITEMS.filter(item => {
            const userLevel = ROLE_LEVELS[userRole] || 1
            const requiredLevel = ROLE_LEVELS[item.minRole] || 1
            return userLevel >= requiredLevel
          }).map(item => (
            <button key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                activeTab === item.id
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/25'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
              }`}>
              <item.icon className="size-4" />
              {item.label}
            </button>
          ))}
          </div>
        </ScrollArea>

        <div className="shrink-0 p-4 m-3 rounded-xl bg-zinc-800/50 space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 shadow-md">
              <span className="text-sm font-bold text-white">{username ? username.charAt(0).toUpperCase() : 'O'}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{username || 'OctupusZap'}</p>
              <p className="text-xs text-zinc-400">{userRole === 'master' ? 'Master' : userRole === 'admin' ? 'Admin' : 'Operador'}</p>
            </div>
            <ThemeToggle />
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-zinc-400 hover:text-rose-400 h-8 w-8 p-0" onClick={handleLogout}>
                    <LogOut className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Sair</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="flex items-center gap-2 px-1">
            <span className="relative flex size-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full size-2 bg-emerald-500"></span>
            </span>
            <span className="text-xs text-zinc-500">Auto-refresh 60s • Auto-deploy</span>
          </div>
        </div>
      </aside>

      {/* Mobile sidebar overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
            <motion.aside initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }}
              className="fixed left-0 top-0 bottom-0 w-64 bg-zinc-900 z-50 lg:hidden flex flex-col">
              <div className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 shadow-lg">
                      <Zap className="size-5 text-white" />
                    </div>
                    <h1 className="text-lg font-bold text-white">OctupusZap</h1>
                  </div>
                  <Button variant="ghost" size="sm" className="text-white" onClick={() => setSidebarOpen(false)}>
                    <X className="size-5" />
                  </Button>
                </div>
              </div>
              <ScrollArea className="flex-1 min-h-0 px-3">
                <div className="space-y-1 py-1">
                {NAV_ITEMS.filter(item => {
                  const userLevel = ROLE_LEVELS[userRole] || 1
                  const requiredLevel = ROLE_LEVELS[item.minRole] || 1
                  return userLevel >= requiredLevel
                }).map(item => (
                  <button key={item.id}
                    onClick={() => { setActiveTab(item.id); setSidebarOpen(false) }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                      activeTab === item.id
                        ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/25'
                        : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                    }`}>
                    <item.icon className="size-4" />
                    {item.label}
                  </button>
                ))}
                </div>
              </ScrollArea>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Top Bar */}
        <header className="shrink-0 z-30 flex items-center gap-4 px-4 lg:px-6 h-14 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md border-b">
          <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
            <Menu className="size-5" />
          </Button>

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Zap className="size-4 text-emerald-500 lg:hidden" />
            <span className="font-medium text-foreground">{NAV_ITEMS.find(n => n.id === activeTab)?.label || 'Dashboard'}</span>
          </div>

          <div className="flex-1" />

          {/* Relógio Brasília — sempre visível */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground select-none">
            <span className="font-medium">{brasiliaDate}</span>
            <span className="text-foreground font-semibold tabular-nums text-sm">{brasiliaTime}</span>
            <span className="text-xs tabular-nums text-muted-foreground">{brasiliaSeconds}</span>
          </div>

        </header>

        {/* Page Content */}
        <main className="flex-1 min-h-0 p-4 lg:p-6 pb-8 overflow-hidden">
          <div className={activeTab === 'inbox' ? 'h-full' : 'h-full overflow-y-auto'}>
            <AnimatePresence mode="wait">
              <motion.div key={activeTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }} className={activeTab === 'inbox' ? 'h-full' : ''}>
                {renderContent()}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>

        {/* Footer */}
        <footer className="shrink-0 px-4 lg:px-6 py-2.5 border-t bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <p>OctupusZap © {new Date().getFullYear()}</p>
            <p className="flex items-center gap-1">
              <Zap className="size-3 text-emerald-500" /> Powered by OctupusZap
            </p>
          </div>
        </footer>
      </div>
    </div>
  )
}
