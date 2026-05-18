'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard,
  Smartphone,
  Megaphone,
  MessageSquare,
  Menu,
  X,
  Moon,
  Sun,
  Zap,
  Key,
  Users,
  Shield,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { DashboardSection } from '@/components/dashboard-section'
import { ChipsSection } from '@/components/chips-section'
import { CampaignsSection } from '@/components/campaigns-section'
import { MessagesSection } from '@/components/messages-section'
import { KeysSection } from '@/components/keys-section'
import { VendedoresSection } from '@/components/vendedores-section'
import { AntibanSection } from '@/components/antiban-section'

type Section = 'dashboard' | 'chips' | 'campanhas' | 'mensagens' | 'chaves' | 'vendedores' | 'antiban'

const navItems: { id: Section; label: string; icon: React.ElementType; group?: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'principal' },
  { id: 'chips', label: 'Chips', icon: Smartphone, group: 'principal' },
  { id: 'campanhas', label: 'Campanhas', icon: Megaphone, group: 'principal' },
  { id: 'mensagens', label: 'Mensagens', icon: MessageSquare, group: 'principal' },
  { id: 'chaves', label: 'Chaves', icon: Key, group: 'personalização' },
  { id: 'vendedores', label: 'Vendedores', icon: Users, group: 'personalização' },
  { id: 'antiban', label: 'Anti-Ban', icon: Shield, group: 'configuração' },
]

const groupLabels: Record<string, string> = {
  principal: '',
  personalização: 'Personalização',
  configuração: 'Configuração',
}

export function OctupusZap() {
  const [activeSection, setActiveSection] = useState<Section>('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { theme, setTheme } = useTheme()

  const renderSection = () => {
    switch (activeSection) {
      case 'dashboard':
        return <DashboardSection />
      case 'chips':
        return <ChipsSection />
      case 'campanhas':
        return <CampaignsSection />
      case 'mensagens':
        return <MessagesSection />
      case 'chaves':
        return <KeysSection />
      case 'vendedores':
        return <VendedoresSection />
      case 'antiban':
        return <AntibanSection />
      default:
        return <DashboardSection />
    }
  }

  const sectionLabels: Record<Section, string> = {
    dashboard: 'Dashboard',
    chips: 'Chips',
    campanhas: 'Campanhas',
    mensagens: 'Mensagens',
    chaves: 'Chaves de Variação',
    vendedores: 'Vendedores',
    antiban: 'Anti-Ban',
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex flex-1">
        {/* Mobile overlay */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40 lg:hidden"
              onClick={() => setSidebarOpen(false)}
            />
          )}
        </AnimatePresence>

        {/* Sidebar */}
        <aside
          className={`
            fixed lg:static inset-y-0 left-0 z-50 w-64 bg-zinc-900 border-r border-zinc-800
            transform transition-transform duration-200 ease-in-out lg:translate-x-0
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          `}
        >
          <div className="flex flex-col h-full">
            {/* Logo area */}
            <div className="flex items-center gap-3 px-6 py-5 border-b border-zinc-800">
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-emerald-600">
                <Zap className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-white">OctupusZap</h1>
                <p className="text-xs text-zinc-400">WhatsApp Mass Sender</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto lg:hidden text-zinc-400 hover:text-white"
                onClick={() => setSidebarOpen(false)}
              >
                <X className="w-5 h-5" />
              </Button>
            </div>

            {/* Navigation */}
            <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
              {(() => {
                let lastGroup = ''
                return navItems.map((item) => {
                  const Icon = item.icon
                  const isActive = activeSection === item.id
                  const group = item.group || ''
                  const showGroupLabel = group !== lastGroup && groupLabels[group]
                  lastGroup = group
                  return (
                    <div key={item.id}>
                      {showGroupLabel && (
                        <p className="text-[10px] uppercase tracking-wider text-zinc-600 font-semibold mt-4 mb-1 px-3">
                          {groupLabels[group]}
                        </p>
                      )}
                      <button
                        onClick={() => {
                          setActiveSection(item.id)
                          setSidebarOpen(false)
                        }}
                        className={`
                          w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
                          transition-colors duration-150
                          ${
                            isActive
                              ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-600/30'
                              : 'text-zinc-400 hover:text-white hover:bg-zinc-800 border border-transparent'
                          }
                        `}
                      >
                        <Icon className="w-5 h-5" />
                        {item.label}
                      </button>
                    </div>
                  )
                })
              })()}
            </nav>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-zinc-800">
              <p className="text-xs text-zinc-500">OctupusZap v2.0</p>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top bar */}
          <header className="sticky top-0 z-30 flex items-center justify-between h-16 px-4 sm:px-6 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                onClick={() => setSidebarOpen(true)}
              >
                <Menu className="w-5 h-5" />
              </Button>
              <h2 className="text-lg font-semibold">
                {sectionLabels[activeSection]}
              </h2>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="text-muted-foreground hover:text-foreground"
              >
                {theme === 'dark' ? (
                  <Sun className="w-5 h-5" />
                ) : (
                  <Moon className="w-5 h-5" />
                )}
              </Button>
            </div>
          </header>

          {/* Content area */}
          <main className="flex-1 p-4 sm:p-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeSection}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                {renderSection()}
              </motion.div>
            </AnimatePresence>
          </main>

          {/* Sticky footer */}
          <footer className="mt-auto border-t border-border px-4 sm:px-6 py-3">
            <p className="text-xs text-muted-foreground text-center">
              OctupusZap — Ferramenta de envio em massa via WhatsApp com integração WireGuard
            </p>
          </footer>
        </div>
      </div>
    </div>
  )
}
