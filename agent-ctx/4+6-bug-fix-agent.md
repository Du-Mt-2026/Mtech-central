# Task 4+6: Bug Fix Agent

## Task
- Fix 4: `remaining` field always 0 in process-all endpoint
- Fix 6: Clean up orphan Campaign columns in sync-schema

## Work Completed

### Fix 4: `remaining` field always 0
**File**: `src/app/api/campaigns/process-all/route.ts`

**Root Cause**: The `allResults` array objects only contained `campaignId`, `processed`, `skipped`, `reason` — never setting `remaining`. The `reduce` on line 147 always summed 0 because `r.remaining` was `undefined`.

**Fix**: Added a `db.message.groupBy()` query after the processing loop to count pending messages per campaign. Built a `remainingMap` from the results and populated `r.remaining` on each result before computing `totalRemaining`.

### Fix 6: Orphan Campaign columns
**File**: `src/app/api/setup/sync-schema/route.ts`

**Root Cause**: Lines 452-464 were ADDING `mediaUrl` and `mediatype` columns to the Campaign table, but these columns do NOT exist in the Prisma schema. They are dead/orphan columns.

**Fix**: Replaced the ADD COLUMN logic with DROP COLUMN logic. Now if those columns exist in the database, they are removed. The Message table's `mediaUrl`/`mediatype` columns were kept (they ARE in the Prisma schema).

## Status: Complete
