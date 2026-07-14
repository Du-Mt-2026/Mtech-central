'use client'

// v2025.05.19-horizontal-layout
//
// P2.1-split-4 refactor: this file used to be a 5,537-line monolith containing every
// inline tab (Dashboard, Chips, Contatos, Templates, Mensagens, Usuarios, VpsSetup,
// Configuracoes), the LoginScreen, the OctupusZapApp shell, NAV_ITEMS, the useIsVisible
// hook, the SVG chart helpers, and the STANDARD_CONTACT_FIELDS constant.
//
// All of those have been mechanically extracted into:
//   - src/components/AppShell.tsx              — the OctupusZapApp shell (sidebar + content + footer)
//                                                plus the auth/login state, the live clock,
//                                                stats polling, and the campaigns auto-process loop.
//   - src/components/LoginScreen.tsx           — the login screen + forgot-password dialog (pure
//                                                presentational component, props passed from AppShell).
//   - src/components/shared/nav-config.ts      — NAV_ITEMS + ROLE_LEVELS.
//   - src/components/shared/use-is-visible.ts  — useIsVisible hook.
//   - src/components/shared/contact-fields.ts  — STANDARD_CONTACT_FIELDS constant.
//   - src/components/tabs/DashboardTab.tsx     — Dashboard tab (+ inline DonutChart/MiniBarChart).
//   - src/components/tabs/ChipsTab.tsx         — Chips tab.
//   - src/components/tabs/ContatosTab.tsx      — Contatos tab (+ inline SortableContactRow).
//   - src/components/tabs/TemplatesTab.tsx     — Templates tab.
//   - src/components/tabs/MensagensTab.tsx     — Mensagens tab.
//   - src/components/tabs/UsuariosTab.tsx      — Usuarios tab (+ inline AuditLogSection).
//   - src/components/tabs/VpsSetupTab.tsx      — VPS / Proxy setup tab.
//   - src/components/tabs/ConfiguracoesTab.tsx — Configuracoes tab.
//
// The lazy-loaded tabs (VerificarSection, KeysSection, VendedoresSection, AntiBanTab,
// WarmingTab, CampanhasTab, InboxTab) remain dynamic-imported from their existing
// locations; those dynamic imports now live in AppShell.tsx.
//
// page.tsx is now a thin re-export of <AppShell />. The auth-state + checkSession
// useEffect lives inside AppShell (per task rule 8 — "pick one and document"). This
// preserves 100% of the original logic: every state variable, every useEffect, every
// handler, every JSX line is identical to the pre-split page.tsx — only its physical
// location has changed.

import { AppShell } from '@/components/AppShell'

export default function Page() {
  return <AppShell />
}
