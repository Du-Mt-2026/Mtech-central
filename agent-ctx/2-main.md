# Task 2 - ChipsTab Sync/Import + Card Styling Improvements

## Summary
Updated ChipsTab component with Evolution API sync/import buttons and improved chip card styling.

## Changes Made

### Database Schema
- Added `disconnectionReasonCode Int?` field to Chip model in `prisma/schema.prisma`
- Pushed schema to Neon PostgreSQL

### Backend API Routes
- **sync-instances/route.ts**: Updated to save `disconnectionReasonCode` from Evolution API instances
- **import-instances/route.ts**: Updated to save `disconnectionReasonCode` on both create and link paths

### Frontend (page.tsx)
- Added Lucide icon imports: `Database`, `WifiOff`, `ArrowDownToLine`
- Added `Checkbox` component import
- Added `disconnectionReasonCode` to Chip TypeScript interface
- Added 6 new state variables to ChipsTab for sync/import functionality
- Added 4 new functions: `syncEvolutionApi`, `openImportDialog`, `importSelectedInstances`, `toggleInstanceSelection`
- Added "Sincronizar Evolution API" button with loading spinner
- Added "Importar Instâncias" button that opens dialog
- Created Import Instances Dialog with checkboxes, profile pics, status badges, select all/deselect all
- Improved chip card styling: prominent profile pics, "Dispositivo removido" badge (401), monospace instance names
- Fixed JSX nesting for button group wrapper

## Lint Status
✅ Passes clean
