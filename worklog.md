# Worklog

---
Task ID: B1+B2+B3
Agent: Main Agent
Task: Backend refactoring — Extract schedules, eliminate `as any`, extract toMins()

Work Log:
- Created `src/lib/constants.ts` — single source of truth for all anti-ban constants
- Created `src/lib/time-utils.ts` — shared utilities
- Refactored sending-engine.ts, antiban route
- Build passes clean

---
Task ID: Bugfix-1
Agent: Main Agent
Task: Fix 15 bugs identified in code review

Work Log:
- H7: Fixed prewarm phase using warmingStartedAt → now uses prewarmStartedAt (sending-engine.ts)
- H3: Fixed fetchProfilePic infinite loop — removed profilePics from useCallback deps (inbox-tab.tsx)
- H2: Fixed inbox polling recreating interval on every message update — uses useRef for messages (inbox-tab.tsx)
- H10: Added debounce (500ms) to anti-ban settings update + optimistic UI updates (antiban-tab.tsx)
- M5: Fixed inbox reply sending base64 as mediaUrl — now uses FormData for file uploads (inbox-tab.tsx + reply route)
- M4: Fixed warming auto-pause threshold hardcoded (10) — now reads from DB AntiBanSettings (warming-engine.ts)
- C1: Fixed off-by-one in auto-pause — session.errorCount is stale (pre-increment), now uses session.errorCount + 1 (warming-engine.ts)
- C2: Fixed crash if schedule is empty — added guard for schedule.length === 0 (sending-engine.ts)
- M3: Fixed pauseChance confusing fraction vs percentage — used Math.round() for consistency (sending-engine.ts)
- M7: Fixed regex not escaped in key names — added escapeRegExp for key.name (sending-engine.ts)
- M2: Fixed dashboard fake loading — replaced setTimeout with proper async/await (page.tsx)
- M10: Fixed checkAllProxies only reacting to chips.length — now uses chip ID fingerprint (page.tsx)
- M1: Already fixed — closeQrDialog properly cleans up polling
- M11: Already correct — nextSendAt: null on campaign completion
- H8: Documented — early return path is mutually exclusive with step 5 warming (process-all)
- Build: passes clean with `next build`

Stage Summary:
- 12 bugs fixed with code changes
- 3 bugs verified as already correct/not actual bugs
- All changes compile and build successfully
- Files modified: sending-engine.ts, warming-engine.ts, inbox-tab.tsx, antiban-tab.tsx, page.tsx, reply/route.ts, process-all/route.ts
