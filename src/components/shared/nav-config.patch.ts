// ============================================================
// PATCH PARA: src/components/shared/nav-config.ts
// (este arquivo é apenas referência — não é importado)
//
// INSTRUÇÕES:
// 1. Abra src/components/shared/nav-config.ts
// 2. Adicione o import do Building2 (se ainda não tiver):
//      import { Building2 } from 'lucide-react';
// 3. Encontre o array de itens de navegação (deve ter algo como
//    { id: 'contatos', ... } ou similar)
// 4. Adicione o item abaixo DEPOIS do item 'contatos' e ANTES do
//    próximo item (geralmente 'verificar' ou similar):
//
//      {
//        id: 'leads',
//        label: 'Leads & CNPJ',
//        icon: Building2,
//        minRole: 'operador',
//      },
// ============================================================
export const navItemLeads = {
  id: 'leads',
  label: 'Leads & CNPJ',
  icon: 'Building2',
  minRole: 'operador',
};
