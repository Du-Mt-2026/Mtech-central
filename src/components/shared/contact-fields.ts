// Extracted verbatim from src/app/page.tsx (P2.1-split-4).
// ===== Standard Contact Fields (always shown) =====
export const STANDARD_CONTACT_FIELDS = [
  { header: 'Nome', key: 'nome', core: true },       // maps to contact.name
  { header: 'Telefone', key: 'telefone', core: true }, // maps to contact.phone
  { header: 'Codigo', key: 'codigo', core: false },
  { header: 'Empresa', key: 'empresa', core: false },
  { header: 'Vendedora', key: 'vendedora', core: false },
  { header: 'Whatsapp', key: 'whatsapp', core: false },
  { header: 'Nota', key: 'nota', core: false },
] as const
