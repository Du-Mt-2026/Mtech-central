# Task 1: Fix Silent HTTP Error Handling

## Summary
Fixed all 13 silent HTTP error patterns across 8 frontend component files where `if (res.ok)` blocks had no corresponding `else` block, causing HTTP errors (e.g., 500) to be silently ignored.

## Files Modified
1. `src/components/campaigns-section.tsx` — 4 fixes (fetchCampaigns, fetchChips, fetchVendedores, fetchKeys)
2. `src/components/messages-section.tsx` — 2 fixes (fetchMessages, fetchFilters with both campaignsRes and chipsRes)
3. `src/components/chips-section.tsx` — 1 fix (fetchChips)
4. `src/components/keys-section.tsx` — 1 fix (fetchKeys)
5. `src/components/vendedores-section.tsx` — 2 fixes (fetchVendedores, toggleAtivo)
6. `src/components/verificar-section.tsx` — 2 fixes (fetchChipQuotas, openAddToListDialog)
7. `src/components/dashboard-section.tsx` — 1 fix (fetchStats) + added useToast import/hook
8. `src/components/antiban-section.tsx` — 1 fix (fetchSettings)

## Pattern Applied
- For components using `useToast()` from `@/hooks/use-toast`: `else { toast({ title: 'Erro ao ...', variant: 'destructive' }) }`
- For components using `toast` from `sonner`: `else { toast.error('Erro ao ...') }`

## Additional Notes
- Updated fetchFilters dependency array from `[]` to `[toast]` in messages-section.tsx
- Added useToast import and hook to dashboard-section.tsx (was missing entirely)
- No catch blocks were modified
- Lint check passes (6 pre-existing errors unrelated to these changes)
