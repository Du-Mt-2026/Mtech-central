// ============================================================
// PATCH PARA: src/components/AppShell.tsx
// (este arquivo é apenas referência — não é importado)
//
// INSTRUÇÕES:
// 1. Abra src/components/AppShell.tsx
// 2. Adicione este import junto com os outros imports de tabs:
//
//      import LeadsTab from './tabs/LeadsTab';
//
// 3. Encontre o switch/case que renderiza a tab ativa:
//      switch (activeTab) {
//        case 'contatos':
//          return <ContatosTab />;
//        ...
//      }
//
// 4. Adicione o case abaixo antes do default:
//
//      case 'leads':
//        return <LeadsTab />;
// ============================================================
export const appShellCase = `
  case 'leads':
    return <LeadsTab />;
`;
