# Task: OctupusZap Contact List Management Features

## Summary
Implemented three major features for the OctupusZap contact list management:
1. **Drag-and-drop reorder** - Contacts can be reordered via drag-and-drop with position persistence
2. **Bulk selection and delete** - Contacts can be selected via checkboxes and bulk deleted
3. **Position-based ordering** - Contact ordering now uses a `position` field instead of `createdAt`

## Changes Made

### 1. Prisma Schema (`prisma/schema.prisma`)
- Added `position Int @default(0)` field to the `Contact` model

### 2. New API: Reorder (`src/app/api/contact-lists/[id]/contacts/reorder/route.ts`)
- PATCH endpoint that accepts `{ contactIds: string[] }` and updates positions in a transaction

### 3. New API: Bulk Delete (`src/app/api/contacts/bulk-delete/route.ts`)
- POST endpoint that accepts `{ contactIds: string[] }` and deletes multiple contacts via `deleteMany`

### 4. Updated Queries
- `src/app/api/contact-lists/[id]/contacts/route.ts`: Changed `orderBy` from `createdAt: 'desc'` to `[{ position: 'asc' }, { createdAt: 'asc' }]`; Added `position: existingCount` on contact creation
- `src/app/api/contact-lists/[id]/route.ts`: Changed `orderBy` to `[{ position: 'asc' }, { createdAt: 'asc' }]`
- `src/lib/sending-engine.ts`: Added `orderBy` to contacts include in campaign query

### 5. UI Changes (`src/app/page.tsx`)
- Added `verticalListSortingStrategy` and `restrictToVerticalAxis` imports
- Added `position` to `ContactItem` interface
- Created `SortableContactRow` component with DnD + checkbox support
- Added state: `selectedContactIds`, `bulkDeleteConfirm`, `contactDragSensors`
- Added functions: `handleContactDragEnd`, `bulkDeleteContacts`, `toggleContactSelection`, `toggleSelectAll`
- Replaced static table body with DnD-enabled `DndContext` + `SortableContext` + `SortableContactRow`
- Added checkbox and grip columns to both header and body tables
- Added bulk action toolbar (shown when contacts are selected)
- Added bulk delete confirmation dialog

### 6. Database Migration
- Prisma client regenerated with `npx prisma generate`
- Note: `prisma db push` could not be run in this environment (no PostgreSQL available)
- For production deployment, run the SQL migration script provided in the task spec

## Notes
- The `prisma db push` command fails in the current sandbox environment because the DATABASE_URL points to a SQLite file while the schema uses PostgreSQL provider. This is a pre-existing configuration issue, not caused by our changes.
- TypeScript compilation passes with zero errors (`npx tsc --noEmit` succeeds)
- The lint errors are pre-existing in the `scripts/` folder (not related to our changes)
