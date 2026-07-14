// ===== Navigation Items =====
// Role hierarchy: master > admin > operador
// Extracted verbatim from src/app/page.tsx (P2.1-split-4).
import {
  BarChart3, Smartphone, Inbox, Users, ShieldCheck, Send, FileText,
  Key, Flame, MessageSquare, UserPlus, Server, Settings, Shield,
} from 'lucide-react'

export const ROLE_LEVELS: Record<string, number> = { master: 3, admin: 2, operador: 1 }

export const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: BarChart3, minRole: 'operador' },
  { id: 'chips', label: 'Chips', icon: Smartphone, minRole: 'operador' },
  { id: 'inbox', label: 'Caixa de Entrada', icon: Inbox, minRole: 'operador' },
  { id: 'contatos', label: 'Lista de Contatos', icon: Users, minRole: 'operador' },
  { id: 'verificar', label: 'Verificar Números', icon: ShieldCheck, minRole: 'operador' },
  { id: 'campanhas', label: 'Campanhas', icon: Send, minRole: 'operador' },
  { id: 'templates', label: 'Templates', icon: FileText, minRole: 'operador' },
  { id: 'chaves', label: 'Chaves', icon: Key, minRole: 'admin' },
  { id: 'vendedores', label: 'Vendedores', icon: Users, minRole: 'admin' },
  { id: 'antiban', label: 'Anti-Ban', icon: Shield, minRole: 'admin' },
  { id: 'aquecimento', label: 'Aquecimento', icon: Flame, minRole: 'admin' },
  { id: 'mensagens', label: 'Mensagens', icon: MessageSquare, minRole: 'operador' },
  { id: 'usuarios', label: 'Usuários', icon: UserPlus, minRole: 'master' },
  { id: 'vps', label: 'VPS / Proxy', icon: Server, minRole: 'master' },
  { id: 'config', label: 'Configurações', icon: Settings, minRole: 'master' },
]
