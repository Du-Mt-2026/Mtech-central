# Campaign Transparency Feature - Work Log

**Task ID**: campaign-transparency
**Agent**: main
**Date**: 2025-01-22

## Summary

Implemented 7 campaign transparency features to help users understand what's happening with their campaigns.

## Changes Made

### Task 1: Show `statusReason` in the UI
- Added `statusReason` and `pausedAt` fields to the `Campaign` interface in `page.tsx`
- Added amber-colored alert text below the StatusBadge in the campaign list (CampanhasTab) when a campaign is paused with a reason
- Added a prominent amber Alert component at the top of the campaign detail dialog for paused campaigns with a statusReason

### Task 2: Fix WhatsApp warning bug
- In `sending-engine.ts` line ~1472, the WhatsApp warning auto-pause now sets `statusReason` to 'Campanha pausada automaticamente — aviso de spam detectado pelo WhatsApp. Retome com cautela.'
- Also added `pausedAt: new Date()` to the same update

### Task 3: Add toasts for chip ban/disconnect during campaign processing
- Extended `processNextMessage` return type to include optional `events` array
- Added event objects at all chip ban/disconnect/auto-pause points in sending-engine.ts:
  - `chip_disconnected` events when chips disconnect
  - `chip_banned` events when chips get banned
  - `campaign_auto_paused` events when campaigns are auto-paused
- Updated `/api/campaigns/process/route.ts` to collect events and enrich them with campaign names
- Added event response field to the process API response
- Added toast notifications in page.tsx continuous processing loop for all event types

### Task 4: Show ALL ban codes on chip cards
- Replaced the `disconnectionReasonCode === 401` check with a comprehensive check for all codes:
  - 401: 'Dispositivo removido'
  - 403: 'Banido pelo WhatsApp'
  - 428: 'Dispositivo substituído'
  - 440: 'Dispositivo desconectado'
  - Others: 'Código {code}'
- Applied to both chip cards and unlinked instance badges

### Task 5: "Resend Failed" button in campaign detail dialog
- Added a button next to the Refresh button in the detail dialog header
- Only shows when there are failed messages (`messageStatusCounts.failed > 0`)
- Calls `/api/messages/resend-all-failed` with campaignId
- Shows count of reset messages via toast
- Refreshes the message list and campaign list after resend

### Task 6: Add `pausedAt` to Campaign model
- Added `pausedAt DateTime?` field to the Campaign model in `prisma/schema.prisma`
- Added `pausedAt: new Date()` to all places where `status: 'paused'` is set in sending-engine.ts (3 locations)
- Updated resume route (`/api/campaigns/[campaignId]/resume/route.ts`) to clear `pausedAt: null` when resuming
- Updated PATCH route (`/api/campaigns/[campaignId]/route.ts`) to clear `pausedAt: null` when resuming from paused

### Task 7: Set statusReason on manual pause
- Updated `/api/campaigns/[campaignId]/pause/route.ts` to set `statusReason: 'Pausada manualmente pelo usuário'` and `pausedAt: new Date()`
- Updated the PATCH route's paused transition to also set statusReason and pausedAt

## Files Modified
1. `prisma/schema.prisma` - Added `pausedAt` field
2. `src/lib/sending-engine.ts` - statusReason for WhatsApp warning, pausedAt everywhere, events for toasts
3. `src/app/api/campaigns/[campaignId]/pause/route.ts` - statusReason + pausedAt on manual pause
4. `src/app/api/campaigns/[campaignId]/resume/route.ts` - Clear pausedAt on resume
5. `src/app/api/campaigns/[campaignId]/route.ts` - statusReason + pausedAt on pause, clear on resume
6. `src/app/api/campaigns/process/route.ts` - Collect and return events
7. `src/app/page.tsx` - statusReason display, ban codes, resend button, event toasts

## Build & Deploy
- Prisma client regenerated successfully
- Next.js build successful
- Committed and pushed to GitHub (commit 6c9cc6b)
