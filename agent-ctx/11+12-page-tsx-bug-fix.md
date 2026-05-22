# Task 11+12: Fix silent HTTP error patterns and duplicate className in page.tsx

## Summary

Fixed 2 of 6 identified issues in the main `src/app/page.tsx` file (8139 lines). The other 4 were intentionally left as-is per task instructions (background/best-effort operations).

## Changes Made

### Fix 1: openProxyDialog (~line 1030) — ADDED toast.error
- **Before**: When `fetch(/api/wireguard/${chip.id})` returned non-OK, the else block silently cleared state
- **After**: Added `toast.error('Erro ao carregar configuração do proxy')` before the state cleanup
- This is a user-facing action (clicking to view proxy config), so a toast is appropriate

### Fix 2: Resend messages (~line 4578) — ALREADY HANDLED
- The else block already had `toast.error(data.error || 'Erro ao reenviar')` 
- No change needed

### Fix 3-5: Background operations — INTENTIONALLY SKIPPED
- Inbox sync (~line 5990): Background polling, would be annoying with toasts
- fetchAntiBanSettings (~line 670): Best-effort settings load
- WhatsApp status sync (~line 745): Background best-effort sync

### Fix 6: Duplicate className (~lines 2187/2206) — FIXED
- **Before**: `<h3 className="text-lg font-semibold" ... className="text-lg font-semibold outline-none ...">`
- **After**: `<h3 ... className="text-lg font-semibold outline-none ...">`
- Removed the first (incomplete) className, kept the second (complete) one
- React only uses the last duplicate attribute, but duplicate props are invalid JSX

## Lint Status
All pre-existing errors (5 total) are in other files. No new errors introduced.
