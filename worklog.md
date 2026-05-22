---
Task ID: 1
Agent: Main Agent
Task: Fix all identified bugs in OctupusZap system

Work Log:
- Rewrote /api/setup/sync-schema to add ALL missing columns/tables (evolutionInstance, profileName, profilePicUrl, disconnectionReasonCode on Chip; mediaUrl, mediatype, variations on SequenceStep; evolutionMessageId, mediaUrl, mediatype on Message; InboxMessage table; Settings table; Campaign cleanup of messageVariations; foreign key enforcement)
- Rewrote /api/stats to use groupBy aggregation instead of loading all messages (fixes OOM risk)
- Fixed prisma/seed.ts to use SequenceStep instead of removed messageVariations
- Added recoverStuckMessages() to sending-engine.ts (resets "sending" messages older than 5min back to "pending")
- Updated getRunningCampaigns() to auto-recover stuck messages before processing
- Fixed /api/campaigns/[id]/resume to call recoverStuckMessages before resuming
- Fixed PATCH /api/campaigns/[id] to also recover stuck messages when resuming from pause
- Fixed campaign fetch error masking in page.tsx - now shows proper error toast instead of silently emptying
- Fixed /api/chips DELETE to also clean up Evolution API instances and WireGuard peers
- Fixed layout scroll: h-screen overflow-hidden on root, ScrollArea on sidebar nav, min-h-0 overflow-y-auto on main
- Added auto-refresh polling every 15 seconds on inbox tab
- Added pagination support to campaigns API (page/limit params)
- Added "cancelled" → "Cancelada" translation and bg-rose-400 color
- Fixed sidebar overflow-hidden for proper ScrollArea behavior
- Deployed and tested all APIs and visual interface

Stage Summary:
- All 11 original bugs fixed and deployed
- Sync-schema migration executed successfully on production (36 steps)
- All API endpoints tested: campaigns (11), stats (7 chips, 11 campaigns, 200 messages), chips (7), inbox, messages (200), contact-lists (10), templates (18)
- Visual test passed: sidebar scroll works, campaigns display, cancelled status translated, main content scrolls properly, 3-panel inbox works
- No campaigns were activated during testing (rule respected)
